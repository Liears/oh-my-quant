import type { QuantAgentContextUsage, QuantAgentDependencies, QuantAgentEvent, QuantAgentImageOptions, QuantSessionOptions, QuantAgentSession, QuantAgentState, QuantModelConnection } from './session-contracts.ts';
import { EphemeralChartImages, modelImageInputCheck } from './chart-images.ts';
export type * from './session-contracts.ts';
import { createSessionContext, reduceAgentState, applySessionContextState, isForwardedAgentEvent } from './session-state.ts';
export { resolveModelId, inferModelId, resolveContextWindow, resolveCompactTriggerTokens } from "./model-config.ts";
import {
  AgentHarness,
  type CompactResult,
  type JsonlSessionMetadata,
  type NavigateTreeResult,
  estimateTokens as piEstimateTokens,
  estimateContextTokens as piEstimateContextTokens,
  type AgentMessage,
  type AgentTool,
  type Session,
  type SessionTreeEntry,
} from "./session-runtime/index.ts";
import type { SessionCtx } from "./context.ts";
import type { QuantSkill } from "./skills.ts";
import { createCustomMessage } from "./session-runtime/harness/messages.ts";
import { buildSessionContext } from "./session-runtime/harness/session/session.ts";
import { perfLog, perfNow } from "../../perf.ts";
import { createHash } from "node:crypto";
import type { ReportProvenance } from "../../types/research-evidence.ts";
import { projectResearchState, formatResearchContext, type ResearchState } from "../../research/state.ts";
import { inferMarket } from "../../market/symbols.ts";
import { inferResultShape } from "./tool-result-shape.ts";
import type { SkillRequirementCheck } from "../../types/skills.ts";

function createEmptyState(connection: QuantModelConnection, tools: AgentTool[], systemPrompt: string): QuantAgentState {
  return {
    systemPrompt,
    model: connection.model,
    thinkingLevel: connection.thinkingLevel,
    tools: [...tools],
    messages: [],
    isStreaming: false,
    streamingMessage: undefined,
    thinkingText: "",
    pendingToolCalls: new Set<string>(),
    errorMessage: undefined,
  };
}

class QuantAgentHarnessSession implements QuantAgentSession {
  readonly state: QuantAgentState;
  private sessionCtx = createSessionContext();

  updateContext(update: Partial<SessionCtx>): void {
    this.sessionCtx = { ...this.sessionCtx, ...update, recentToolState: { ...this.sessionCtx.recentToolState, ...update.recentToolState } };
  }

  private readonly listeners = new Set<(event: QuantAgentEvent, signal?: AbortSignal) => Promise<void> | void>();
  private readonly cwd: string;
  private readonly dependencies: QuantAgentDependencies;
  private readonly tools: AgentTool[];
  private toolRevision: string | undefined;
  private extensionSkills: QuantSkill[] = [];
  private skillCapabilities: Readonly<Record<string, SkillRequirementCheck>> = {};
  private automaticToolSelection = true;
  private skills: QuantSkill[] = [];
  private rawSkills: QuantSkill[] = [];
  private skillRevision: string | undefined;
  private skillRefresh: Promise<void> | undefined;
  private connection: QuantModelConnection;
  private initVersion = 0;
  private harness: AgentHarness<QuantSkill> | null = null;
  private session: Session<JsonlSessionMetadata> | null = null;
  private ready: Promise<void>;
  private readonly chartImages = new EphemeralChartImages();

  constructor(options: QuantSessionOptions) {
    this.dependencies = { ...options.dependencies };
    this.cwd = options.cwd ?? this.dependencies.env.cwd;
    this.tools = copyTools(this.dependencies.tools);
    this.connection = this.readConnection();
    this.state = createEmptyState(this.connection, this.tools, this.dependencies.prompts.system({ tools: this.tools, skills: [] }));
    this.ready = this.initialize({ connection: this.connection });
  }

  subscribe(listener: (event: QuantAgentEvent, signal?: AbortSignal) => Promise<void> | void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(input: string, options?: QuantAgentImageOptions & { displayText?: string }): Promise<void> {
    options?.signal?.throwIfAborted();
    const readyStartedAt = perfNow();
    await this.ready;
    options?.signal?.throwIfAborted();
    perfLog("agent.ready.wait", readyStartedAt, { phase: "prompt" });
    if (!this.harness) throw new Error("Agent harness not initialized");
    if (options?.images !== undefined && !this.harness.isIdle) throw new Error("Wait for the current request to finish before attaching a chart image.");
    const abort = () => this.abort();
    let chartId: string | undefined;
    options?.signal?.addEventListener("abort", abort, { once: true });
    try {
      await this.syncModelSettings();
      await this.syncSkills();
      options?.signal?.throwIfAborted();
      let chartNote = "";
      if (options?.images !== undefined) {
        if (!this.harness.isIdle) throw new Error("Wait for the current request to finish before attaching a chart image.");
        const chart = this.chartImages.begin(options.images, this.harness.getModel());
        chartId = chart.id;
        chartNote = chart.note;
      }
      await this.maybeAutoCompact();
      options?.signal?.throwIfAborted();
      await this.refreshResearchContext();
      const prompt = this.dependencies.prompts.turn(input, this.sessionCtx) + chartNote;
      options?.signal?.throwIfAborted();
      const promptStartedAt = perfNow();
      await this.harness.prompt(prompt, { displayText: options?.displayText ?? input });
      perfLog("agent.prompt", promptStartedAt);
    } finally {
      if (chartId) this.chartImages.end(chartId);
      options?.signal?.removeEventListener("abort", abort);
    }
  }

  async steer(message: AgentMessage): Promise<void> {
    await this.ready;
    if (!this.harness) throw new Error("Agent harness not initialized");
    await this.harness.steer(this.dependencies.prompts.turn(extractMessageText(message), this.sessionCtx), { displayText: extractMessageDisplayText(message) ?? extractMessageText(message) });
  }

  async followUp(message: AgentMessage): Promise<void> {
    await this.ready;
    if (!this.harness) throw new Error("Agent harness not initialized");
    await this.harness.followUp(this.dependencies.prompts.turn(extractMessageText(message), this.sessionCtx), { displayText: extractMessageDisplayText(message) ?? extractMessageText(message) });
  }

  async skill(name: string, additionalInstructions?: string, options?: QuantAgentImageOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    await this.ready;
    options?.signal?.throwIfAborted();
    if (!this.harness) throw new Error("Agent harness not initialized");
    if (options?.images !== undefined && !this.harness.isIdle) throw new Error("Wait for the current request to finish before attaching a chart image.");
    const abort = () => this.abort();
    let chartId: string | undefined;
    options?.signal?.addEventListener("abort", abort, { once: true });
    try {
      await this.syncModelSettings();
      await this.syncSkills();
      const instructions = [this.dependencies.prompts.skill(name, additionalInstructions)];
      options?.signal?.throwIfAborted();
      if (options?.images !== undefined) {
        if (!this.harness.isIdle) throw new Error("Wait for the current request to finish before attaching a chart image.");
        const chart = this.chartImages.begin(options.images, this.harness.getModel());
        chartId = chart.id;
        instructions.push(chart.note);
      }
      await this.harness.skill(name, instructions.join("\n\n"), { displayText: `SKILL.${name}` });
    } finally {
      if (chartId) this.chartImages.end(chartId);
      options?.signal?.removeEventListener("abort", abort);
    }
  }

  async waitForIdle(): Promise<void> {
    const readyStartedAt = perfNow();
    await this.ready;
    perfLog("agent.ready.wait", readyStartedAt, { phase: "waitForIdle" });
    await this.harness?.waitForIdle();
  }

  async appendContextNote(customType: string, content: string, details?: unknown): Promise<void> {
    await this.ready;
    if (!this.harness) throw new Error("Agent harness not initialized");
    await this.harness.appendMessage(createCustomMessage(customType, content, false, details, new Date().toISOString()));
    await this.refreshStateFromSession();
  }

  async compact(customInstructions?: string): Promise<CompactResult> {
    await this.ready;
    if (!this.harness || !this.session) throw new Error("Agent harness not initialized");
    if (!this.state.isStreaming) await this.syncModelSettings();
    let result: CompactResult;
    try {
      result = await this.harness.compact(customInstructions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("requires idle harness") || message.includes("AgentHarness is busy")) {
        throw new Error("Agent is still running. Wait for the current response/tool call to finish, then run /compact again.");
      }
      throw error;
    }
    await this.refreshStateFromSession();
    return result;
  }

  async navigateTree(
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
  ): Promise<NavigateTreeResult> {
    await this.ready;
    if (!this.harness || !this.session) throw new Error("Agent harness not initialized");
    if (!this.state.isStreaming) await this.syncModelSettings();
    const result = await this.harness.navigateTree(targetId, options);
    if (!result.cancelled) this.sessionCtx = createSessionContext();
    await this.refreshStateFromSession(!result.cancelled);
    return result;
  }

  getContextUsage(): QuantAgentContextUsage | undefined {
    const contextWindow = this.state.model.contextWindow ?? 0;
    if (contextWindow <= 0) return undefined;
    const tokens = piEstimateContextTokens(this.chartImages.project(this.state.messages)).tokens;
    return {
      tokens,
      contextWindow,
      percent: contextWindow > 0 ? tokens / contextWindow * 100 : null,
    };
  }

  async getSessionMetadata(): Promise<JsonlSessionMetadata | null> {
    await this.ready;
    return await this.session?.getMetadata() ?? null;
  }

  async getSessionEntries(): Promise<SessionTreeEntry[]> {
    await this.ready;
    return await this.session?.getEntries() ?? [];
  }

  async getSessionBranch(fromId?: string): Promise<SessionTreeEntry[]> {
    await this.ready;
    if (!this.session) return [];
    return await this.session.getBranch(fromId);
  }

  async getLeafId(): Promise<string | null> {
    await this.ready;
    return await this.session?.getLeafId() ?? null;
  }

  async getResearchState(): Promise<ResearchState> {
    await this.ready;
    return projectResearchState(await this.session?.getBranch() ?? [], this.state.tools.map(tool => tool.name), this.dependencies.verifyResearch, this.dependencies.verifyReport);
  }

  async listSessions(): Promise<JsonlSessionMetadata[]> {
    await this.ready;
    return await this.dependencies.sessions.list({ cwd: this.cwd });
  }

  async resumeSession(sessionId: string, options?: { report?: ReportProvenance }): Promise<JsonlSessionMetadata> {
    await this.switchSession(sessionId, options?.report);
    const metadata = await this.getSessionMetadata();
    if (!metadata) throw new Error(`Session not found: ${sessionId}`);
    return metadata;
  }

  async getSkills(): Promise<QuantSkill[]> {
    await this.ready;
    await this.syncSkills();
    return structuredClone((await this.requestResources(this.session!, this.state.tools, this.skills)).skills);
  }

  abort(): void {
    void this.harness?.abort().catch((error: unknown) => {
      this.state.errorMessage = error instanceof Error ? error.message : String(error);
    });
  }

  clearAllQueues(): void {
    this.abort();
  }

  reset(): void {
    void this.switchSession().catch((error: unknown) => {
      this.state.errorMessage = error instanceof Error ? error.message : String(error);
    });
  }

  private switchSession(resumeSessionId?: string, report?: ReportProvenance): Promise<void> {
    const transition = this.ready.catch(() => {}).then(async () => {
      await this.harness?.abort();
      await this.initialize({ resumeSessionId, replace: true, report });
    });
    // A failed open must reject its caller without poisoning the current session.
    this.ready = transition.catch(() => {});
    return transition;
  }

  private prepareForSessionSwitch(): void {
    this.state.messages = [];
    this.state.isStreaming = false;
    this.state.streamingMessage = undefined;
    this.state.thinkingText = "";
    this.state.pendingToolCalls = new Set<string>();
    this.state.errorMessage = undefined;
    this.sessionCtx = createSessionContext();
  }

  private async initialize(options: { resumeSessionId?: string; replace?: boolean; report?: ReportProvenance; connection?: QuantModelConnection } = {}): Promise<void> {
    const totalStartedAt = perfNow();
    const configStartedAt = perfNow();
    const connection = options.connection ?? this.readConnection();
    const model = connection.model;
    perfLog("agent.init.config", configStartedAt, { model: model.id, provider: model.provider });

    const skillsStartedAt = perfNow();
    const toolSnapshot = this.dependencies.readTools?.();
    const tools = toolSnapshot ? copyTools(toolSnapshot.tools) : this.tools;
    const extensionSkills = structuredClone([...(toolSnapshot?.skills ?? [])]);
    const skillCapabilities = structuredClone(toolSnapshot?.capabilities ?? this.dependencies.readSkillCapabilities?.() ?? {});
    const skillRevision = this.dependencies.readSkillRevision?.();
    const rawSkills = structuredClone(await this.dependencies.loadSkills());
    if (new Set(rawSkills.map(skill => skill.name)).size !== rawSkills.length) throw new Error("Duplicate skill names in session dependencies.");
    perfLog("agent.init.skills", skillsStartedAt, { skills: rawSkills.length });

    const sessionStartedAt = perfNow();
    const existing = options.resumeSessionId ? await this.dependencies.sessions.list({ cwd: this.cwd }) : [];
    let session: Session<JsonlSessionMetadata>;
    if (options.resumeSessionId) {
      const target = existing.find((item) => item.id === options.resumeSessionId);
      if (!target) throw new Error(`Session not found: ${options.resumeSessionId}`);
      session = await this.dependencies.sessions.open(target);
    } else {
      session = await this.dependencies.sessions.create({ cwd: this.cwd });
    }
    perfLog("agent.init.session", sessionStartedAt, { existing: existing.length, resume: Boolean(options.resumeSessionId) });

    const contextStartedAt = perfNow();
    let reportLeaf: string | null | undefined;
    if (options.report) {
      const entries = await session.getEntries();
      const byId = new Map(entries.map(entry => [entry.id, entry]));
      const selected = options.report.entryIds.map(id => byId.get(id));
      const hash = createHash("sha256").update(JSON.stringify(selected)).digest("hex");
      const branchMatches = options.report.scope !== "branch" || (
        options.report.leafId === (selected.at(-1)?.id ?? null)
        && selected.every((entry, index) => entry?.parentId === (selected[index - 1]?.id ?? null))
      );
      if (byId.size !== entries.length || selected.some(entry => !entry) || hash !== options.report.entryHash
        || !branchMatches) throw new Error("Report source entries changed or are unavailable.");
      if (options.report.scope === "branch") reportLeaf = options.report.leafId;
    }
    const branch = reportLeaf === null ? [] : await session.getBranch(reportLeaf);
    const context = buildSessionContext(branch);
    const activeToolNames = context.activeToolNames?.filter(name => tools.some(tool => tool.name === name)) ?? tools.map(tool => tool.name);
    const restoredConnection = connection.restore?.(context) ?? connection;
    const skills = this.prepareSkills([...rawSkills, ...extensionSkills], tools.filter(tool => activeToolNames.includes(tool.name)), skillCapabilities, restoredConnection.model);
    const systemPrompt = this.dependencies.prompts.system({ skills, tools: tools.filter(tool => activeToolNames.includes(tool.name)) });
    const research = projectResearchState(branch, activeToolNames, this.dependencies.verifyResearch, this.dependencies.verifyReport);
    perfLog("agent.init.context", contextStartedAt, { messages: context.messages.length });
    const harness = new AgentHarness({
      env: this.dependencies.env,
      session,
      resources: { skills },
      model: restoredConnection.model,
      thinkingLevel: restoredConnection.thinkingLevel,
      tools: [...tools],
      activeToolNames,
      prepareTurnResources: async ({ session, activeTools, resources }) => {
        const prepared = await this.requestResources(session, activeTools, resources.skills ?? []);
        return { activeToolNames: prepared.activeToolNames, resources: { ...resources, skills: prepared.skills } };
      },
      systemPrompt: async ({ activeTools, resources }) => this.dependencies.prompts.system({ skills: resources.skills ?? [], tools: activeTools })
        + formatResearchContext(projectResearchState(await session.getBranch(), this.state.tools.map(tool => tool.name), this.dependencies.verifyResearch, this.dependencies.verifyReport)),
      getApiKeyAndHeaders: async (activeModel, signal) => structuredClone(await this.connection.getAuth(activeModel, signal)),
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
    });
    if (this.dependencies.beforeToolCall) {
      harness.on("tool_call", event => this.dependencies.beforeToolCall!(event));
    }
    harness.on("context", event => ({ messages: this.chartImages.project(event.messages) }));

    // Prepare every injected dependency before moving the source branch or replacing active state.
    if (reportLeaf !== undefined) await session.moveTo(reportLeaf);
    const version = ++this.initVersion;
    if (options.replace) this.prepareForSessionSwitch();
    this.connection = connection;
    this.tools.splice(0, this.tools.length, ...tools);
    this.toolRevision = toolSnapshot?.revision;
    this.skillCapabilities = skillCapabilities;
    this.extensionSkills = extensionSkills;
    this.automaticToolSelection = context.activeToolNames === null;
    this.state.systemPrompt = systemPrompt;
    this.state.tools = this.tools.filter(tool => activeToolNames.includes(tool.name));
    this.skills = skills;
    this.rawSkills = rawSkills;
    this.skillRevision = skillRevision;
    this.session = session;
    this.applyResearchContext(research);
    applySessionContextState(this.state, context, restoredConnection);

    harness.subscribe(async (event, signal) => {
      if (this.initVersion !== version || this.harness !== harness) return;
      reduceAgentState(this.state, this.sessionCtx, this.tools, event);
      if (event.type === "turn_end") await this.refreshResearchContext();
      if (!isForwardedAgentEvent(event)) return;
      for (const listener of this.listeners) {
        await listener(event, signal);
      }
    });

    this.harness = harness;
    perfLog("agent.init.total", totalStartedAt, { tools: this.tools.length });
  }

  private async refreshStateFromSession(updateToolSelection = false): Promise<void> {
    if (!this.session) return;
    const context = await this.session.buildContext();
    if (updateToolSelection) this.automaticToolSelection = context.activeToolNames === null;
    const connection = this.connection.restore?.(context) ?? { model: this.harness?.getModel() ?? this.connection.model, thinkingLevel: this.harness?.getThinkingLevel() ?? this.connection.thinkingLevel };
    applySessionContextState(this.state, context, connection);
    await this.refreshResearchContext();
  }

  private async refreshResearchContext(): Promise<void> {
    if (this.session) this.applyResearchContext(projectResearchState(await this.session.getBranch(), this.state.tools.map(tool => tool.name), this.dependencies.verifyResearch, this.dependencies.verifyReport));
  }

  private applyResearchContext(research: ResearchState): void {
    if (research.task) {
      const { scope } = research.task.spec;
      const attempts = [...research.task.unresolved, ...research.task.criteria.flatMap(criterion => criterion.evidence ? [criterion.evidence] : [])];
      const recent = research.operations.findLast(operation => attempts.some(attempt => attempt.callEntryId === operation.callEntryId && attempt.callId === operation.callId));
      this.sessionCtx = { lastSymbol: scope.symbols.length === 1 ? scope.symbols[0]! : null, lastMarket: scope.market === "mixed" ? null : scope.market,
        lastStartDate: scope.start, lastEndDate: scope.end, recentToolState: { toolName: recent?.tool ?? null, resultShape: recent ? inferResultShape(recent.tool) : null } };
      return;
    }
    const operation = research.operations.findLast(item => item.status !== "recorded");
    if (!operation) return;
    const parameters = operation.parameters;
    const reference = operation.references.find(item => item.role === "input")?.ref;
    const dates = Array.isArray(reference?.dates) ? reference.dates : [];
    const symbol = typeof parameters.symbol === "string" ? parameters.symbol : null;
    let market: string | null = null;
    if (symbol) { try { market = inferMarket(symbol); } catch { /* Keep an invalid attempted symbol visible without guessing its market. */ } }
    this.sessionCtx = { lastSymbol: symbol, lastMarket: market,
      lastStartDate: String(parameters.start ?? parameters.start_date ?? dates[0] ?? "") || null,
      lastEndDate: String(parameters.end ?? parameters.end_date ?? dates.at(-1) ?? "") || null,
      recentToolState: { toolName: operation.tool, resultShape: inferResultShape(operation.tool) } };
  }

  private async syncSkills(): Promise<void> {
    if (!this.harness?.isIdle || (!this.dependencies.readSkillRevision && !this.dependencies.prepareSkills && !this.dependencies.readTools)) return;
    if (this.skillRefresh) return this.skillRefresh;
    const toolSnapshot = this.dependencies.readTools?.();
    const toolsChanged = toolSnapshot !== undefined && toolSnapshot.revision !== this.toolRevision;
    const tools = toolsChanged ? copyTools(toolSnapshot.tools) : this.tools;
    const extensionSkills = toolsChanged ? structuredClone([...(toolSnapshot.skills ?? [])]) : this.extensionSkills;
    const skillCapabilities = structuredClone(toolsChanged
      ? toolSnapshot.capabilities ?? this.dependencies.readSkillCapabilities?.() ?? {}
      : this.dependencies.readSkillCapabilities?.() ?? this.skillCapabilities);
    const activeNames = toolsChanged && this.automaticToolSelection ? tools.map(tool => tool.name) : this.state.tools.map(tool => tool.name).filter(name => tools.some(tool => tool.name === name));
    const activeTools = tools.filter(tool => activeNames.includes(tool.name));
    const revision = this.dependencies.readSkillRevision?.();
    const reload = revision !== this.skillRevision;
    if (!reload && !this.dependencies.prepareSkills && !toolsChanged) return;
    const harness = this.harness;
    const refresh = (async () => {
      const rawSkills = structuredClone(reload ? await this.dependencies.loadSkills() : this.rawSkills);
      if (new Set(rawSkills.map(skill => skill.name)).size !== rawSkills.length) throw new Error("Duplicate skill names in session dependencies.");
      if (this.harness !== harness || !harness.isIdle) return;
      const skills = this.prepareSkills([...rawSkills, ...extensionSkills], activeTools, skillCapabilities);
      const systemPrompt = this.dependencies.prompts.system({ skills, tools: activeTools });
      if (toolsChanged) await harness.setTools(tools, activeNames);
      await harness.setResources({ ...harness.getResources(), skills });
      if (this.harness !== harness) return;
      this.tools.splice(0, this.tools.length, ...tools);
      this.state.tools = activeTools;
      this.toolRevision = toolSnapshot?.revision;
      this.extensionSkills = extensionSkills;
      this.skillCapabilities = skillCapabilities;
      this.skills = skills;
      this.rawSkills = rawSkills;
      this.skillRevision = revision;
      this.state.systemPrompt = systemPrompt;
    })();
    this.skillRefresh = refresh;
    try { await refresh; }
    finally { if (this.skillRefresh === refresh) this.skillRefresh = undefined; }
  }

  private prepareSkills(skills: QuantSkill[], tools: AgentTool[], capabilities: Readonly<Record<string, SkillRequirementCheck>>, model = this.state.model): QuantSkill[] {
    if (new Set(skills.map(skill => skill.name)).size !== skills.length) throw new Error("Duplicate skill names in session dependencies.");
    const imageCheck = modelImageInputCheck(model);
    const facts = { ...capabilities, "model-image-input": imageCheck.status === "missing" ? imageCheck : capabilities["model-image-input"] ?? imageCheck };
    const prepared = structuredClone(this.dependencies.prepareSkills?.(structuredClone(skills), tools, structuredClone(facts)) ?? skills);
    if (new Set(prepared.map(skill => skill.name)).size !== prepared.length) throw new Error("Duplicate skill names in prepared resources.");
    return prepared;
  }

  private async requestResources(session: Session, tools: AgentTool[], skills: QuantSkill[]): Promise<{ activeToolNames: string[]; skills: QuantSkill[] }> {
    const activeToolNames = tools.map(tool => tool.name);
    if (!this.dependencies.prepareRequestResources) return { activeToolNames, skills };
    const research = projectResearchState(await session.getBranch(), activeToolNames, this.dependencies.verifyResearch, this.dependencies.verifyReport);
    const prepared = this.dependencies.prepareRequestResources({ research, skills: structuredClone(skills), rawSkills: structuredClone([...this.rawSkills, ...this.extensionSkills]) });
    if (new Set(prepared.activeToolNames).size !== prepared.activeToolNames.length || prepared.activeToolNames.some(name => !activeToolNames.includes(name))) throw new Error("Request resources must select a unique subset of enabled tools.");
    if (new Set(prepared.skills.map(skill => skill.name)).size !== prepared.skills.length) throw new Error("Duplicate skill names in request resources.");
    return prepared;
  }

  private async syncModelSettings(): Promise<void> {
    if (!this.harness || this.state.isStreaming) return;
    const connection = this.readConnection();
    const model = connection.model;
    if (JSON.stringify(model) !== JSON.stringify(this.harness.getModel())) await this.harness.setModel(model);
    const thinking = connection.thinkingLevel;
    if (thinking !== this.harness.getThinkingLevel()) await this.harness.setThinkingLevel(thinking);
    // Keep credentials and endpoint together throughout a running prompt/tool loop.
    this.connection = connection;
  }

  private async maybeAutoCompact(): Promise<void> {
    if (!this.harness) return;
    const usage = this.getContextUsage();
    if (!usage) return;
    const triggerTokens = Math.min(this.connection.compactTriggerTokens, usage.contextWindow);
    if (usage.tokens < triggerTokens) return;
    await this.harness.compact();
    await this.refreshStateFromSession();
  }

  private readConnection(): QuantModelConnection {
    const connection = this.dependencies.readConnection();
    if (!Number.isSafeInteger(connection.compactTriggerTokens) || connection.compactTriggerTokens < 1) throw new Error("Compaction threshold must be a positive integer.");
    return { ...connection, model: structuredClone(connection.model) };
  }
}

function extractMessageText(message: AgentMessage): string {
  if (typeof (message as { content?: unknown }).content === "string") {
    return (message as { content: string }).content;
  }
  if (Array.isArray((message as { content?: unknown[] }).content)) {
    if ((message as { content: Array<{ type: string }> }).content.some(part => part.type === "image")) {
      throw new Error("Queued image input is unsupported. Wait for idle and use prompt or skill with images.");
    }
    return ((message as { content: Array<{ type: string; text?: string }> }).content)
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text!)
      .join("");
  }
  return "";
}

function extractMessageDisplayText(message: AgentMessage): string | undefined {
  const value = (message as { role?: string; displayText?: unknown }).role === "displayUser"
    ? (message as { displayText?: unknown }).displayText
    : undefined;
  return typeof value === "string" ? value : undefined;
}

export function createAgent(options: QuantSessionOptions): QuantAgentSession {
  return new QuantAgentHarnessSession(options);
}

function copyTools(tools: readonly AgentTool[]): AgentTool[] {
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new Error("Duplicate tool names in session dependencies.");
  return tools.map(tool => ({ ...tool, parameters: structuredClone(tool.parameters) }));
}

export function estimateTokens(message: AgentMessage): number {
  return piEstimateTokens(message);
}

export function estimateContextTokens(messages: AgentMessage[]): number {
  return piEstimateContextTokens(messages).tokens;
}
