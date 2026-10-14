import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Type } from "typebox";
import { AgentHarness, JsonlSessionRepo, type AgentHarnessOptions } from "../src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";
import { resolveModel } from "../src/model-config.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "whyj-turn-resources-")); });
afterEach(() => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture path");
  rmSync(root, { recursive: true, force: true });
});

async function fixture(prepareTurnResources: AgentHarnessOptions["prepareTurnResources"]) {
  const env = new NodeExecutionEnv({ cwd: root });
  const session = await new JsonlSessionRepo({ fs: env, sessionsRoot: root }).create({ cwd: root });
  let requests = 0;
  const harness = new AgentHarness({ env, session, prepareTurnResources, activeToolNames: ["enabled"],
    tools: ["enabled", "disabled"].map(name => ({ name, label: name, description: name, parameters: Type.Object({}),
      async execute() { throw new Error("No fixture tool may execute"); } })),
    model: resolveModel("anthropic", "fixture", { WHYJ_QUANT_BASE_URL: "https://unused.invalid/anthropic" }),
    getApiKeyAndHeaders: async () => { requests++; throw new Error("Fixture stops before network"); },
  });
  return { harness, session, requests: () => requests };
}

test.each([{ names: ["disabled"] }, { names: ["unknown"] }, { names: ["enabled", "enabled"] }])("rejects invalid transient selection %j before journal/provider work", async ({ names }) => {
  const { harness, session, requests } = await fixture(async ({ resources }) => ({ activeToolNames: [...names], resources }));
  await expect(harness.prompt("Invalid selection")).rejects.toThrow();
  expect(await session.getEntries()).toEqual([]); expect(requests()).toBe(0);
  expect(harness.getActiveTools().map(tool => tool.name)).toEqual(["enabled"]); expect(harness.isIdle).toBe(true);
});

test("cancels pending resource preparation without replacing host resources or persisting input", async () => {
  let entered!: () => void, release!: () => void, observed: AbortSignal | undefined;
  const started = new Promise<void>(done => { entered = done; });
  const held = new Promise<void>(done => { release = done; });
  const { harness, session, requests } = await fixture(async ({ resources, signal }) => {
    observed = signal; entered(); await held; return { activeToolNames: [], resources };
  });
  const pending = harness.prompt("Cancelled input").catch((error: unknown) => error);
  await started; const stopping = harness.abort();
  expect(observed?.aborted).toBe(true); expect(harness.isIdle).toBe(false);
  release(); expect(await pending).toBeInstanceOf(Error); await stopping;
  expect(await session.getEntries()).toEqual([]); expect(requests()).toBe(0);
  expect(harness.getActiveTools().map(tool => tool.name)).toEqual(["enabled"]);
});

test("a failed preparation can be retried and an empty request subset does not change host selection", async () => {
  let fail = true;
  const { harness, session, requests } = await fixture(async ({ resources }) => {
    if (fail) throw new Error("Preparation failed");
    return { activeToolNames: [], resources };
  });
  await expect(harness.prompt("First input")).rejects.toThrow("Preparation failed");
  expect(await session.getEntries()).toEqual([]);
  fail = false; await harness.prompt("Retry");
  expect(requests()).toBe(1); expect(harness.isIdle).toBe(true);
  expect((await session.getEntries()).some(item => item.type === "active_tools_change")).toBe(false);
  expect(harness.getActiveTools().map(tool => tool.name)).toEqual(["enabled"]);
});
