import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { QuantAgentSession } from "../../agent/src/session.ts";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { saveSettings } from "../../storage/index.ts";
import { createQuantResearchAgent } from "../quant-harness.ts";
import { createSkillWorkflowReader } from "../evaluation/skill-evaluation.ts";

type Call = { name: string; args: Record<string, unknown> };
type Payload = { messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>; tools: Array<{ function: { name: string; parameters: unknown } }> };
let root: string, previous: string | undefined, proxy: string | undefined, workflow: string;
let agent: QuantAgentSession | undefined, server: ReturnType<typeof Bun.serve>;
let requests: Payload[], calls: Array<(payload: Payload) => Call>;

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; proxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-supplied-skill-")); process.env.OHQUANT_DIR = root;
  process.env.NO_PROXY = "127.0.0.1,localhost"; requests = []; calls = []; agent = undefined;
  workflow = join(root, "research-health-check.md");
  writeFileSync(workflow, "Research Health Check\nOutput sections: supplied facts, missing evidence, no mutations.\n", "utf8");
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as Payload; requests.push(payload);
    const call = calls.shift()?.(payload);
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `supplied-${requests.length}`, type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] }
      : { role: "assistant", content: "Only the supplied snapshot was interpreted. Report date 2026-09-18; supplied score 62/100. No external lookup or mutation. No verified quant task is claimed." };
    const chunk = { id: "supplied", object: "chat.completion.chunk", created: 0, model: "supplied-test" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "supplied-test"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: `${server.url}v1`, api: "openai-completions", apiKey: "synthetic-supplied-key" } }; saveSettings(settings);
});

afterEach(async () => {
  agent?.abort(); server.stop(true); await agent?.waitForIdle();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected supplied skill fixture root");
  rmSync(root, { recursive: true, force: true });
});

test.each(["read-only", "fabricated-criterion"] as const)("actual Pi skill loop keeps %s supplied evidence outside quant acceptance", async scenario => {
  const reader = createSkillWorkflowReader(workflow, "research-health-check.md");
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
  dependencies.tools = [reader.tool];
  dependencies.loadSkills = async () => [{ name: "fixture-risk", description: "Interpret supplied research snapshots",
    content: "In limited supplied evidence mode, read the health workflow and preserve supplied facts and missing evidence. Do not mutate files or fetch data.",
    filePath: join(root, "SKILL.md"), sourcePath: root, scope: "project", source: "agents" }];
  agent = createQuantResearchAgent({ dependencies });
  if (scenario === "fabricated-criterion") {
    calls.push(() => ({ name: "research_task", args: { action: "read" } }));
    calls.push(payload => {
      const result = payload.messages.findLast(item => item.role === "tool" && typeof item.content === "string" && item.content.includes("\nTask details: "));
      if (!result || typeof result.content !== "string") throw new Error("Missing task capability result");
      const state = JSON.parse(result.content.split("\nTask details: ")[1]!);
      expect(state.acceptanceTools).toEqual([]);
      return { name: "research_task", args: { action: "declare", expectedRevision: state.expectedRevision,
        requestEntryId: state.requestEntryId, task: { goal: "Audit supplied facts", scope: {
          symbols: ["AAPL"], market: "US", start: "2026-05-01", end: "2026-09-18" },
          constraints: { allowedTools: ["bash", "research_task"], notes: [] }, dataRefs: [], reportRequired: false,
          criteria: [{ id: "supplied", description: "Preserve supplied score", tool: "supplied_snapshot_audit", parameters: {}, metrics: ["report_date"] }] } } };
    });
  }
  calls.push(() => ({ name: "bash", args: { command: `Get-Content -Raw -LiteralPath '${workflow}'` } }));
  await agent.skill("fixture-risk", "Interpret only the supplied synthetic snapshot: report date 2026-09-18, overall score 62/100. No external lookup or mutation.");
  const system = requests[0]!.messages.find(item => item.role === "system")!.content;
  expect(system).toContain("A supplied-material interpretation or read-only skill workflow does not need a new quant task");
  const user = requests[0]!.messages.filter(item => item.role === "user")
    .flatMap(item => typeof item.content === "string" ? [item.content] : item.content.filter(part => part.type === "text").map(part => part.text ?? "")).join("\n");
  expect(user).toContain("Do not add price/factor/risk calculations or declare a quant task");
  expect(requests.at(-1)!.messages.some(item => item.role === "tool" && typeof item.content === "string" && item.content.includes("Output sections: supplied facts"))).toBe(true);
  expect(reader.trace.reads.map(read => read.status)).toEqual(["accepted"]);
  const state = await agent.getResearchState();
  expect(state.task).toBeNull(); expect(state.taskErrors).toEqual([]); expect(state.operations).toEqual([]);
  const branch = await agent.getSessionBranch();
  expect(branch.some(entry => entry.type === "custom_message" && entry.customType === "research_task")).toBe(false);
  const failures = branch.filter(entry => entry.type === "message" && entry.message?.role === "toolResult" && entry.message.isError);
  expect(failures).toHaveLength(scenario === "fabricated-criterion" ? 1 : 0);
  if (scenario === "fabricated-criterion") expect(JSON.stringify(failures)).toContain("Validation failed for tool");
  expect(requests).toHaveLength(scenario === "fabricated-criterion" ? 4 : 2);
});
