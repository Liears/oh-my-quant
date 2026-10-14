import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { NodeExecutionEnv } from "../../../agent/src/session-runtime/node.ts";
import { memorySessionRepo } from "../../../agent/test/fixtures/memory-session-repo.ts";
import type { QuantAgentDependencies, QuantAgentSession } from "../../../agent/src/session-contracts.ts";
import { buildResearchReport } from "../../../research/input.ts";
import { resolveOhquantDir } from "../../../storage/src/dirs.ts";
import { createLocalPaperService } from "../index.ts";
import { createPrivatePaperAgent } from "../agent-session.ts";
import { prepareOrderIntent } from "../../../execution/index.ts";

let root: string, paperRoot: string, server: ReturnType<typeof Bun.serve>, agent: QuantAgentSession | undefined;
let priorNoProxy: string | undefined;
let requests: Array<{ tools?: Array<{ function: { name: string } }>; messages: unknown[] }>;
let reviews: number;
const order = { action: "submit", clientOrderId: "private-agent-1", instrument: { symbol: "AAPL", venue: "NASDAQ", currency: "USD" },
  side: "buy", quantity: "2", limitPrice: "10", maxOrderNotional: "20", timeInForce: "gtc" };

beforeEach(async () => {
  priorNoProxy = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost";
  root = mkdtempSync(join(tmpdir(), "whyj-private-paper-session-")); paperRoot = join(root, "ledger");
  agent = undefined; requests = []; reviews = 0;
  const paper = createLocalPaperService({ root: paperRoot,
    target: { adapterId: "local-paper", accountRef: "private-agent", mode: "paper" },
    openingAccount: { balances: [{ currency: "USD", cash: "100" }], positions: [] } });
  await paper.adapter.account(new AbortController().signal);
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as typeof requests[number] & { model: string };
    requests.push({ tools: body.tools, messages: body.messages });
    const first = requests.length === 1;
    const delta = first ? { role: "assistant", tool_calls: [{ index: 0, id: "private-paper-call", type: "function",
      function: { name: "paper_order", arguments: JSON.stringify(order) } }] }
      : { role: "assistant", content: "Paper submission was reviewed by the host; no fill was recorded." };
    const common = { id: "private-paper-fixture", object: "chat.completion.chunk", created: 0, model: body.model };
    return new Response([
      { ...common, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...common, choices: [{ index: 0, delta: {}, finish_reason: first ? "tool_calls" : "stop" }] },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } });
  } });
});

afterEach(async () => {
  agent?.abort(); await agent?.waitForIdle(); server.stop(true);
  if (priorNoProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = priorNoProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected private paper session fixture root.");
  rmSync(root, { recursive: true, force: true });
});

function baseDependencies(): QuantAgentDependencies {
  return { env: new NodeExecutionEnv({ cwd: root }), sessions: memorySessionRepo(), tools: [
    { name: "public_fixture", label: "Public fixture", description: "Must not reach the private Agent", parameters: { type: "object" },
      async execute() { throw new Error("Public fixture executed"); } } ],
    readConnection() { return { model: { id: "private-fixture", name: "private-fixture", api: "openai-completions", provider: "custom",
      baseUrl: `${server.url}v1`, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000, maxTokens: 1024 }, thinkingLevel: "off", compactTriggerTokens: 100000,
      async getAuth() { return { apiKey: "private-fixture-key" }; } }; },
    async loadSkills() { return [{ name: "public-skill", description: "Must not load", content: "PUBLIC", filePath: "memory://public",
      scope: "project", source: "pi", sourcePath: "memory://public" }]; },
    readTools: () => ({ revision: "public-registry", tools: [] }),
    prompts: { system: () => "PUBLIC PROMPT", turn: input => input, skill: () => "PUBLIC SKILL" },
    verifyResearch: input => buildResearchReport(input, () => { throw new Error("No market data"); },
      () => { throw new Error("No NAV"); }, () => { throw new Error("No comparison"); }),
  };
}

test("a real Pi tool turn submits a reviewed paper order and keeps its transcript in the selected private root", async () => {
  const session = createPrivatePaperAgent({ root: paperRoot, accountRef: "private-agent", baseDependencies: baseDependencies(),
    review: async request => { reviews++; return { action: request.action, intentHash: request.prepared.intentHash,
      expiresAt: Date.now() + 2000 }; } });
  agent = session.agent;
  expect(agent.state.tools.map(tool => tool.name)).toEqual(["paper_account", "paper_order"]);
  expect(agent.state.systemPrompt).toContain("Private paper-only Agent session");
  await agent.prompt("Submit the exact selected paper limit order after host review.");
  expect(reviews).toBe(1); expect(requests).toHaveLength(2);
  expect(requests[0]?.tools?.map(tool => tool.function.name)).toEqual(["paper_account", "paper_order"]);
  expect(JSON.stringify(requests)).not.toMatch(/public_fixture|public-skill|PUBLIC PROMPT/);
  expect(JSON.stringify(requests[1]?.messages)).toContain("private-paper");
  const metadata = await agent.getSessionMetadata();
  expect(metadata?.path).toEndWith(".jsonl");
  expect(resolve(metadata!.path).startsWith(resolve(session.sessionsRoot) + sep)).toBe(true);
  expect(readFileSync(metadata!.path, "utf8")).toContain("private-agent-1");
  expect(resolve(session.sessionsRoot).startsWith(resolve(paperRoot) + sep)).toBe(true);
  expect(existsSync(join(root, "sessions"))).toBe(false);
  const prepared = prepareOrderIntent({ version: 1, target: session.paper.adapter.target,
    clientOrderId: order.clientOrderId, instrument: order.instrument, side: "buy", type: "limit",
    quantity: order.quantity, limitPrice: order.limitPrice, maxOrderNotional: order.maxOrderNotional,
    timeInForce: "gtc" }, session.paper.adapter.target);
  const found = await session.paper.adapter.lookup({ clientOrderId: order.clientOrderId, intentHash: prepared.intentHash },
    new AbortController().signal);
  expect(found.status).toBe("found");
});

test("private Agent composition rejects app-state roots and accounts that were not initialized", () => {
  const options = { root: resolveOhquantDir(), accountRef: "private-agent", baseDependencies: baseDependencies(),
    review: async () => null };
  expect(() => createPrivatePaperAgent(options)).toThrow("app state");
  expect(() => createPrivatePaperAgent({ ...options, root: join(root, "no-ledger") })).toThrow("explicitly");
  expect(() => createPrivatePaperAgent({ ...options, root: "relative-ledger" })).toThrow("absolute");
});
