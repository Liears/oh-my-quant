import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

it.skipIf(process.platform !== "win32").each(["transient", "persistent", "cancel", "other-syscall"])("handles %s Windows lock acquisition failure without repeating the protected write", async mode => {
  const root = mkdtempSync(join(tmpdir(), "whyj-lock-fault-"));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "lock-failure-runner.ts"), mode], {
    env: { ...process.env, WHYJ_LOCK_FIXTURE_PATH: join(root, "snapshot.json") }, stdout: "pipe", stderr: "pipe",
  });
  try {
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, error }).toEqual({ code: 0, error: "" });
    const result = JSON.parse(output);
    expect(result.final).toBe("recovered");
    expect(result.beforeRecovery.lockExists).toBe(false);
    if (mode === "transient") {
      expect(result.attempts).toBe(4); expect(result.error).toBeNull(); expect(result.beforeRecovery).toMatchObject({ calls: 1, text: "changed" }); expect(result.finalCalls).toBe(2);
    } else {
      expect(result.beforeRecovery).toMatchObject({ calls: 0, text: "original" }); expect(result.finalCalls).toBe(1);
      if (mode === "cancel") expect(result.error.name).toBe("AbortError"); else expect(result.error.code).toBe("EPERM");
      if (mode === "persistent") expect(result.attempts).toBeGreaterThan(1); else expect(result.attempts).toBe(1);
    }
  } finally {
    if (child.exitCode === null) child.kill(); await child.exited;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected lock fixture root");
    rmSync(root, { recursive: true, force: true });
  }
});
