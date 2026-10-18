import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

let root: string;
const repo = resolve(import.meta.dir, "../..");
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "whyj-startup-test-"));
  const result = await Bun.build({
    entrypoints: [join(repo, "src/index.ts"), join(import.meta.dir, "fixtures/lazy-startup.ts")],
    outdir: join(root, "bundle"), naming: "[name].[ext]", splitting: true, target: "node",
    plugins: [{ name: "startup-load-guards", setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async args => {
        const path = args.path.replaceAll("\\", "/");
        const shell = /\/src\/(?:app\.ts|storage\/index\.ts|cli\/registry\.ts|cli\/doctor\.ts|runtime\/(?:paper|alpaca-paper).*command\.ts)$/.test(path);
        const sdk = /\/pi-ai\/dist\/(?:bun-oauth|api\/(?:anthropic-messages|openai-completions|openai-responses|google-generative-ai))\.js$/.test(path);
        if (!shell && !sdk) return;
        const flag = sdk ? "WHYJ_TEST_NO_SDK" : "WHYJ_TEST_SHELL_ONLY";
        const source = readFileSync(args.path, "utf8").replace(/^#![^\n]*\n/, "");
        return { contents: `if (process.env.${flag} === "1") throw new Error("Unexpected eager module: ${path}");\n${source}`, loader: path.endsWith(".ts") ? "ts" : "js" };
      });
    } }],
  });
  expect(result.success).toBe(true);
}, 30000);
afterAll(() => {
  if (root && resolve(root).startsWith(resolve(tmpdir()) + sep)) rmSync(root, { recursive: true, force: true });
});

async function run(runtime: string, entry: string, args: string[], guards: Record<string, string> = {}) {
  // No inherited provider secrets or user settings; all fixture data is disposable.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP)$/i.test(key)));
  const state = join(root, `state-${crypto.randomUUID()}`);
  const child = Bun.spawn([runtime, join(root, "bundle", entry), ...args], {
    cwd: root, env: { ...env, OHQUANT_DIR: state, HOME: root, USERPROFILE: root, ...guards },
    stdout: "pipe", stderr: "pipe", timeout: 15000,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).arrayBuffer(), new Response(child.stderr).arrayBuffer(),
  ]);
  return { state, exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) };
}
for (const runtime of [process.execPath, "node"]) {
  const label = runtime === "node" ? "Node" : "Bun";
  test(`${label}: help, version and invalid arguments never load application services`, async () => {
    for (const args of [["--help"], ["--version"], ["--help", "--version"], ["--unknown"], ["-c"]]) {
      const result = await run(runtime, "index.js", ["--json", ...args], { WHYJ_TEST_NO_SDK: "1", WHYJ_TEST_SHELL_ONLY: "1" });
      expect(result.stderr.toString()).toBe("");
      const body = JSON.parse(result.stdout.toString());
      expect(body.ok).toBe(args.length === 1 && ["--help", "--version"].includes(args[0]!));
      expect(result.exitCode).toBe(body.ok ? 0 : 1);
      expect(existsSync(result.state)).toBe(false);
    }
  }, 30000);
  for (const mode of ["catalog", "skills", "mcp", "transports", "abort", "oauth"]) {
    test(`${label}: isolated split bundle supports ${mode}`, async () => {
      const result = await run(runtime, "lazy-startup.js", [mode], ["catalog", "skills", "mcp"].includes(mode) ? { WHYJ_TEST_NO_SDK: "1" } : {});
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({ ok: true, mode });
    }, 30000);
  }
}
