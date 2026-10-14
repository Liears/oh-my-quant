import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { AppRuntime, createInitialAppState } from "../../app-runtime.ts";
import { createDefaultSessionDependencies } from "../../runtime/session-dependencies.ts";
import type { QuantAgentSession } from "../../agent/src/session-contracts.ts";
import { createQuantResearchAgent } from "../../runtime/quant-harness.ts";
import { CURATED_SKILL_REPOSITORIES } from "../../skill/catalog.ts";
import * as git from "../../skill/git.ts";
import { skillPaths } from "../../runtime/skills/skill-store.ts";
import { saveSettings } from "../../storage/index.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { bashTool } from "../../tools/bash-tool.ts";
import { nextInputAction, type InputAction } from "../src/input.ts";
import { QuantTui } from "../src/tui.ts";

let root: string, cwd: string, previous: string | undefined, previousSkills: string | undefined, proxy: string | undefined;
let server: ReturnType<typeof Bun.serve>, transport: ReturnType<typeof spyOn<typeof git, "runSkillGit">>;
let offline: boolean, requests: number, reads: number, paused: boolean;
let releaseFetch: () => void, enteredFetch: Promise<void>, markEntered: () => void;
let calls: string[][], payloads: Record<string, unknown>[];
const origins = new Map<string, string>();
const hosts: Array<{ runtime: AppRuntime; agent: QuantAgentSession }> = [];
const llmquant = CURATED_SKILL_REPOSITORIES[0]!;

function seed(directory: string): void {
  mkdirSync(join(directory, ".git"), { recursive: true });
  for (const skill of llmquant.skills) {
    const path = join(directory, "skills", skill.name); mkdirSync(path, { recursive: true });
    if (skill.name === "llmquant-risk") cpSync(join(import.meta.dir, "../../runtime/test/fixtures/skills/LLMQuant-skills/skills/llmquant-risk"), path, { recursive: true });
    else writeFileSync(join(path, "SKILL.md"), `---\nname: ${skill.name}\ndescription: Synthetic unchecked entry\n---\nNo reviewed workflows staged.`);
  }
  origins.set(directory, "https://github.com/LLMQuant/skills.git");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-skill-startup-ui-")); cwd = process.cwd();
  previous = process.env.OHQUANT_DIR; previousSkills = process.env.OHQUANT_SKILLS_DIR; proxy = process.env.NO_PROXY;
  process.env.OHQUANT_DIR = join(root, "preferences"); process.env.OHQUANT_SKILLS_DIR = join(root, "skills");
  process.env.NO_PROXY = "127.0.0.1,localhost"; process.chdir(root); mkdirSync(join(root, ".git"));
  offline = true; requests = 0; reads = 0; paused = false; calls = []; payloads = []; origins.clear();
  enteredFetch = new Promise(resolve => { markEntered = resolve; }); releaseFetch = () => {};
  transport = spyOn(git, "runSkillGit").mockImplementation(async (args, _timeout, signal) => {
    calls.push([...args]); signal?.throwIfAborted();
    if (args[0] === "init") { mkdirSync(join(args[1]!, ".git")); return ""; }
    const directory = args[1]!;
    if (args.includes("add")) { origins.set(directory, args.at(-1)!); return ""; }
    if (args.includes("fetch")) {
      markEntered();
      if (paused) {
        paused = false;
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(signal?.reason);
          signal?.addEventListener("abort", abort, { once: true });
          releaseFetch = () => { signal?.removeEventListener("abort", abort); resolve(); };
          if (signal?.aborted) abort();
        });
      }
      if (offline) throw new Error("Synthetic Git transport offline");
      return "";
    }
    if (args.includes("checkout")) { seed(directory); return ""; }
    if (args.includes("--show-toplevel")) return directory;
    if (args.includes("get-url")) return origins.get(directory) ?? "";
    if (args.includes("status")) {
      const file = join(directory, "skills/llmquant-risk/workflows/research-health-check.md");
      return readFileSync(file, "utf8").includes("LOCAL_EDIT") ? " M skills/llmquant-risk/workflows/research-health-check.md" : "";
    }
    return llmquant.revision;
  });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(incoming) {
    const payload = await incoming.json() as Record<string, unknown>; payloads.push(payload); requests++;
    const call = requests === 1, workflow = join(root, "skills/LLMQuant-skills/skills/llmquant-risk/workflows/research-health-check.md");
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: "startup-read", type: "function", function: {
      name: "bash", arguments: JSON.stringify({ command: `Get-Content -LiteralPath '${workflow}'` }),
    } }] } : { role: "assistant", content: "STARTUP_WORKFLOW_READ. Synthetic supplied-input exercise; no live data or mutation." };
    const chunk = { id: "startup", object: "chat.completion.chunk", created: 0, model: "startup-fixture" };
    return new Response([{ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] }]
      .map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "startup-fixture"; settings.thinkingLevel = "off";
  settings.providers = { custom: { api: "openai-completions", baseUrl: `${server.url}v1`, apiKey: "synthetic-startup-key" } };
  settings.skillIntegrations.external = false; saveSettings(settings);
});

afterEach(async () => {
  releaseFetch();
  for (const { runtime, agent } of hosts.splice(0)) { await runtime.shutdown(); agent.abort(); await agent.waitForIdle(); }
  transport.mockRestore(); server.stop(true); process.chdir(cwd);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
  if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
  const within = relative(realpathSync(tmpdir()), realpathSync(root));
  if (!within.startsWith("whyj-skill-startup-ui-") || within.includes(sep)) throw new Error("Unsafe startup fixture cleanup");
  rmSync(root, { recursive: true, force: true });
});

async function host() {
  const dependencies = createDefaultSessionDependencies({ cwd: root, sessionsRoot: join(root, "sessions"), skillPaths });
  dependencies.tools = [{ ...bashTool, async execute(_id, args, signal) {
    signal?.throwIfAborted();
    const workflow = join(root, "skills/LLMQuant-skills/skills/llmquant-risk/workflows/research-health-check.md");
    if (!args || typeof args !== "object" || !("command" in args) || args.command !== `Get-Content -LiteralPath '${workflow}'`)
      throw new Error("Only the fixture workflow may be read");
    reads++; return { content: [{ type: "text", text: readFileSync(workflow, "utf8") }], details: { fixtureRead: true } };
  } }];
  const agent = createQuantResearchAgent({ dependencies });
  const tui = new QuantTui(createInitialAppState("startup-fixture"));
  tui.screen.out = { columns: 120, rows: 32, write: () => true } as unknown as NodeJS.WriteStream; tui.screen.resize();
  let refresh = Promise.resolve(), exited = false;
  const runtime = new AppRuntime({ onMessages: messages => tui.update({ messages }), onActivity: activity => tui.update({ activity }),
    onComposerStatus: composerStatus => tui.update({ composerStatus }), onModel: model => tui.update(model),
    onHelpRequest: () => tui.openHelp(), onSkillsChanged: () => { refresh = tui.refreshSkills(() => runtime.getSkillSuggestions()); } },
  async () => [], async () => [], () => agent);
  hosts.push({ runtime, agent });
  const pending: Promise<unknown>[] = [];
  tui.onSubmit(text => { pending.push(runtime.submit(text).then(async result => { if (result === "exit") { await runtime.shutdown(); exited = true; } })); });
  await runtime.bootstrap(); await tui.refreshSkills(() => runtime.getSkillSuggestions());
  const dispatch = Reflect.get(tui, "handleKeyAction").bind(tui) as (action: Extract<InputAction, { type: "key" }>) => void;
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await refresh; };
  const send = async (text: string) => {
    let input = text + "\r";
    while (input) { const decoded = nextInputAction(input); input = decoded.rest;
      if (!decoded.action) throw new Error("Incomplete fixture keyboard input");
      if (decoded.action.type === "key") dispatch(decoded.action);
    }
    await drain();
  };
  const escape = async () => { dispatch({ type: "key", name: "escape", ctrl: false, shift: false, meta: false }); await drain(); };
  return { runtime, agent, tui, send, escape, exited: () => exited };
}

it("keeps help usable during first installation, exposes failure/retry, then discovers and invokes only the checked mode in the same session", async () => {
  const app = await host(); const session = (await app.agent.getSessionMetadata())!.id;
  expect(await app.agent.getSkills()).toEqual([]);
  paused = true;
  const install = app.runtime.startSkillInstallation(); await enteredFetch;
  expect(app.tui.state.messages.some(message => message.text?.includes("Installing LLMQuant/skills"))).toBe(true);
  await app.send("/help"); await app.escape();
  expect(app.exited()).toBe(false); expect(requests).toBe(0);
  releaseFetch(); await install;
  expect(app.tui.state.messages.some(message => message.role === "error" && message.text?.includes("retry /skill install LLMQuant/skills"))).toBe(true);
  expect(await app.agent.getSkills()).toEqual([]);
  offline = false; await app.send("/skill install LLMQuant/skills");
  expect((await app.agent.getSkills()).map(skill => skill.name).sort()).toEqual(llmquant.skills.map(skill => skill.name).sort());
  expect((await app.agent.getSkills()).find(skill => skill.name === "llmquant-risk")!.disableModelInvocation).toBe(true);
  await app.send("/skill:llmquant-risk Read supplied material only"); expect(requests).toBe(0);
  await app.send("/skill info llmquant-risk --check");
  const checked = (await app.agent.getSkills()).find(skill => skill.name === "llmquant-risk")!;
  expect(checked.readiness!.modes.map(mode => mode.status)).toEqual(["blocked", "needs-input"]);
  expect(checked.disableModelInvocation).toBe(false);
  await app.send("/skill:llmquant-risk Read supplied material only");
  expect(requests).toBe(2); expect(reads).toBe(1);
  expect(JSON.stringify(payloads[0])).toContain("limited supplied evidence");
  expect(JSON.stringify(payloads[0])).toContain("<skill");
  expect(app.tui.state.messages.some(message => message.text?.includes("STARTUP_WORKFLOW_READ"))).toBe(true);
  expect((await app.agent.getSessionMetadata())!.id).toBe(session);
  expect(app.tui.state.messages.some(message => message.role === "skill" && message.skill?.status === "done")).toBe(true);
});

it("discovers existing skills offline, refuses to update local edits, and revokes a changed workflow without making a model request", async () => {
  const directory = join(root, "skills/LLMQuant-skills"); seed(directory);
  mkdirSync(join(root, "skills/tradermonty-claude-trading-skills"));
  const app = await host(); await app.runtime.startSkillInstallation();
  expect(calls).toHaveLength(0); expect((await app.agent.getSkills()).length).toBe(5);
  await app.send("/skill info llmquant-risk --check");
  expect((await app.agent.getSkills()).find(skill => skill.name === "llmquant-risk")!.disableModelInvocation).toBe(false);
  const workflow = join(directory, "skills/llmquant-risk/workflows/research-health-check.md");
  const original = readFileSync(workflow, "utf8"), modified = original + "\nLOCAL_EDIT\n"; writeFileSync(workflow, modified);
  await app.send("/skill install LLMQuant/skills");
  expect(app.tui.state.messages.some(message => message.role === "error" && message.text?.includes("Local changes"))).toBe(true);
  expect(readFileSync(workflow, "utf8")).toBe(modified); expect(calls.some(args => args.includes("fetch"))).toBe(false);
  await app.send("/skill:llmquant-risk Read supplied material only");
  expect(requests).toBe(0); expect(reads).toBe(0); expect(readFileSync(workflow, "utf8")).toBe(modified);
  expect((await app.agent.getSkills()).find(skill => skill.name === "llmquant-risk")!.disableModelInvocation).toBe(true);
  writeFileSync(workflow, original);
  await app.send("/skill:llmquant-risk Read supplied material only");
  expect(requests).toBe(0); expect(reads).toBe(0);
  await app.send("/skill info llmquant-risk --check");
  await app.send("/skill:llmquant-risk Read supplied material only");
  expect(requests).toBe(2); expect(reads).toBe(1);
});

it("routes terminal exit through startup cancellation and cleanup before another repository can begin", async () => {
  const app = await host(); paused = true;
  const install = app.runtime.startSkillInstallation(); await enteredFetch;
  const messages = structuredClone(app.tui.state.messages);
  await app.escape(); await install;
  expect(app.exited()).toBe(true); expect(requests).toBe(0);
  expect(calls.filter(args => args.includes("fetch"))).toHaveLength(1);
  expect(readdirSync(join(root, "skills"))).toEqual([]);
  expect(app.tui.state.messages).toEqual(messages);
});
