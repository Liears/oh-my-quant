import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Type } from "typebox";
import { createHash } from "node:crypto";
import { createAgent, type QuantAgentDependencies, type QuantAgentSession } from "../src/session.ts";
import type { AgentTool } from "../src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";
import { memorySessionRepo } from "./fixtures/memory-session-repo.ts";
import { buildResearchReport } from "../../research/input.ts";
import type { QuantSkill } from "../src/skills.ts";
import { createDefaultSessionDependencies } from "../../runtime/session-dependencies.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { prepareRuntimeSkills } from "../../runtime/skills/skill-readiness.ts";
import { checkSkillPython, skillPythonRevision } from "../../skill/python-probe.ts";
import { checkSkillNetwork, skillNetworkRevision } from "../../skill/network-probe.ts";
import { formatSkillsForSystemPrompt } from "../src/session-runtime/index.ts";
import { checkSkillFiles, SCRIPT_FILES_REQUIREMENT, skillFileRevision } from "../../skill/file-probe.ts";
import { CURATED_SKILL_REPOSITORIES } from "../../skill/catalog.ts";
import { checkEtfNetwork, skillEtfRevision } from "../../skill/etf-network-probe.ts";

let root: string, previous: string | undefined, noProxy: string | undefined;
let server: ReturnType<typeof Bun.serve>, agent: QuantAgentSession | undefined;
let requests: Array<{ path: string; auth: string | null; body: { model: string; messages: unknown[]; tools?: Array<{ function: { name: string } }> } }>;
let dependencies: QuantAgentDependencies, skills: QuantSkill[];
let selected: { model: string; endpoint: string; key: string };
let toolCalls: number, projected: number;
let callTool: boolean, blockTool: boolean, blockAuth: boolean, failSkills: boolean;
let failVerification: boolean;
let onTool: (() => void) | undefined, onAuth: (() => void) | undefined;

beforeEach(() => {
  previous = process.env.OHQUANT_DIR; noProxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-session-injection-")); process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  // Any accidental local settings resolution would fail; any default initialization would add files.
  writeFileSync(join(root, "settings.json"), "invalid-local-settings");
  requests = []; agent = undefined; toolCalls = 0; projected = 0;
  callTool = false; blockTool = false; blockAuth = false; failSkills = false; failVerification = false; onTool = undefined; onAuth = undefined;
  selected = { model: "injected-one", endpoint: "first", key: "fixture-first-key" };
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json() as typeof requests[number]["body"];
    requests.push({ path: new URL(request.url).pathname, auth: request.headers.get("authorization"), body });
    const useTool = callTool && requests.length === 1;
    const delta = useTool ? { role: "assistant", tool_calls: [{ index: 0, id: "mean-call", type: "function", function: { name: "sample_mean", arguments: '{"values":[1,2,9]}' } }] }
      : { role: "assistant", content: "Injected session response" };
    const common = { id: "fixture", object: "chat.completion.chunk", created: 0, model: body.model };
    return new Response([
      { ...common, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...common, choices: [{ index: 0, delta: {}, finish_reason: useTool ? "tool_calls" : "stop" }] },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const schema = Type.Object({ values: Type.Array(Type.Number(), { minItems: 1 }) });
  const tool: AgentTool<typeof schema> = { name: "sample_mean", label: "Sample mean", description: "Compute the sample mean from explicit observations", parameters: schema,
    async execute(_id, args, signal) {
      toolCalls++; onTool?.();
      if (blockTool) await new Promise<void>((_resolve, reject) => {
        signal?.throwIfAborted(); signal?.addEventListener("abort", () => reject(new Error("injected tool cancelled")), { once: true });
      });
      const mean = args.values.reduce((sum, value) => sum + value, 0) / args.values.length;
      return { content: [{ type: "text", text: `Mean: ${mean}` }], details: { mean } };
    },
  };
  skills = [{ name: "fixture-research", description: "Explicit fixture observations", content: "FIXTURE_SKILL_CONTENT", filePath: "memory://skill",
    scope: "project", source: "pi", sourcePath: "memory://skills" }];
  dependencies = {
    env: new NodeExecutionEnv({ cwd: root }), sessions: memorySessionRepo(), tools: [tool],
    readConnection() {
      const snapshot = { ...selected };
      return { model: { id: snapshot.model, name: snapshot.model, api: "openai-completions", provider: "custom", baseUrl: `${server.url}${snapshot.endpoint}/v1`,
        reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 },
        thinkingLevel: "off", compactTriggerTokens: 100000,
        async getAuth(_model, signal) {
          onAuth?.();
          if (blockAuth) await new Promise<void>((_resolve, reject) => { signal?.throwIfAborted(); signal?.addEventListener("abort", () => reject(new Error("injected auth cancelled")), { once: true }); });
          return { apiKey: snapshot.key };
        },
      };
    },
    async loadSkills() { if (failSkills) throw new Error("Injected skill loader failure"); return skills; },
    prompts: { system: ({ tools, skills }) => `Injected research host. Tools: ${tools.map(tool => tool.name).join(",")}. Skills: ${skills.map(skill => skill.name).join(",")}`,
      turn: input => `Injected turn: ${input}`, skill: (_name, additional) => `Injected skill instruction: ${additional ?? ""}` },
    verifyResearch(input) {
      projected++;
      if (failVerification) throw new Error("Injected evidence failure");
      return buildResearchReport(input, () => { throw new Error("No fixture Bars requested"); }, () => { throw new Error("No fixture NAV requested"); }, () => { throw new Error("No fixture comparison requested"); });
    },
  };
});
afterEach(async () => {
  agent?.abort(); server.stop(true); await agent?.waitForIdle();
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected injected fixture root");
  rmSync(root, { recursive: true, force: true });
});

it("executes an independently supplied tool and skill with an in-memory repo and no local default IO", async () => {
  callTool = true;
  agent = createAgent({ dependencies });
  await agent.prompt("分析这组显式观测值的均值");
  expect(toolCalls).toBe(1); expect(requests).toHaveLength(2);
  expect(requests[0]!.body.tools!.map(tool => tool.function.name)).toEqual(["sample_mean"]);
  expect(JSON.stringify(requests[1])).toContain("Mean: 4");
  expect(JSON.stringify(requests)).not.toMatch(/compute_factor|run_backtest|mandatory quant analysis workflow/);
  await agent.skill("fixture-research", "Keep the explicit observations");
  expect(JSON.stringify(requests.at(-1))).toContain("FIXTURE_SKILL_CONTENT");
  expect(JSON.stringify(requests.at(-1))).toContain("Injected skill instruction");
  expect((await agent.getResearchState()).availableTools).toEqual(["sample_mean"]);
  expect(projected).toBeGreaterThan(0);
  expect((await agent.getSessionMetadata())?.path).toStartWith("memory://");
  expect((await agent.listSessions()).length).toBe(1);
  expect(readdirSync(root)).toEqual(["settings.json"]);
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("invalid-local-settings");
});

it("projects a default host capability source into curated readiness and revisions", () => {
  const previousSkills = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  writeFileSync(join(root, "settings.json"), JSON.stringify(DEFAULT_SETTINGS));
  let revision = "host-capabilities-v1";
  const local = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "host-capability-sessions"), settings: DEFAULT_SETTINGS,
    skillCapabilities: {
      read: () => ({ "web-search": { requirement: "host-search", status: "available", reason: "Trusted host search adapter is active." } }),
      revision: () => revision,
    } });
  const environment: QuantSkill = { name: "market-environment-analysis", description: "Environment fixture", content: "Fixture",
    filePath: join(root, "tradermonty-claude-trading-skills", "skills", "market-environment-analysis", "SKILL.md"),
    sourcePath: root, source: "pi", scope: "project" };
  try {
    const prepared = local.prepareSkills!([environment], [...local.tools])[0]!;
    expect(prepared.readiness?.modes[0]).toMatchObject({ name: "market research", status: "requirements-met" });
    expect(prepared.readiness?.modes[0]?.requirements.find(item => item.requirement === "web-search")).toMatchObject({
      requirement: "web-search", status: "available", reason: "Trusted host search adapter is active.",
    });
    const before = local.readSkillRevision!();
    revision = "host-capabilities-v2";
    expect(local.readSkillRevision!()).not.toBe(before);
  } finally {
    if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  }
});

it("keeps injected connection snapshots throughout tool and queued turns then applies a new connection", async () => {
  callTool = true;
  agent = createAgent({ dependencies });
  let changed = false;
  agent.subscribe(async event => {
    if (event.type !== "before_provider_payload" || changed) return;
    changed = true; selected = { model: "injected-two", endpoint: "second", key: "fixture-second-key" };
    await agent!.followUp({ role: "user", content: "queued continuation", timestamp: 0 });
  });
  await agent.prompt("Compute the mean");
  expect(requests.length).toBeGreaterThanOrEqual(3);
  for (const request of requests) expect(request).toMatchObject({ path: "/first/v1/chat/completions", auth: "Bearer fixture-first-key", body: { model: "injected-one" } });
  await agent.prompt("Next independent request");
  expect(requests.at(-1)).toMatchObject({ path: "/second/v1/chat/completions", auth: "Bearer fixture-second-key", body: { model: "injected-two" } });
});

it("blocks unverified explicit skills before journal/provider work, then admits only the checked mode in the same session", async () => {
  const previousSkills = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  let revision = 0;
  let filesReady = false;
  dependencies.tools[0]!.name = "bash";
  dependencies.prepareSkills = (items, tools) => prepareRuntimeSkills(items, tools, root, { readReviewedFiles: () => ({
    requirement: "reviewed-script-files", status: filesReady ? "available" : "unverified",
    reason: filesReady ? "Fixed fixture content verified." : "Fixed fixture content not checked.",
  }) });
  dependencies.readSkillRevision = () => `${revision}:${skillPythonRevision(root)}`;
  dependencies.prompts.system = ({ skills }) => `Fixture host. ${formatSkillsForSystemPrompt(skills)}`;
  skills = [{ ...skills[0]!, name: "market-environment-analysis", filePath: join(root, "tradermonty-claude-trading-skills", "skills", "market-environment-analysis", "SKILL.md") }];
  try {
    agent = createAgent({ dependencies });
    await agent.prompt("Preserve this original research");
    const entries = await agent.getSessionEntries(), metadata = await agent.getSessionMetadata();
    expect(JSON.stringify(requests[0]!.body.messages[0])).not.toContain("market-environment-analysis");
    await expect(agent.skill("market-environment-analysis")).rejects.toThrow("unverified");
    expect(requests).toHaveLength(1);
    expect(await agent.getSessionEntries()).toEqual(entries);
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python", packages: { requests: "2.32.0", yfinance: null, "pandas-market-calendars": "5.2.2" } }), stderr: "" }));
    await expect(agent.skill("market-environment-analysis")).rejects.toThrow("unverified");
    expect(requests).toHaveLength(1);
    filesReady = true; revision++;
    await expect(agent.skill("market-environment-analysis")).rejects.toThrow("unverified");
    expect(requests).toHaveLength(1);
    expect(await agent.getSessionEntries()).toEqual(entries);
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python",
      packages: { requests: "2.32.0", yfinance: null, "pandas-market-calendars": "5.2.2" },
      imports: { "pandas-market-calendars": { status: "available" } } }), stderr: "" }), ["pandas-market-calendars"]);
    await agent.skill("market-environment-analysis");
    expect((await agent.getSessionMetadata())?.id).toBe(metadata?.id);
    expect(JSON.stringify(requests.at(-1))).toContain("permitted modes: exchange calendar helper");
    expect(JSON.stringify(requests.at(-1))).toContain("Other modes remain unavailable");
    expect(JSON.stringify(requests.at(-1))).toContain("Preserve this original research");
    const available = await agent.getSkills();
    expect(available[0]!.readiness?.modes.map(mode => mode.status)).toEqual(["blocked", "requirements-met"]);
    expect(available[0]!.description.match(/permitted modes/g)).toHaveLength(1);
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python",
      packages: { requests: "2.32.0", yfinance: null, "pandas-market-calendars": "5.2.2" },
      imports: { "pandas-market-calendars": { status: "missing", error: "ImportError" } } }), stderr: "" }), ["pandas-market-calendars"]);
    const afterImport = await agent.getSessionEntries(), requestCount = requests.length;
    await expect(agent.skill("market-environment-analysis")).rejects.toThrow("blocked");
    expect(requests).toHaveLength(requestCount);
    expect(await agent.getSessionEntries()).toEqual(afterImport);

    skills = [{ ...skills[0]!, name: "llmquant-risk", filePath: join(root, "LLMQuant-skills", "skills", "llmquant-risk", "SKILL.md") }]; revision++;
    await agent.skill("llmquant-risk");
    expect(JSON.stringify(requests.at(-1))).toContain("limited supplied evidence (needs-input)");
    expect(JSON.stringify(requests.at(-1))).toContain("Ask for missing task inputs before analysis or script execution");
    const session = await dependencies.sessions.open(metadata!);
    await session.appendActiveToolsChange([]);
    await agent.resumeSession(metadata!.id);
    expect((await agent.getSkills())[0]!.readiness?.status).toBe("blocked");
    const calls = requests.length;
    await expect(agent.skill("llmquant-risk")).rejects.toThrow("blocked");
    expect(requests).toHaveLength(calls);
  } finally {
    if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  }
});

it("activates a checked network skill with reviewed file evidence in the same Pi session, then revokes it", async () => {
  const previousSkills = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  dependencies.tools[0]!.name = "bash";
  dependencies.prepareSkills = (items, tools) => prepareRuntimeSkills(items, tools, root, {
    readReviewedFiles: () => ({ requirement: SCRIPT_FILES_REQUIREMENT, status: "available", reason: "Pinned-file fixture already checked." }),
  });
  dependencies.readSkillRevision = () => `${skillPythonRevision(root)}:${skillNetworkRevision(root)}`;
  dependencies.prompts.system = ({ skills }) => formatSkillsForSystemPrompt(skills);
  skills = [{ ...skills[0]!, name: "market-breadth-analyzer", filePath: join(root, "tradermonty-claude-trading-skills", "skills", "market-breadth-analyzer", "SKILL.md") }];
  try {
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python", packages: { requests: "2.32.0", yfinance: null, "pandas-market-calendars": null } }), stderr: "" }));
    agent = createAgent({ dependencies });
    await agent.prompt("Keep this original research");
    const metadata = await agent.getSessionMetadata(), entries = await agent.getSessionEntries();
    await expect(agent.skill("market-breadth-analyzer")).rejects.toThrow("unverified");
    expect(requests).toHaveLength(1); expect(await agent.getSessionEntries()).toEqual(entries);
    await checkSkillNetwork(root, undefined, async () => ({ stdout: JSON.stringify({ ok: true, reason: "observed", executable: "fixture-python", latestDate: "2026-09-15", detailRows: 100, summaryRows: 10 }), stderr: "" }));
    await expect(agent.skill("market-breadth-analyzer")).rejects.toThrow("unverified");
    expect(requests).toHaveLength(1); expect(await agent.getSessionEntries()).toEqual(entries);
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python",
      packages: { requests: "2.32.0", yfinance: null, "pandas-market-calendars": null },
      imports: { requests: { status: "available" } } }), stderr: "" }), ["requests"]);
    await agent.skill("market-breadth-analyzer");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests.at(-1))).toContain("public CSV analysis");
    expect((await agent.getSessionMetadata())?.id).toBe(metadata?.id);
    await checkSkillNetwork(root, undefined, async () => ({ stdout: JSON.stringify({ ok: false, reason: "http-503", executable: "fixture-python" }), stderr: "" }));
    const saved = await agent.getSessionEntries();
    await expect(agent.skill("market-breadth-analyzer")).rejects.toThrow("blocked");
    expect(requests).toHaveLength(2); expect(await agent.getSessionEntries()).toEqual(saved);
    expect((await agent.getSkills())[0]?.disableModelInvocation).toBe(true);
  } finally {
    if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  }
});

it("refreshes a missing-script diagnosis in the same Pi session without provider or journal effects", async () => {
  const previousSkills = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  dependencies.tools[0]!.name = "bash";
  dependencies.prepareSkills = (items, tools) => prepareRuntimeSkills(items, tools, root);
  dependencies.readSkillRevision = () => `${skillPythonRevision(root)}:${skillFileRevision(root)}`;
  skills = [{ ...skills[0]!, name: "technical-analyst", filePath: join(root, "tradermonty-claude-trading-skills", "skills", "technical-analyst", "SKILL.md") }];
  const files = CURATED_SKILL_REPOSITORIES[1]!.skills.find(skill => skill.name === "technical-analyst")!.reviewedFiles!;
  try {
    agent = createAgent({ dependencies });
    await agent.prompt("Preserve original research");
    const metadata = await agent.getSessionMetadata(), entries = await agent.getSessionEntries();
    await expect(agent.skill("technical-analyst")).rejects.toThrow("unverified");
    checkSkillFiles(root, skills[0]!.filePath, files);
    expect((await agent.getSkills())[0]!.readiness?.status).toBe("blocked");
    await expect(agent.skill("technical-analyst")).rejects.toThrow("blocked");
    expect(requests).toHaveLength(1);
    expect(await agent.getSessionEntries()).toEqual(entries);
    expect(await agent.getSessionMetadata()).toEqual(metadata);
  } finally {
    if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  }
});

it("keeps macro skill unavailable in the same Pi session when ETF access works but pinned scripts are missing", async () => {
  const previousSkills = process.env.OHQUANT_SKILLS_DIR;
  process.env.OHQUANT_SKILLS_DIR = root;
  dependencies.tools[0]!.name = "bash";
  dependencies.prepareSkills = (items, tools) => prepareRuntimeSkills(items, tools, root);
  dependencies.readSkillRevision = () => `${skillPythonRevision(root)}:${skillEtfRevision(root)}:${skillFileRevision(root)}`;
  dependencies.prompts.system = ({ skills }) => formatSkillsForSystemPrompt(skills);
  skills = [{ ...skills[0]!, name: "macro-regime-detector", filePath: join(root, "tradermonty-claude-trading-skills", "skills", "macro-regime-detector", "SKILL.md") }];
  const files = CURATED_SKILL_REPOSITORIES[1]!.skills.find(item => item.name === "macro-regime-detector")!.reviewedFiles!;
  try {
    await checkSkillPython(root, undefined, async () => ({ stdout: JSON.stringify({ python: "3.12.1", executable: "fixture-python",
      packages: { requests: "2.32.0", yfinance: "1.4.0", "pandas-market-calendars": null } }), stderr: "" }));
    agent = createAgent({ dependencies });
    await agent.prompt("Preserve macro research context");
    const entries = await agent.getSessionEntries(), metadata = await agent.getSessionMetadata();
    await expect(agent.skill("macro-regime-detector")).rejects.toThrow("unverified");
    await checkEtfNetwork(root, undefined, async () => ({ stdout: JSON.stringify({ ok: true, reason: "observed", executable: "fixture-python",
      symbols: 9, minimumBars: 500, latestDate: new Date().toISOString().slice(0, 10), oldestDate: "2024-01-02" }), stderr: "" }));
    expect((await agent.getSkills())[0]!.readiness?.status).toBe("unverified");
    checkSkillFiles(root, skills[0]!.filePath, files);
    const checked = (await agent.getSkills())[0]!;
    expect(checked.readiness?.status).toBe("blocked");
    expect(checked.readiness?.modes[0]?.requirements.find(item => item.requirement === "network:etf-history")?.status).toBe("available");
    expect(checked.readiness?.modes[0]?.requirements.find(item => item.requirement === "reviewed-script-files")?.status).toBe("missing");
    await expect(agent.skill("macro-regime-detector")).rejects.toThrow("blocked");
    expect(requests).toHaveLength(1);
    expect(await agent.getSessionEntries()).toEqual(entries);
    expect(await agent.getSessionMetadata()).toEqual(metadata);
    expect(JSON.stringify(requests[0])).not.toContain("macro-regime-detector");
  } finally {
    if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  }
});

it("refreshes published skills between independent requests while tool loops and queued turns keep their snapshot", async () => {
  let revision = "initial", changed = false;
  dependencies.readSkillRevision = () => revision;
  callTool = true;
  agent = createAgent({ dependencies });
  agent.subscribe(async event => {
    if (event.type !== "before_provider_payload" || changed) return;
    changed = true;
    skills = [{ ...skills[0]!, name: "new-research", content: "NEW_SKILL_CONTENT" }];
    revision = "published";
    expect((await agent!.getSkills()).map(skill => skill.name)).toEqual(["fixture-research"]);
    await agent!.followUp({ role: "user", content: "queued original research", timestamp: 0 });
  });
  await agent.prompt("Initial research");
  expect(requests.length).toBeGreaterThanOrEqual(3);
  expect(requests.every(request => JSON.stringify(request.body.messages).includes("Skills: fixture-research"))).toBe(true);
  expect(JSON.stringify(requests)).not.toContain("Skills: new-research");
  const metadata = await agent.getSessionMetadata(), entries = await agent.getSessionEntries(), leaf = await agent.getLeafId();
  expect((await agent.getSkills()).map(skill => skill.name)).toEqual(["new-research"]);
  expect(await agent.getSessionMetadata()).toEqual(metadata);
  expect(await agent.getSessionEntries()).toEqual(entries);
  expect(await agent.getLeafId()).toBe(leaf);
  await agent.skill("new-research");
  expect(JSON.stringify(requests.at(-1))).toContain("NEW_SKILL_CONTENT");
  expect(JSON.stringify(requests.at(-1))).toContain("Skills: new-research");
  expect(JSON.stringify(requests.at(-1))).toContain("Initial research");
  skills = []; revision = "disabled";
  await agent.prompt("Independent request after removal");
  expect((await agent.getSkills())).toEqual([]);
  const system = requests.at(-1)!.body.messages[0];
  expect(JSON.stringify(system)).not.toContain("new-research");
  await expect(agent.skill("new-research")).rejects.toThrow("Unknown skill");
});

it("retains the journal and old resources on refresh failures and retries the same revision", async () => {
  let revision = "initial";
  dependencies.readSkillRevision = () => revision;
  agent = createAgent({ dependencies });
  await agent.prompt("Keep this research");
  const entries = await agent.getSessionEntries(), prompt = agent.state.systemPrompt;
  revision = "update"; failSkills = true;
  await expect(agent.getSkills()).rejects.toThrow("skill loader failure");
  expect(await agent.getSessionEntries()).toEqual(entries);
  expect(agent.state.systemPrompt).toBe(prompt);
  failSkills = false; skills.push({ ...skills[0]! });
  await expect(agent.getSkills()).rejects.toThrow("Duplicate skill names");
  expect(agent.state.systemPrompt).toBe(prompt);
  skills = [{ ...skills[0]!, name: "replacement" }];
  const system = dependencies.prompts.system;
  dependencies.prompts.system = () => { throw new Error("Rejected replacement prompt"); };
  await expect(agent.getSkills()).rejects.toThrow("Rejected replacement prompt");
  expect(agent.state.systemPrompt).toBe(prompt);
  dependencies.prompts.system = system;
  expect((await agent.getSkills()).map(skill => skill.name)).toEqual(["replacement"]);
  expect(await agent.getSessionEntries()).toEqual(entries);
  expect(requests).toHaveLength(1);
});

it("defers refresh during compaction even when no assistant message is streaming", async () => {
  let revision = "initial";
  dependencies.readSkillRevision = () => revision;
  agent = createAgent({ dependencies });
  await agent.prompt("Research to compact");
  blockAuth = true;
  const started = new Promise<void>(resolve => { onAuth = resolve; });
  const compacting = agent.compact();
  const settled = Promise.allSettled([compacting]);
  await started;
  expect(agent.state.isStreaming).toBe(false);
  skills = [{ ...skills[0]!, name: "after-compaction" }]; revision = "updated";
  expect((await agent.getSkills()).map(skill => skill.name)).toEqual(["fixture-research"]);
  agent.abort(); await settled; await agent.waitForIdle();
  blockAuth = false;
  expect((await agent.getSkills()).map(skill => skill.name)).toEqual(["after-compaction"]);
  await agent.prompt("Continue original research");
  expect(JSON.stringify(requests.at(-1))).toContain("Research to compact");
});

it("does not commit a late skill refresh into a switched session", async () => {
  let revision = "initial";
  dependencies.readSkillRevision = () => revision;
  agent = createAgent({ dependencies });
  await agent.prompt("Original branch");
  const metadata = (await agent.getSessionMetadata())!;
  const originalLoad = dependencies.loadSkills;
  let release!: (skills: QuantSkill[]) => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  // The constructor snapshots the dependency object; use a shared loader closure.
  let delayed = false;
  const loader = async () => delayed ? new Promise<QuantSkill[]>(resolve => { release = resolve; entered(); }) : originalLoad();
  const next = createAgent({ dependencies: { ...dependencies, loadSkills: loader } });
  try {
    await next.waitForIdle();
    revision = "refresh"; delayed = true;
    const refreshing = next.getSkills();
    await started;
    delayed = false; skills = [{ ...skills[0]!, name: "switched-skill" }]; revision = "switched";
    await next.resumeSession(metadata.id);
    release([{ ...skills[0]!, name: "late-old-skill" }]);
    await refreshing;
    expect((await next.getSkills()).map(skill => skill.name)).toEqual(["switched-skill"]);
    expect(next.state.systemPrompt).toContain("switched-skill");
    expect(next.state.systemPrompt).not.toContain("late-old-skill");
    expect((await next.getSessionMetadata())!.id).toBe(metadata.id);
  } finally { next.abort(); await next.waitForIdle(); }
});

it("restores, compresses and navigates through the supplied repo, preserving the current session on loader/open failures", async () => {
  agent = createAgent({ dependencies });
  await agent.prompt("original fixture request");
  const metadata = (await agent.getSessionMetadata())!, originalLeaf = (await agent.getLeafId())!;
  await agent.prompt("second fixture request");
  expect((await agent.compact()).summary).toContain("Injected session response");
  const savedEntries = await agent.getSessionEntries();
  failSkills = true;
  await expect(agent.resumeSession(metadata.id)).rejects.toThrow("skill loader failure");
  expect(await agent.getSessionEntries()).toEqual(savedEntries);
  failSkills = false;
  const open = dependencies.sessions.open;
  dependencies.sessions.open = async () => { throw new Error("Injected repo failure"); };
  await expect(agent.resumeSession(metadata.id)).rejects.toThrow("Injected repo failure");
  expect(await agent.getSessionEntries()).toEqual(savedEntries);
  dependencies.sessions.open = open;
  await agent.navigateTree(originalLeaf, { summarize: true });
  expect((await agent.getSessionBranch()).some(entry => entry.type === "branch_summary")).toBe(true);
  agent.reset(); await agent.waitForIdle();
  expect(agent.state.messages).toEqual([]);
  await agent.resumeSession(metadata.id);
  await agent.prompt("Continue restored research");
  expect(JSON.stringify(requests.at(-1))).toContain("original fixture request");
  expect(readdirSync(root)).toEqual(["settings.json"]);
});

it.each(["tool", "auth"] as const)("cancels injected %s work and remains usable", async target => {
  callTool = target === "tool"; blockTool = target === "tool"; blockAuth = target === "auth";
  const started = new Promise<void>(resolve => { if (target === "tool") onTool = resolve; else onAuth = resolve; });
  agent = createAgent({ dependencies });
  const prompting = agent.prompt("Compute fixture observations");
  await started; agent.abort(); await prompting; await agent.waitForIdle();
  expect(agent.state.isStreaming).toBe(false); expect(agent.state.pendingToolCalls.size).toBe(0);
  if (target === "auth") expect(requests).toHaveLength(0);
  blockTool = false; blockAuth = false; callTool = false;
  await agent.prompt("Recover after cancellation");
  expect(agent.state.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
});

it("snapshots tool schemas and skill values and rejects ambiguous names without falling back to builtins", async () => {
  agent = createAgent({ dependencies }); await agent.waitForIdle();
  const tool = dependencies.tools[0]!;
  tool.name = "changed-outside";
  Object.assign(tool.parameters, { properties: {} });
  skills[0]!.content = "changed-outside";
  const returned = await agent.getSkills(); returned[0]!.name = "changed-return-value";
  await agent.skill("fixture-research");
  expect(JSON.stringify(requests[0])).toContain("FIXTURE_SKILL_CONTENT");
  expect(requests[0]!.body.tools![0]!.function.name).toBe("sample_mean");
  expect(JSON.stringify(requests[0])).toContain("values");
  expect((await agent.getSkills())[0]!.name).toBe("fixture-research");
  expect(() => createAgent({ dependencies: { ...dependencies, tools: [tool, tool] } })).toThrow("Duplicate tool names");
  skills.push({ ...skills[0]! });
  const before = await agent.getSessionMetadata();
  await expect(agent.resumeSession(before!.id)).rejects.toThrow("Duplicate skill names");
  expect(await agent.getSessionMetadata()).toEqual(before);
});

it("does not reactivate tools absent from a restored active-tool selection", async () => {
  const session = await dependencies.sessions.create({ cwd: root });
  await session.appendActiveToolsChange(["unavailable-old-tool"]);
  agent = createAgent({ dependencies });
  await agent.resumeSession((await session.getMetadata()).id);
  expect(agent.state.tools).toEqual([]);
  await agent.prompt("Explain the currently available tools");
  expect(requests.at(-1)!.body.tools ?? []).toEqual([]);
  expect(JSON.stringify(requests.at(-1))).not.toContain("Tools: sample_mean");
  expect((await agent.getResearchState()).availableTools).toEqual([]);
});

it("does not move a report's source branch when an injected preparation port fails", async () => {
  agent = createAgent({ dependencies });
  await agent.prompt("First report source");
  const first = await agent.getSessionBranch();
  const metadata = (await agent.getSessionMetadata())!;
  const report = { version: 1 as const, scope: "branch" as const, sessionHash: "recorded", entryHash: createHash("sha256").update(JSON.stringify(first)).digest("hex"),
    leafId: first.at(-1)!.id, entryIds: first.map(entry => entry.id), datasets: [] };
  await agent.prompt("Later active research");
  const current = await agent.getLeafId(), entries = await agent.getSessionEntries();
  failVerification = true;
  await expect(agent.resumeSession(metadata.id, { report })).rejects.toThrow("Injected evidence failure");
  expect(await agent.getLeafId()).toBe(current);
  expect(await agent.getSessionEntries()).toEqual(entries);
  failVerification = false;
  await agent.resumeSession(metadata.id, { report });
  expect(await agent.getLeafId()).toBe(report.leafId);
});

it("keeps default legacy restoration and lazy auth on the captured environment until the next connection", async () => {
  const keys = ["WHYJ_QUANT_BASE_URL", "WHYJ_QUANT_CONTEXT_WINDOW", "WHYJ_QUANT_COMPACT_TRIGGER_TOKENS", "WHYJ_QUANT_API_KEY"] as const;
  const before = keys.map(key => process.env[key]);
  writeFileSync(join(root, "settings.json"), JSON.stringify({ ...DEFAULT_SETTINGS, model: "fixture-legacy", env: {} }));
  try {
    Object.assign(process.env, { WHYJ_QUANT_BASE_URL: "http://127.0.0.1/first/anthropic", WHYJ_QUANT_CONTEXT_WINDOW: "250000",
      WHYJ_QUANT_COMPACT_TRIGGER_TOKENS: "200000", WHYJ_QUANT_API_KEY: "fixture-old-key" });
    const local = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions") });
    const connection = local.readConnection();
    Object.assign(process.env, { WHYJ_QUANT_BASE_URL: "http://127.0.0.1/second/anthropic", WHYJ_QUANT_CONTEXT_WINDOW: "300000",
      WHYJ_QUANT_COMPACT_TRIGGER_TOKENS: "260000", WHYJ_QUANT_API_KEY: "fixture-new-key" });
    const restored = connection.restore!({ messages: [], model: { provider: "anthropic", modelId: "fixture-previous-model" }, thinkingLevel: "low", activeToolNames: null });
    expect(restored).toMatchObject({ model: { id: "fixture-previous-model", baseUrl: "http://127.0.0.1/first/anthropic", contextWindow: 250000 }, thinkingLevel: "low" });
    expect(connection.compactTriggerTokens).toBe(200000);
    expect((await connection.getAuth(restored.model))?.apiKey).toBe("fixture-old-key");
    const next = local.readConnection();
    expect(next.model).toMatchObject({ baseUrl: "http://127.0.0.1/second/anthropic", contextWindow: 300000 });
    expect(next.compactTriggerTokens).toBe(260000);
    expect((await next.getAuth(next.model))?.apiKey).toBe("fixture-new-key");
  } finally {
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
  }
});
