import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { ExtensionHost } from "../extensions/index.ts";
import type { ExtensionDefinition } from "../extensions/index.ts";
import { statisticsExtension } from "../extensions/test/fixtures/statistics-extension.ts";
import { extensionSessionDependencies } from "./extension-session.ts";
import { createQuantResearchAgent, QuantResearchHarness } from "./quant-harness.ts";
import type { QuantAgentDependencies, QuantAgentSession } from "../agent/src/session.ts";
import { NodeExecutionEnv } from "../agent/src/session-runtime/node.ts";
import { formatSkillsForSystemPrompt } from "../agent/src/session-runtime/index.ts";
import { memorySessionRepo } from "../agent/test/fixtures/memory-session-repo.ts";
import { buildResearchReport } from "../research/input.ts";
import { prepareRuntimeSkills } from "./skill-readiness.ts";
import { resolveSkillsDir } from "../storage/index.ts";
import { Type } from "typebox";

let root: string, host: ExtensionHost, agent: QuantAgentSession | undefined, base: QuantAgentDependencies;
let server: ReturnType<typeof Bun.serve>, noProxy: string | undefined, requestTool: boolean;
let requests: Array<{ tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: unknown }> }>;

function webSearchExtension(status: "available" | "missing" = "available"): ExtensionDefinition {
  const capabilities = [
    { requirement: "web-search", status, reason: status === "available" ? "Fixture search returns timestamped source records." : "Fixture search provider is offline.",
      requiresTools: ["fixture_web_search"] },
    { requirement: "shell-execution", status: "available" as const, reason: "A capability claim cannot replace the active bash tool." },
  ];
  return {
    manifest: { id: "fixture.search", version: status === "available" ? "1.0.0" : "1.1.0", apiVersion: 1,
      tools: ["fixture_web_search"], skills: [], commands: [], capabilities: capabilities.map(capability => capability.requirement) },
    activate: () => ({ tools: [{ name: "fixture_web_search", label: "Fixture web search", description: "Return a fixed source record for capability tests",
      parameters: Type.Object({ query: Type.String() }), async execute(_id, args) {
        return { content: [{ type: "text", text: `Fixture source for ${(args as { query: string }).query}` }], details: { observedAt: "2026-09-24T00:00:00.000Z" } };
      } }], skills: [], commands: [], capabilities }),
  };
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-extension-session-"));
  noProxy = process.env.NO_PROXY; process.env.NO_PROXY = "127.0.0.1,localhost";
  agent = undefined; requestTool = true; requests = [];
  host = new ExtensionHost({ cwd: root });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as typeof requests[number]; requests.push(body);
    const useTool = requestTool && body.tools?.some(tool => tool.function.name === "fixture_mean") && body.messages.at(-1)?.role !== "tool";
    const delta = useTool ? { role: "assistant", tool_calls: [{ index: 0, id: `extension-${requests.length}`, type: "function", function: { name: "fixture_mean", arguments: '{"values":[1,2,9]}' } }] }
      : { role: "assistant", content: "Extension research response" };
    const common = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "extension-fixture" };
    return new Response([{ ...common, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...common, choices: [{ index: 0, delta: {}, finish_reason: useTool ? "tool_calls" : "stop" }] }]
      .map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  base = { env: new NodeExecutionEnv({ cwd: root }), sessions: memorySessionRepo(), tools: [], async loadSkills() { return []; },
    readConnection: () => ({ model: { id: "extension-fixture", name: "Extension fixture", api: "openai-completions", provider: "custom", baseUrl: `${server.url}v1`, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 },
      thinkingLevel: "off", compactTriggerTokens: 100000, getAuth: async () => ({ apiKey: "fixture" }) }),
    prompts: { system: ({ skills }) => `Research fixture. ${formatSkillsForSystemPrompt(skills)}`, turn: input => input, skill: (_name, extra) => extra ?? "" },
    verifyResearch: input => buildResearchReport(input, () => { throw new Error("No fixture bars"); }, () => { throw new Error("No fixture NAV"); }, () => { throw new Error("No fixture comparison"); }),
  };
});
afterEach(async () => {
  agent?.abort(); await host.dispose(); server.stop(true); await agent?.waitForIdle();
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  const within = relative(realpathSync(tmpdir()), realpathSync(root));
  if (!within.startsWith("whyj-extension-session-") || within.includes(sep)) throw new Error("Unsafe cleanup");
  rmSync(root, { recursive: true, force: true });
});

it("loads, reloads, disables and re-enables tools and skills through real Pi without replacing the research session", async () => {
  agent = createQuantResearchAgent({ dependencies: await extensionSessionDependencies(base, host) });
  await expect(host.load({ manifest: { id: "fixture.reserved", version: "1.0.0", apiVersion: 1, tools: ["research_task"], skills: [], commands: [] },
    activate() { throw new Error("Reserved extension must not activate"); } })).rejects.toThrow("tools conflict");
  await agent.prompt("Original research before installing extensions");
  const metadata = (await agent.getSessionMetadata())!;
  await host.load(statisticsExtension());
  await agent.skill("fixture-statistics");
  expect(JSON.stringify(requests.at(-1))).toContain("Extension mean: 4");
  expect((await agent.getSkills())[0]).toMatchObject({ source: "extension", sourcePath: "extension://fixture.statistics" });
  await host.reload(statisticsExtension({ version: "1.1.0", offset: 10 }));
  await agent.prompt("Continue with the upgraded extension");
  expect(JSON.stringify(requests.at(-1))).toContain("Extension mean: 14");
  const definition = statisticsExtension({ version: "2.0.0" });
  await expect(host.reload({ ...definition, activate() { throw new Error("bad replacement"); } })).rejects.toThrow("bad replacement");
  await agent.prompt("Continue after failed reload");
  expect(agent.state.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
  await host.disable("fixture.statistics");
  await agent.prompt("Review with the extension disabled");
  expect(requests.at(-1)!.tools?.map(tool => tool.function.name)).toEqual(["research_task"]);
  expect(await agent.getSkills()).toEqual([]);
  await expect(agent.skill("fixture-statistics")).rejects.toThrow("Unknown skill");
  await host.enable("fixture.statistics");
  await agent.skill("fixture-statistics");
  expect(JSON.stringify(requests.at(-1))).toContain("Extension mean: 14");
  expect(JSON.stringify(requests.at(-1))).toContain("Original research before installing extensions");
  expect((await agent.getSessionMetadata())?.id).toBe(metadata.id);
  expect((await agent.listSessions()).length).toBe(1);
});

it("keeps restored empty tool selections and rejects skill collisions before changing the journal", async () => {
  const session = await base.sessions.create({ cwd: root }); await session.appendActiveToolsChange([]);
  agent = createQuantResearchAgent({ dependencies: await extensionSessionDependencies(base, host) });
  await agent.resumeSession((await session.getMetadata()).id);
  await host.load(statisticsExtension());
  await agent.prompt("Respect the restored tool selection");
  expect(requests.at(-1)?.tools ?? []).toEqual([]);
  expect(agent.state.tools).toEqual([]);

  const colliding = { name: "fixture-statistics", description: "A local skill", content: "Local", filePath: "memory://local-skill", source: "pi" as const, scope: "project" as const, sourcePath: "memory://skills" };
  const originalLoad = base.loadSkills;
  let collision = false;
  const dependencies = await extensionSessionDependencies({ ...base, readSkillRevision: () => String(collision), loadSkills: async () => collision ? [colliding] : originalLoad() }, host);
  const isolated = createQuantResearchAgent({ dependencies });
  try {
    await isolated.waitForIdle(); const entries = await isolated.getSessionEntries();
    collision = true;
    await host.reload(statisticsExtension({ version: "1.1.0" }));
    await expect(isolated.getSkills()).rejects.toThrow("Duplicate skill names");
    expect(await isolated.getSessionEntries()).toEqual(entries);
    collision = false;
    expect((await isolated.getSkills()).map(skill => skill.name)).toEqual(["fixture-statistics"]);
  } finally { isolated.abort(); await isolated.waitForIdle(); }
});

it("excludes out-of-task extensions installed after agent construction from Pi requests", async () => {
  let calls = 0;
  agent = createQuantResearchAgent({ dependencies: await extensionSessionDependencies(base, host) });
  await agent.waitForIdle();
  await new QuantResearchHarness(agent).update({ version: 1, type: "declare", expectedRevision: null,
    task: { id: "restricted-research", request: "Only run the specified backtest", goal: "Preserve task scope", scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
      constraints: { allowedTools: ["run_backtest"], notes: [] }, dataRefs: [], reportRequired: false,
      criteria: [{ id: "return", description: "Requested return", tool: "run_backtest", parameters: { symbol: "AAPL", fast: 1, slow: 2, commission: 0 }, metrics: ["Total return"] }] },
  });
  await host.load(statisticsExtension({ execute: async () => { calls++; } }));
  await agent.prompt("Attempt the newly installed tool");
  expect(calls).toBe(0);
  expect(requests.at(-1)!.tools?.map(tool => tool.function.name)).toEqual(["research_task"]);
  expect((await agent.getResearchState()).task?.spec.id).toBe("restricted-research");
});

it("recomputes curated skill readiness from extension capabilities across load, disable, enable and reload", async () => {
  const baseCapability = { requirement: "economic-calendar", status: "available" as const, reason: "Base host calendar fixture." };
  const curated = { name: "market-environment-analysis", description: "Curated environment fixture", content: "Fixture",
    filePath: join(resolveSkillsDir(), "tradermonty-claude-trading-skills", "skills", "market-environment-analysis", "SKILL.md"),
    sourcePath: root, source: "pi" as const, scope: "project" as const };
  const dependencies = await extensionSessionDependencies({ ...base, tools: [], loadSkills: async () => [curated],
    readSkillRevision: () => "base-1", readSkillCapabilities: () => ({ "economic-calendar": baseCapability }),
    prepareSkills: (skills, tools, capabilities = {}) => prepareRuntimeSkills(skills, tools, root, { readCapabilities: () => capabilities }) }, host);
  expect(dependencies.readSkillCapabilities?.()).toEqual({ "economic-calendar": baseCapability });
  await expect(host.load(statisticsExtension({ id: "fixture.base-conflict", capabilities: [baseCapability] }))).rejects.toThrow("capabilities conflict");

  agent = createQuantResearchAgent({ dependencies });
  const requirement = async (name: string) => (await agent!.getSkills())[0]!.readiness!.modes.flatMap(mode => mode.requirements).find(item => item.requirement === name)!;
  expect(await requirement("web-search")).toMatchObject({ status: "missing" });

  await host.load(webSearchExtension());
  expect(dependencies.readSkillCapabilities?.()).toMatchObject({ "economic-calendar": baseCapability, "web-search": { status: "available" } });
  expect(await requirement("web-search")).toMatchObject({ status: "available", reason: "Fixture search returns timestamped source records." });
  expect(await requirement("shell-execution")).toMatchObject({ status: "missing" });
  const withoutSearchTool = dependencies.prepareSkills!([curated], [], dependencies.readSkillCapabilities?.())[0]!;
  expect(withoutSearchTool.readiness!.modes[0]!.requirements.find(item => item.requirement === "web-search")).toMatchObject({
    status: "missing", requiresTools: ["fixture_web_search"],
  });

  await host.disable("fixture.search");
  expect(await requirement("web-search")).toMatchObject({ status: "missing" });
  await host.enable("fixture.search");
  expect(await requirement("web-search")).toMatchObject({ status: "available" });
  await host.reload(webSearchExtension("missing"));
  expect(await requirement("web-search")).toMatchObject({ status: "missing", reason: "Fixture search provider is offline." });
});
