import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function runCli(args: string[], envOverrides: Record<string, string | undefined> = {}) {
  const ohq = join(tmpdir(), `whyj-doctor-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    const env = {
      ...process.env,
      OHQUANT_DIR: ohq,
      WHYJ_QUANT_API_KEY: "test-provider-key",
      WHYJ_QUANT_BASE_URL: "https://api.deepseek.com/anthropic",
      WHYJ_QUANT_LLMQUANT_API_KEY: "test-data-key",
      WHYJ_DOCTOR_SKIP_NETWORK: "1",
      ...envOverrides,
    } as Record<string, string | undefined>;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete env[key];
    }
    return Bun.spawnSync({
      cmd: [process.execPath, "src/index.ts", ...args],
      cwd: process.cwd(),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
  } finally {
    rmSync(ohq, { recursive: true, force: true });
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("CLI doctor command", () => {
  it("prints the canonical slash descriptions in text and JSON help", () => {
    const textResult = runCli(["--help"]);
    expect(textResult.exitCode).toBe(0);
    const text = decode(textResult.stdout);
    expect(text).toContain("/compact     Compact current session context");
    expect(text).toContain("/artifact    Browse, restore, and open reports");

    const jsonResult = runCli(["--json", "--help"]);
    expect(jsonResult.exitCode).toBe(0);
    const body = JSON.parse(decode(jsonResult.stdout));
    expect(body.data.slashCommands).toContain("/artifact");
    expect(body.data.slashCommandDetails).toContainEqual({
      name: "/artifact",
      desc: "Browse, restore, and open reports",
    });
  });

  it("emits stable JSON for whyj --json doctor", () => {
    const result = runCli(["--json", "doctor"]);
    expect(result.exitCode).toBe(0);
    expect(decode(result.stderr)).toBe("");

    const body = JSON.parse(decode(result.stdout));
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      command: "doctor",
      data: expect.objectContaining({
        ready: true,
        auth: expect.any(Object),
        config: expect.any(Object),
        hints: [],
      }),
    }));
    expect(body.data.auth.WHYJ_QUANT_API_KEY).toEqual(expect.objectContaining({
      available: true,
      source: "env",
      value: expect.stringMatching(/^test\.\.\.-key · fp:[0-9a-f]{8}$/),
    }));
    expect(body.data.auth.WHYJ_QUANT_LLMQUANT_API_KEY).toEqual(expect.objectContaining({
      available: true,
      source: "env",
      value: expect.stringMatching(/^test\.\.\.-key · fp:[0-9a-f]{8}$/),
    }));
  });

  it("prints progress lines for whyj doctor text mode", () => {
    const result = runCli(["doctor"]);
    expect(result.exitCode).toBe(0);
    expect(decode(result.stderr)).toBe("");

    const text = decode(result.stdout);
    expect(text).toContain("[....] Model");
    expect(text).toContain("[ OK ] Model");
    expect(text).toContain("[....] Tools");
    expect(text).toContain("[ OK ] Data");
    expect(text).toContain("WhyJ Doctor");
    expect(text).toContain("Phases");
  });

  it("prints a first-setup scaffold for unconfigured whyj doctor text mode", () => {
    const result = runCli(["doctor"], {
      WHYJ_QUANT_API_KEY: undefined,
      WHYJ_QUANT_BASE_URL: undefined,
      WHYJ_QUANT_LLMQUANT_API_KEY: undefined,
    });
    expect(result.exitCode).toBe(0);
    expect(decode(result.stderr)).toBe("");

    const text = decode(result.stdout);
    expect(text).toContain("No credentials configured.");
    expect(text).toContain('"WHYJ_QUANT_API_KEY": "sk-your-key-here"');
    expect(text).toContain('"WHYJ_QUANT_BASE_URL": "https://api.deepseek.com/anthropic"');
    expect(text).toContain("Then: whyj doctor");
  });

  it("runs /doctor through one-shot slash execution", () => {
    const result = runCli(["--json", "-c", "/doctor"]);
    expect(result.exitCode).toBe(0);
    expect(decode(result.stderr)).toBe("");

    const body = JSON.parse(decode(result.stdout));
    expect(body.ok).toBe(true);
    expect(body.command).toBe("doctor");
    expect(body.message).toContain("whyj doctor");
    expect(body.message).toContain("Credentials");
    expect(body.message).toContain("value");
    expect(body.data).toEqual(expect.objectContaining({ ready: true }));
  });
});
