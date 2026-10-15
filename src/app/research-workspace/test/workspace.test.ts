import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { JsonlSessionRepo } from "../../../agent/src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../../../agent/src/session-runtime/node.ts";
import type { QuantAgentDependencies } from "../../../agent/src/session-contracts.ts";
import {
  createWorkspaceStore,
  workspaceHash,
  subscribeFileEvents,
} from "../../../storage/index.ts";
import { buildResearchReport } from "../../../research/input.ts";
import { startWorkspaceServer } from "../server.ts";
import { calculateMetrics } from "../metrics.ts";
import type {
  WorkspaceEvidence,
  WorkspaceRun,
} from "../../../types/workspace.ts";

const roots: string[] = [],
  servers: Array<{ stop(force?: boolean): unknown }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep))
      throw new Error("Unsafe test cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
const scope = {
  symbol: "002048.SZ",
  benchmark: "000300.SH",
  start: "2026-01-01",
  end: "2026-02-01",
};
function evidence(symbol: string, factor = 1): WorkspaceEvidence {
  const bars = Array.from({ length: 25 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open: (100 + i) * factor,
    close: (100 + i) * factor,
    high: (102 + i) * factor,
    low: (99 + i) * factor,
    volume: i === 24 ? 200 : 100,
    amount: null,
  }));
  return {
    id: symbol === scope.symbol ? "E1" : "E2",
    kind: "prices",
    symbol,
    source: "fixture",
    fetchedAt: "2026-02-01T00:00:00Z",
    contentHash: workspaceHash(bars),
    bars,
    sessions: bars.map((b) => b.date),
    adjustment: "fixture",
    limitations: [],
  };
}
async function fixture(mode = "normal") {
  const root = mkdtempSync(join(tmpdir(), "whyj-workspace-"));
  roots.push(root);
  let requests = 0,
    reads = 0;
  const names = [
    "get_market_evidence",
    "calculate_research",
    "publish_research",
  ];
  const modelServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        tools: Array<{ function: { name: string } }>;
      };
      expect(body.tools.map((t) => t.function.name).sort()).toEqual(
        [...names, "ask_user"].sort(),
      );
      const n = requests++;
      const answer = {
        summary: "固定样本结构观察",
        classification: "上涨后观察",
        signal: "观察",
        claims: [
          {
            text: "样本收益由工具计算。",
            evidence: [mode === "bad-citation" ? "E99" : "E3"],
          },
        ],
        next: ["跟踪后续日线"],
        limitations: [],
      };
      const name = names[Math.min(n, 2)]!;
      const args = n < 2 ? {} : answer;
      const chunk = {
        id: "fixture",
        object: "chat.completion.chunk",
        created: 0,
        model: "fixture",
      };
      const parts = [
        {
          ...chunk,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `t${n}`,
                    type: "function",
                    function: { name, arguments: JSON.stringify(args) },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          ...chunk,
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        },
      ];
      return new Response(
        parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") +
          "data: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  servers.push(modelServer);
  const model: Model<"openai-completions"> = {
    id: "fixture",
    name: "fixture",
    api: "openai-completions",
    provider: "custom",
    baseUrl: `${modelServer.url}v1`,
    reasoning: false,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 1000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const env = new NodeExecutionEnv({ cwd: root });
  const dependencies = (): QuantAgentDependencies => ({
    env,
    sessions: new JsonlSessionRepo({
      fs: env,
      sessionsRoot: join(root, "sessions"),
    }),
    tools: [],
    readConnection: () => ({
      model,
      thinkingLevel: "off",
      compactTriggerTokens: 100000,
      getAuth: async () => ({ apiKey: "fixture-key" }),
    }),
    loadSkills: async () => [],
    prompts: { system: () => "", turn: (s) => s, skill: () => "" },
    verifyResearch: buildResearchReport,
  });
  const store = createWorkspaceStore(join(root, "saved"));
  const app = startWorkspaceServer({
    port: 0,
    dependencies,
    store,
    timeoutMs: mode === "timeout" ? 100 : 5000,
    async fetchPrices(symbol, _scope, signal) {
      reads++;
      if (
        ((mode === "slow" || mode === "timeout") && reads === 1) ||
        (mode === "slow-base" && reads === 2)
      )
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        );
      signal.throwIfAborted();
      if (mode === "broken")
        throw new Error("private provider failure fixture-key");
      const e = evidence(symbol);
      return {
        bars: e.bars!,
        sessions: e.sessions!,
        source: e.source,
        fetchedAt: e.fetchedAt,
        adjustment: e.adjustment!,
      };
    },
  });
  servers.push(app.server);
  const url = app.server.url;
  const { token } = (await (
    await fetch(new URL("api/status", url))
  ).json()) as { token: string };
  const post = (path: string, value: unknown = {}) =>
    fetch(new URL(path, url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Token": token,
      },
      body: JSON.stringify(value),
    });
  const wait = async (id: string) => {
    for (let i = 0; i < 150; i++) {
      const r = app.manager.get(id);
      if (r.status !== "running") return r;
      await Bun.sleep(20);
    }
    throw new Error("Fixture did not settle");
  };
  return {
    ...app,
    post,
    wait,
    root,
    url,
    store,
    reads: () => reads,
    reset: () => {
      requests = 0;
    },
  };
}
test("real Pi loop → tools → citations → immutable save → reload → linked review", async () => {
  const f = await fixture();
  const response = await f.post("api/runs", {
    question: "研究固定样本",
    scope,
  });
  expect(response.status).toBe(202);
  const started = (await response.json()) as WorkspaceRun;
  const run = await f.wait(started.id);
  expect(run.status).toBe("complete");
  expect(run.answer?.claims[0]?.evidence).toEqual(["E3"]);
  expect(run.evidence[2]?.result?.returnPct).toBeCloseTo(24);
  expect(run.evidence[2]?.result?.volumeRatio).toBe(2);
  expect(run.answer?.limitations.join(" ")).toContain("板块");
  expect((await f.post(`api/runs/${run.id}/save`)).status).toBe(200);
  expect((await f.post(`api/runs/${run.id}/save`)).status).toBe(200);
  const before = f.store.load(run.id);
  f.reset();
  const reviewed = (await (
    await f.post(`api/runs/${run.id}/review`, { end: scope.end })
  ).json()) as WorkspaceRun;
  const review = await f.wait(reviewed.id);
  expect(review.status).toBe("complete");
  expect(review.parentId).toBe(run.id);
  expect(review.evidence[2]?.result?.historicalRevisions).toEqual([]);
  expect(review.evidence[2]?.result?.previousBoundary).toEqual(
    run.evidence[2]?.result?.structuralLow,
  );
  expect(f.store.load(run.id)).toEqual(before);
  expect(createWorkspaceStore(join(f.root, "saved")).list()).toHaveLength(1);
}, 10000);
test("unknown citations never become a saved completed report", async () => {
  const f = await fixture("bad-citation");
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  const run = await f.wait(r.id);
  expect(run.status).toBe("failed");
  expect(run.answer).toBeNull();
  expect((await f.post(`api/runs/${r.id}/save`)).status).toBe(400);
}, 10000);
test("cancel aborts tool fetch; explicit continue reuses session and completes", async () => {
  const f = await fixture("slow");
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  for (let i = 0; i < 50 && f.reads() === 0; i++) await Bun.sleep(20);
  expect((await f.post(`api/runs/${r.id}/cancel`)).status).toBe(200);
  expect((await f.wait(r.id)).status).toBe("cancelled");
  f.reset();
  expect((await f.post(`api/runs/${r.id}/continue`)).status).toBe(200);
  expect((await f.wait(r.id)).status).toBe("complete");
}, 10000);
test("local API rejects cross-origin, missing token, and malformed scope", async () => {
  const f = await fixture();
  expect(
    (await fetch(new URL("api/runs", f.url), { method: "POST", body: "{}" }))
      .status,
  ).toBe(403);
  expect(
    (
      await fetch(new URL("api/status", f.url), {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await f.post("api/runs", {
        question: "test",
        scope: { ...scope, symbol: "300001.SZ" },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.post("api/runs", {
        question: "test",
        scope: { ...scope, end: "2030-01-01" },
      })
    ).status,
  ).toBe(400);
});
test("partial evidence survives cancellation and a second run cannot race the active one", async () => {
  const f = await fixture("slow-base");
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  for (let i = 0; i < 80 && f.reads() < 2; i++) await Bun.sleep(20);
  expect(f.manager.get(r.id).evidence).toHaveLength(1);
  expect(
    (await f.post("api/runs", { question: "another", scope })).status,
  ).toBe(400);
  await f.post(`api/runs/${r.id}/cancel`);
  const stopped = await f.wait(r.id);
  expect(stopped.status).toBe("cancelled");
  expect(stopped.evidence).toHaveLength(1);
  const hash = stopped.evidence[0]!.contentHash;
  f.reset();
  await f.post(`api/runs/${r.id}/continue`);
  const completed = await f.wait(r.id);
  expect(completed.status).toBe("complete");
  expect(completed.evidence[0]!.contentHash).toBe(hash);
  expect(f.reads()).toBe(3);
}, 10000);

test("timeout leaves an explicit incomplete task; source failures cannot masquerade as analysis", async () => {
  const f = await fixture("timeout");
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  const stopped = await f.wait(r.id);
  expect(stopped.status).toBe("cancelled");
  expect(stopped.error).toContain("时限");
  expect((await f.post(`api/runs/${r.id}/save`)).status).toBe(400);
  const broken = await fixture("broken");
  const b = (await (
    await broken.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  const failed = await broken.wait(b.id);
  expect(failed.status).toBe("failed");
  expect(failed.answer).toBeNull();
  expect(JSON.stringify(failed)).not.toContain("fixture-key");
}, 10000);

test("closing progress stream does not cancel the research", async () => {
  const f = await fixture();
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  const stream = await fetch(new URL(`api/runs/${r.id}/events`, f.url));
  expect(stream.headers.get("content-type")).toBe("text/event-stream");
  const reader = stream.body!.getReader();
  expect((await reader.read()).value?.length).toBeGreaterThan(0);
  await reader.cancel();
  expect((await f.wait(r.id)).status).toBe("complete");
}, 10000);

test("metrics use preceding volume and common dates; revisions preserve original boundary", () => {
  const stock = evidence(scope.symbol),
    base = evidence(scope.benchmark, 2);
  const m = calculateMetrics(stock, base);
  expect(m.ma20).toBeCloseTo(114.5);
  expect(m.volumeRatio).toBe(2);
  expect(m.relativeReturnPp).toBe(0);
  expect(m.drawdownPct).toBe(0);
  expect(m.comparison.previousEnd).toBeNull();
  expect(m.comparison.comparable).toBe(false);
  const previous = {
    evidence: [structuredClone(stock), { result: m }],
  } as WorkspaceRun;
  stock.bars![0]!.close += 0.1;
  const review = calculateMetrics(stock, base, previous);
  expect(review.historicalRevisions).toEqual(["2026-01-01"]);
  expect(review.previousBoundary).toEqual(m.structuralLow);
});

test("missing forward sessions and regressed coverage cannot validate an old boundary", () => {
  const stock = evidence(scope.symbol),
    base = evidence(scope.benchmark);
  const previous = {
    evidence: [
      structuredClone(stock),
      { result: calculateMetrics(stock, base) },
    ],
  } as WorkspaceRun;
  stock.bars!.push({
    date: "2026-01-27",
    open: 90,
    high: 91,
    low: 89,
    close: 90,
    volume: 100,
    amount: null,
  });
  stock.sessions!.push("2026-01-26", "2026-01-27");
  const missing = calculateMetrics(stock, base, previous);
  expect(missing.comparison.advanced).toBe(true);
  expect(missing.close).toBeLessThan(missing.previousBoundary!.price);
  expect(missing.comparison.comparable).toBe(false);
  stock.bars!.splice(-2);
  const regressed = calculateMetrics(stock, base, previous);
  expect(regressed.comparison.comparable).toBe(false);
  expect(regressed.limitations.join(" ")).toContain("倒退");
  expect(regressed.limitations.join(" ")).not.toContain("截止日相同");
});

test("successful file activities are observable and idempotent saves do not invent writes", async () => {
  const f = await fixture();
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  await f.wait(r.id);
  const operations: string[] = [];
  const unsubscribe = subscribeFileEvents((event) => {
    if (event.path.startsWith(join(f.root, "saved")))
      operations.push(event.operation);
  });
  try {
    await f.post(`api/runs/${r.id}/save`);
    f.store.list();
    expect(operations).toContain("MKDIR");
    expect(operations).toContain("READ");
    expect(operations.filter((op) => op === "WRITE")).toHaveLength(1);
    await f.post(`api/runs/${r.id}/save`);
    expect(operations.filter((op) => op === "WRITE")).toHaveLength(1);
  } finally {
    unsubscribe();
  }
}, 10000);
test("saved checksum detects corruption without overwriting original", async () => {
  const f = await fixture();
  const r = (await (
    await f.post("api/runs", { question: "test", scope })
  ).json()) as WorkspaceRun;
  await f.wait(r.id);
  await f.post(`api/runs/${r.id}/save`);
  const path = join(f.root, "saved", `${r.id}.json`),
    text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace("固定样本结构观察", "tampered"));
  expect(() => f.store.load(r.id)).toThrow("integrity");
  expect((await f.post(`api/runs/${r.id}/save`)).status).toBe(400);
}, 10000);
