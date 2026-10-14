import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHarness, JsonlSessionRepo } from "../src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";
import { resolveModel } from "../src/model-config.ts";
import { lockSync } from "proper-lockfile";

let root = "";
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "whyj-harness-lifecycle-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const env = new NodeExecutionEnv({ cwd: root });
  const session = await new JsonlSessionRepo({ fs: env, sessionsRoot: root }).create({ cwd: root });
  const first = await session.appendMessage({ role: "user", content: "First request", timestamp: 1 });
  await session.appendMessage({ role: "user", content: "Second request", timestamp: 2 });
  const harness = new AgentHarness({
    env, session,
    model: resolveModel("anthropic", "fixture", { WHYJ_QUANT_BASE_URL: "https://unused.invalid/anthropic" }),
    getApiKeyAndHeaders: async () => ({ apiKey: "fixture-key" }),
  });
  // Exercise the real upstream request builder but never send a network request.
  harness.on("before_provider_payload", () => { throw new Error("fixture stops before network"); });
  return { harness, session, first };
}

it("cancels compaction before persistence and waits for hooks and pending writes to settle", async () => {
  const { harness, session } = await fixture();
  const entered = deferred(), release = deferred();
  let signal: AbortSignal | undefined;
  harness.on("session_before_compact", async (event) => {
    signal = event.signal;
    entered.resolve();
    await release.promise;
    return { compaction: { summary: "Must not persist", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: 1 } };
  });
  const compacting = harness.compact();
  const rejection = compacting.then(() => null, (error: unknown) => error);
  await entered.promise;
  await harness.appendMessage({ role: "user", content: "Pending note", timestamp: 3 });
  let idle = false;
  const waiting = harness.waitForIdle().then(() => { idle = true; });
  const stopping = harness.abort();
  await Promise.resolve();
  expect(signal?.aborted).toBe(true);
  expect(idle).toBe(false);
  release.resolve();
  await Promise.all([rejection, stopping, waiting]);
  expect(await rejection).toBeInstanceOf(Error);
  const entries = await session.getEntries();
  expect(entries.some((entry) => entry.type === "compaction")).toBe(false);
  expect(entries.at(-1)).toMatchObject({ type: "message", message: { content: "Pending note" } });
});

it("cancels tree navigation without moving the current leaf", async () => {
  const { harness, session, first } = await fixture();
  const leaf = await session.getLeafId();
  const entered = deferred(), release = deferred();
  let signal: AbortSignal | undefined;
  harness.on("session_before_tree", async (event) => {
    signal = event.signal;
    entered.resolve();
    await release.promise;
    return { summary: { summary: "Must not persist" } };
  });
  const navigating = harness.navigateTree(first);
  await entered.promise;
  const stopping = harness.abort();
  expect(signal?.aborted).toBe(true);
  release.resolve();
  expect(await navigating).toEqual({ cancelled: true });
  await stopping;
  expect(await session.getLeafId()).toBe(leaf);
});

it("remains busy until agent_end subscribers finish", async () => {
  const { harness } = await fixture();
  const entered = deferred(), release = deferred();
  harness.subscribe(async (event) => {
    if (event.type === "agent_end") { entered.resolve(); await release.promise; }
  });
  const prompting = harness.prompt("First turn");
  await entered.promise;
  await expect(harness.prompt("Reentrant turn")).rejects.toThrow("busy");
  let idle = false;
  const waiting = harness.waitForIdle().then(() => { idle = true; });
  await Promise.resolve();
  expect(idle).toBe(false);
  release.resolve();
  await Promise.all([prompting, waiting]);
  await harness.prompt("Next turn");
});

it("aborts during turn preparation before a provider request can start", async () => {
  const { harness } = await fixture();
  const entered = deferred(), release = deferred();
  let requests = 0;
  harness.on("before_agent_start", async () => { entered.resolve(); await release.promise; return {}; });
  harness.on("before_provider_request", () => { requests++; return {}; });
  const prompting = harness.prompt("Cancelled before streaming");
  const rejection = prompting.then(() => null, (error: unknown) => error);
  await entered.promise;
  const stopping = harness.abort();
  release.resolve();
  await Promise.all([rejection, stopping]);
  expect(await rejection).toBeInstanceOf(Error);
  expect(requests).toBe(0);
});

it("clears next-turn messages on abort", async () => {
  const { harness, session } = await fixture();
  await harness.nextTurn("Cancelled queue entry");
  await harness.abort();
  await harness.prompt("Fresh input");
  expect(JSON.stringify(await session.getEntries())).not.toContain("Cancelled queue entry");
});

it("releases the operation after subscriber failures", async () => {
  const { harness } = await fixture();
  const unsubscribe = harness.subscribe((event) => {
    if (event.type === "agent_end") throw new Error("listener failure");
  });
  await expect(harness.prompt("Failing subscriber")).rejects.toThrow();
  await harness.waitForIdle();
  unsubscribe();
  await harness.prompt("Recovered subscriber");
});

for (const operation of ["compaction", "navigation"] as const) {
  it(`cancels ${operation} during a storage lock wait and releases the harness`, async () => {
    const { harness, session, first } = await fixture();
    const meta = await session.getMetadata();
    const original = readFileSync(meta.path, "utf8");
    const leaf = await session.getLeafId();
    const entered = deferred();
    harness.on("session_before_compact", event => {
      entered.resolve();
      return { compaction: { summary: "Provided summary", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: 1 } };
    });
    harness.on("session_before_tree", () => {
      entered.resolve();
      return { summary: { summary: "Provided summary" } };
    });
    const release = lockSync(meta.path, { realpath: false, stale: 10_000, update: 2_000 });
    try {
      const running = operation === "compaction" ? harness.compact() : harness.navigateTree(first);
      const outcome = running.catch((error: unknown) => error);
      await entered.promise;
      await Bun.sleep(30);
      await harness.abort();
      const result = await outcome;
      if (operation === "compaction") expect(result).toBeInstanceOf(Error);
      else expect(result).toEqual({ cancelled: true });
      await harness.waitForIdle();
      expect(await session.getLeafId()).toBe(leaf);
      expect(readFileSync(meta.path, "utf8")).toBe(original);
    } finally { release(); }
    if (operation === "compaction") await harness.compact();
    else await harness.navigateTree(first);
    expect((await session.getEntries()).filter(entry => entry.type === (operation === "compaction" ? "compaction" : "branch_summary"))).toHaveLength(1);
  });
}
