import { expect, test } from "bun:test";
import { relative, resolve } from "node:path";

test("the session core bundles without CLI, TUI, runtime composition or the builtin tool registry", async () => {
  const src = resolve(import.meta.dir, "../..");
  const visited = new Set<string>();
  const result = await Bun.build({
    entrypoints: [resolve(src, "agent/src/session.ts")], target: "bun",
    plugins: [{ name: "session-host-boundary", setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]s$/ }, args => {
        const path = relative(src, args.path).replaceAll("\\", "/");
        if (path.startsWith("../")) return;
        visited.add(path);
        if (/^(runtime|tools|cli|tui|app)\//.test(path)) throw new Error(`Session loaded application host: ${path}`);
      });
    } }],
  });
  expect(result.success).toBe(true);
  expect(visited.has("agent/src/session.ts")).toBe(true);
  expect(visited.has("agent/src/kernel/loop.ts")).toBe(true);
});
