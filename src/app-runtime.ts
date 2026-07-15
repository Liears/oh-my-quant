import { buildCommandHelpText } from "./cli/catalog.ts";
import { executeCommand, parseCommand } from "./cli/registry.ts";
import { generateCurrentSessionArtifact, restoreArtifactReport } from "./runtime/artifact-reports.ts";
import { dispatchUserMessage, isAgentTurnActive } from "./agent/src/dispatch.ts";
import { isQuantAnalysisRequest } from "./agent/src/context.ts";
import { createAgent, updateSessionCtx, type QuantAgentSession } from "./agent/src/session.ts";
import { skillPaths } from "./skill/index.ts";
import { ensureDirs, loadSettings, loadPanelPortfolio } from "./storage/index.ts";
import type { AppState, PanelSection, UIMessage } from "./tui/src/types.ts";
import type { CurrentSessionMeta } from "./tui/src/panel.ts";
import {
  buildOverviewPanelSections,
  collectOverviewSymbols,
  fetchOverviewHoldings,
  fetchOverviewQuotes,
  MARKET_INDICES,
  type OverviewHoldingFetcher,
  type OverviewPullMeta,
  type OverviewQuoteFetcher,
  type OverviewSymbolEntry,
} from "./runtime/overview.ts";
import { agentStatusText, errorText, formatAgentError, formatSlashRuntimeError } from "./runtime/errors.ts";
import {
  applyCommandResult as applyRuntimeCommandResult,
  compactingStatusText,
  getRuntimeCommandInvocation,
  type CommandResultRuntimeContext,
} from "./runtime/commands.ts";
import {
  buildLocalStorageState,
  marketRefreshLoadingPanel,
  marketUnavailablePanel,
} from "./runtime/panel-service.ts";
import {
  addUserMessage as reduceAddUserMessage,
  finalizeSkillMessage as reduceFinalizeSkillMessage,
  finalizeThinking as reduceFinalizeThinking,
  handleAgentEvent,
  pushLocalCommandMessage as reducePushLocalCommandMessage,
  syncMessagesFromAgentState as reduceSyncMessagesFromAgentState,
  upsertThinkingMessage as reduceUpsertThinkingMessage,
} from "./runtime/agent-events.ts";
import { perfLog, perfNow } from "./perf.ts";
import type { DoctorResult } from "./runtime/doctor-contract.ts";
import type { CommandResult } from "./types/commands.ts";
import {
  assistantEventHasVisibleOutput,
  assistantMessageHasVisibleOutput,
  computeTpotMs,
  countConversationTurns,
  createHudMetrics,
  createLatencyTracker,
  extractAssistantOutputTokens,
} from "./runtime/hud.ts";

export interface AppRuntimeSnapshot {
  model: string;
  modelLabel: string;
}

interface AppRuntimeCallbacks {
  onMessages: (messages: UIMessage[]) => void;
  onActivity: (activity: AppState["activity"]) => void;
  onLocalState?: (state: Pick<AppState, "activePortfolio" | "source" | "showPortfolioPanel">) => void;
  onComposerStatus?: (status: AppState["composerStatus"]) => void;
  onComposerQueue?: (queue: string[]) => void;
  onConfigRequest?: () => void;
  onDoctorRequest?: (doctor?: unknown) => void;
  onResumeRequest?: (meta?: CurrentSessionMeta) => void;
  onPortfolioRequest?: () => void;
  onArtifactRequest?: () => void;
  onHelpRequest?: () => void;
  onSessionRequest?: (meta?: CurrentSessionMeta) => void;
  onPanel?: (panel: PanelSection[], loading?: boolean) => void;
  onHud?: (hud: AppState["hud"]) => void;
}

type QuoteFetcher = OverviewQuoteFetcher;
type HoldingFetcher = OverviewHoldingFetcher;
type AgentFactory = () => QuantAgentSession;
type AutoArtifactRunner = (agent: QuantAgentSession) => Promise<{ success: boolean; message: string }>;
type ArtifactRestoreRunner = (reportId: string, agent: QuantAgentSession) => Promise<CommandResult>;

const SHORT_MODEL: Record<string, string> = {
  "claude-sonnet-4-6": "sonnet",
  "claude-opus-4-7": "opus",
  "claude-haiku-4-5": "haiku",
  "deepseek-v4-pro": "deepseek",
};
export function createRuntimeAgent(): QuantAgentSession {
  return createAgent({ skillPaths: skillPaths() });
}

async function runAutoArtifact(agent: QuantAgentSession): Promise<{ success: boolean; message: string }> {
  return generateCurrentSessionArtifact({ agentSession: agent });
}

async function runArtifactRestore(reportId: string, agent: QuantAgentSession): Promise<CommandResult> {
  return restoreArtifactReport(reportId, { agentSession: agent });
}

export class AppRuntime {
  private agent: QuantAgentSession | null = null;
  /** Slash command in flight (panel refresh). Agent concurrency uses agent.state.isStreaming. */
  private slashRunning = false;
  private messages: UIMessage[] = [];
  /** After first successful Overview fetch, later refreshes stay in-place (no spinner wipe). */
  private overviewReady = false;
  private marketSections: PanelSection[] = [];
  private marketRefreshPromise: Promise<void> | null = null;
  /** Invalidates timed-out or superseded pulls so stale data cannot overwrite a newer panel. */
  private marketRefreshGeneration = 0;
  private currentDoctor: DoctorResult | null = null;
  private hud = createHudMetrics();
  private latencyTracker = createLatencyTracker();
  private ttftTotalMs = 0;
  private ttftSamples = 0;
  private tpotTotalMs = 0;
  private tpotSamples = 0;
  private turnTtftRecorded = false;
  private pendingAutoArtifactInput: string | null = null;
  private autoArtifactRunning = false;

  constructor(
    private readonly callbacks: AppRuntimeCallbacks,
    private readonly quoteFetcher: QuoteFetcher = fetchOverviewQuotes,
    private readonly holdingFetcher: HoldingFetcher = fetchOverviewHoldings,
    private readonly agentFactory: AgentFactory = createRuntimeAgent,
    private readonly autoArtifactRunner: AutoArtifactRunner = runAutoArtifact,
    private readonly artifactRestoreRunner: ArtifactRestoreRunner = runArtifactRestore,
    private readonly marketRefreshTimeoutMs = AppRuntime.MARKET_REFRESH_TIMEOUT_MS,
  ) {}

  async refreshOverviewPanel(): Promise<void> {
    await this.startMarketRefresh();
  }

  /** Startup agent, then enter ready before blocking on market quotes. */
  async bootstrap(): Promise<AppRuntimeSnapshot> {
    const startedAt = perfNow();
    ensureDirs();
    const settings = loadSettings();

    for (const [key, value] of Object.entries(settings.env)) {
      if (value && !process.env[key]) process.env[key] = value;
    }

    this.setActivity("starting");

    const agentStartedAt = perfNow();
    this.agent = this.agentFactory();
    perfLog("runtime.agent.create", agentStartedAt);
    this.agent.subscribe(async (event) => {
      this.trackHudFromAgentEvent(event);
      handleAgentEvent(event, {
        messages: this.messages,
        thinkingText: this.agent?.state.thinkingText ?? "",
        setMessages: (messages) => { this.messages = messages; },
        emitMessages: () => this.emitMessages(),
        setActivity: (activity) => this.setActivity(activity),
        setStatus: (status) => this.setStatus(status),
        emitComposerQueue: (queue) => this.emitComposerQueue(queue),
        scheduleMarketRefresh: () => this.scheduleMarketRefresh(),
      });
      this.refreshHudFromAgentState();
      if (event.type === "agent_end") await this.maybeAutoGenerateArtifact();
    });

    void this.agent.waitForIdle()
      .then(() => perfLog("runtime.agent.warmup", agentStartedAt))
      .catch(() => {});

    this.setActivity("ready");
    this.refreshHudFromAgentState();
    this.scheduleMarketRefresh();
    perfLog("runtime.bootstrap", startedAt);

    return {
      model: readModel(settings.env),
      modelLabel: readModelLabel(settings.env),
    };
  }

  async submit(input: string): Promise<"continue" | "exit"> {
    const trimmed = input.trim();
    if (!trimmed) return "continue";

    if (trimmed === "/exit" || trimmed === "/quit") return "exit";

    const parsed = parseCommand(trimmed);
    const localOnly = parsed ? getRuntimeCommandInvocation(parsed).localOnly : false;

    if (parsed) {
      if (this.slashRunning && !localOnly) return "continue";
      if (isAgentTurnActive(this.agent) && !localOnly) return "continue";
      if (!localOnly) this.slashRunning = true;
      await this.runSlashCommand(parsed, localOnly);
      return "continue";
    }

    if (this.slashRunning) return "continue";
    await this.runAgentPrompt(trimmed);
    return "continue";
  }

  dispose(): void {
    this.agent?.abort();
  }

  /** Handle a report selected in the Artifact panel without routing through slash parsing. */
  async restoreArtifact(reportId: string): Promise<void> {
    if (!this.agent || this.slashRunning || isAgentTurnActive(this.agent)) return;
    this.slashRunning = true;
    this.setStatus({ kind: "info", text: "Restoring artifact session..." });
    try {
      const result = await this.artifactRestoreRunner(reportId, this.agent);
      applyRuntimeCommandResult(result, this.commandResultContext());
      this.refreshHudFromAgentState();
    } catch (error) {
      this.setStatus({ kind: "error", text: `Artifact restore failed · ${errorText(error)}` });
    } finally {
      this.slashRunning = false;
      this.scheduleMarketRefresh();
      if (!isAgentTurnActive(this.agent)) this.setActivity("ready");
    }
  }

  private async collectCurrentSessionMeta(): Promise<CurrentSessionMeta | undefined> {
    if (!this.agent) return undefined;
    if (
      typeof this.agent.getSessionMetadata !== "function"
      || typeof this.agent.getSessionEntries !== "function"
    ) {
      return undefined;
    }
    const [metadata, usage, entries] = await Promise.all([
      this.agent.getSessionMetadata(),
      Promise.resolve(this.agent.getContextUsage()),
      this.agent.getSessionEntries(),
    ]);
    if (!metadata) return undefined;
    return {
      id: metadata.id,
      createdAt: metadata.createdAt,
      usage: usage ?? null,
      entryCount: {
        messages: entries.filter(e => e.type === "message").length,
        compactions: entries.filter(e => e.type === "compaction").length,
        branches: entries.filter(e => e.type === "branch_summary").length,
      },
    };
  }

  private async runSlashCommand(
    parsed: NonNullable<ReturnType<typeof parseCommand>>,
    localOnly: boolean,
  ): Promise<void> {
    const invocation = getRuntimeCommandInvocation(parsed);
    if (invocation.isSkillInvoke) {
      this.messages.push({
        role: "skill",
        skill: { name: invocation.skillName, label: `SKILL.${invocation.skillName}`, status: "running", startedAt: Date.now() },
      });
      this.emitMessages();
      this.setActivity("running tool");
    }
    if (invocation.isCompactCommand) {
      this.setActivity("compacting");
      this.setStatus({
        kind: "info",
        text: compactingStatusText(isAgentTurnActive(this.agent)),
      });
    }

    try {
      const result = await executeCommand(parsed, {
        openConfig: this.callbacks.onConfigRequest
          ? () => { this.callbacks.onConfigRequest!(); }
          : undefined,
        openDoctor: this.callbacks.onDoctorRequest
          ? (doctor) => {
            this.currentDoctor = isDoctorResult(doctor) ? doctor : null;
            this.callbacks.onDoctorRequest?.(doctor);
          }
          : undefined,
        currentDoctor: this.currentDoctor,
        openResume: this.callbacks.onResumeRequest
          ? () => { void this.collectCurrentSessionMeta().then(meta => this.callbacks.onResumeRequest?.(meta)); }
          : undefined,
        openPortfolio: this.callbacks.onPortfolioRequest
          ? () => { this.callbacks.onPortfolioRequest!(); }
          : undefined,
        openHelp: this.callbacks.onHelpRequest
          ? () => { this.callbacks.onHelpRequest!(); }
          : undefined,
        openArtifact: this.callbacks.onArtifactRequest
          ? () => { this.callbacks.onArtifactRequest!(); }
          : undefined,
        openSession: (this.callbacks.onSessionRequest || this.callbacks.onResumeRequest)
          ? () => { void this.collectCurrentSessionMeta().then(meta => (this.callbacks.onSessionRequest ?? this.callbacks.onResumeRequest)?.(meta)); }
          : undefined,
        agentSession: this.agent,
      });
      applyRuntimeCommandResult(result, this.commandResultContext());
      this.refreshHudFromAgentState();
      if (invocation.isSkillInvoke) this.finalizeSkillMessage(!result.success);
      updateLastSymbol(parsed.flags);
    } catch (err) {
      if (invocation.isSkillInvoke) this.finalizeSkillMessage(true);
      this.setStatus({ kind: "error", text: formatSlashRuntimeError(parsed.command, err) });
    } finally {
      this.scheduleMarketRefresh();
      if (!localOnly) this.slashRunning = false;
      if (!isAgentTurnActive(this.agent)) this.setActivity("ready");
    }
  }

  private emitLocalStorageState(): void {
    this.callbacks.onLocalState?.(buildLocalStorageState(loadSettings(), loadPanelPortfolio()));
  }

  private async runAgentPrompt(input: string): Promise<void> {
    if (!this.agent) {
      this.emitComposerQueue([input]);
      this.setActivity("thinking");
      this.setStatus({ kind: "info", text: "Agent is still starting. Your message is kept in the composer; send it again in a moment." });
      this.setActivity("ready");
      return;
    }
    this.pendingAutoArtifactInput = input;
    try {
      const startedAt = perfNow();
      await dispatchUserMessage(this.agent, input, input);
      perfLog("runtime.agent.dispatch", startedAt);
    } catch (err) {
      this.pendingAutoArtifactInput = null;
      this.emitComposerQueue([]);
      const message = errorText(err);
      this.messages.push({ role: "error", text: formatAgentError("Agent", message) });
      this.emitMessages();
      this.setStatus({ kind: "error", text: agentStatusText(message) });
      if (!isAgentTurnActive(this.agent)) this.setActivity("ready");
    }
  }

  private async maybeAutoGenerateArtifact(): Promise<void> {
    const input = this.pendingAutoArtifactInput;
    this.pendingAutoArtifactInput = null;
    if (!input || this.autoArtifactRunning || !this.agent) return;

    const settings = loadSettings();
    if (!settings.artifactGeneration.auto || !isQuantAnalysisRequest(input)) return;

    this.autoArtifactRunning = true;
    this.setStatus({ kind: "info", text: "Generating artifact report..." });
    try {
      const result = await this.autoArtifactRunner(this.agent);
      this.setStatus({
        kind: result.success ? "info" : "error",
        text: result.success ? `Artifact ready · ${result.message}` : `Artifact generation failed · ${result.message}`,
      });
    } catch (error) {
      this.setStatus({ kind: "error", text: `Artifact generation failed · ${errorText(error)}` });
    } finally {
      this.autoArtifactRunning = false;
    }
  }

  private emitComposerQueue(queue: string[]): void {
    this.callbacks.onComposerQueue?.([...queue]);
  }

  private addUserMessage(text: string): void {
    const result = reduceAddUserMessage(this.messages, text);
    this.messages = result.messages;
    if (!result.changed) return;
    this.emitMessages();
    this.setStatus(null);
  }

  private pushLocalCommandMessage(text: string, role: "assistant" | "error"): void {
    this.messages = reducePushLocalCommandMessage(this.messages, text, role);
    this.emitMessages();
  }

  private syncMessagesFromAgentState(): void {
    const agentMessages = this.agent?.state.messages ?? [];
    this.messages = reduceSyncMessagesFromAgentState(agentMessages);
    this.emitMessages();
    this.refreshHudFromAgentState();
  }

  private emitMessages(): void {
    this.callbacks.onMessages([...this.messages]);
  }

  private emitHud(): void {
    const usage = this.hud.contextUsage
      ? { ...this.hud.contextUsage }
      : null;
    this.callbacks.onHud?.({
      ...this.hud,
      contextUsage: usage,
    });
  }

  private refreshHudFromAgentState(): void {
    if (!this.agent) {
      this.hud.contextUsage = null;
      this.hud.turnCount = 0;
      this.emitHud();
      return;
    }
    this.hud.contextUsage = typeof this.agent.getContextUsage === "function"
      ? this.agent.getContextUsage() ?? null
      : null;
    this.hud.turnCount = countConversationTurns(this.agent.state.messages as Array<{ role?: unknown }>);
    this.emitHud();
  }

  private trackHudFromAgentEvent(event: { type: string; [key: string]: any }): void {
    const now = Date.now();
    if (event.type === "message_start") {
      const role = event.message?.role;
      if (role === "user" || role === "displayUser") {
        this.latencyTracker.turnStartedAt = now;
        this.latencyTracker.firstOutputAt = null;
        this.turnTtftRecorded = false;
        this.emitHud();
      }
      return;
    }

    if (
      event.type === "message_update"
      && event.message?.role === "assistant"
      && this.latencyTracker.turnStartedAt !== null
      && this.latencyTracker.firstOutputAt === null
      && assistantEventHasVisibleOutput(event.assistantMessageEvent)
    ) {
      this.recordTurnTtft(now);
      this.emitHud();
      return;
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      if (
        this.latencyTracker.turnStartedAt !== null
        && this.latencyTracker.firstOutputAt === null
        && assistantMessageHasVisibleOutput(event.message)
      ) {
        this.recordTurnTtft(now);
      }
      const outputTokens = extractAssistantOutputTokens(event.message);
      const decodeMs = this.latencyTracker.firstOutputAt === null
        ? null
        : now - this.latencyTracker.firstOutputAt;
      const turnTpotMs = computeTpotMs(decodeMs, outputTokens);
      if (turnTpotMs !== null) {
        this.tpotTotalMs += turnTpotMs;
        this.tpotSamples += 1;
        this.hud.tpotMs = this.tpotTotalMs / this.tpotSamples;
      }
      this.latencyTracker.turnStartedAt = null;
      this.latencyTracker.firstOutputAt = null;
      this.emitHud();
    }
  }

  private recordTurnTtft(now: number): void {
    if (this.latencyTracker.turnStartedAt === null || this.turnTtftRecorded) return;
    this.latencyTracker.firstOutputAt = now;
    const turnTtftMs = now - this.latencyTracker.turnStartedAt;
    this.ttftTotalMs += turnTtftMs;
    this.ttftSamples += 1;
    this.hud.ttftMs = this.ttftTotalMs / this.ttftSamples;
    this.turnTtftRecorded = true;
  }

  private setActivity(activity: AppState["activity"]): void {
    this.callbacks.onActivity(activity);
  }

  private setStatus(status: AppState["composerStatus"]): void {
    this.callbacks.onComposerStatus?.(status);
  }

  private setPanel(panel: PanelSection[], loading = false): void {
    this.callbacks.onPanel?.(panel, loading);
  }

  private syncOverviewPanel(loading = false): void {
    const sections = [...this.marketSections];
    if (!this.overviewReady && sections.length === 0) {
      this.setPanel(marketRefreshLoadingPanel(), true);
      return;
    }
    this.setPanel(sections, loading);
  }

  private static readonly MARKET_REFRESH_TIMEOUT_MS = 30_000;

  private scheduleMarketRefresh(): void {
    if (this.marketRefreshPromise) return;
    const startedAt = perfNow();
    void this.startMarketRefresh()
      .then(() => perfLog("runtime.market.refresh", startedAt, { background: true }));
  }

  private startMarketRefresh(): Promise<void> {
    const generation = ++this.marketRefreshGeneration;
    this.syncOverviewPanel(true);

    const refresh = this.pullMarketPanelWithTimeout(generation)
      .catch(() => {
        if (generation !== this.marketRefreshGeneration) return;
        this.marketRefreshGeneration++;
        if (this.overviewReady) this.syncOverviewPanel();
        else this.setMarketUnavailable();
      })
      .finally(() => {
        if (this.marketRefreshPromise === refresh) this.marketRefreshPromise = null;
      });
    this.marketRefreshPromise = refresh;
    return refresh;
  }

  private async pullMarketPanelWithTimeout(generation: number): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.pullMarketPanel(generation),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Overview market refresh timed out")),
            this.marketRefreshTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async pullMarketPanel(generation: number): Promise<void> {
    const refreshedAt = new Date();
    const pullMeta: OverviewPullMeta = { sources: [], asOfDates: [] };
    const panelPortfolio = loadPanelPortfolio();
    const portfolioSymbols = collectOverviewSymbols(panelPortfolio);
    const [marketQuotes, portfolioRows] = await Promise.all([
      this.quoteFetcher(MARKET_INDICES, pullMeta),
      this.holdingFetcher(portfolioSymbols, pullMeta),
    ]);
    const sections = buildOverviewPanelSections({
      portfolio: panelPortfolio,
      portfolioSymbols,
      marketQuotes,
      portfolioRows,
      pullMeta,
      refreshedAt,
    });
    if (generation !== this.marketRefreshGeneration) return;
    this.marketSections = sections;
    this.overviewReady = true;
    this.syncOverviewPanel();
  }

  private setMarketUnavailable(): void {
    this.overviewReady = true;
    this.marketSections = marketUnavailablePanel();
    this.syncOverviewPanel();
  }

  private commandResultContext(): CommandResultRuntimeContext {
    return {
      getMessages: () => this.messages,
      setMessages: (messages) => { this.messages = messages; },
      emitMessages: () => this.emitMessages(),
      emitComposerQueue: (queue) => this.emitComposerQueue(queue),
      setStatus: (status) => this.setStatus(status),
      pushLocalCommandMessage: (text, role) => this.pushLocalCommandMessage(text, role),
      syncOverviewPanel: () => this.syncOverviewPanel(),
      resetAgent: () => {
        this.agent?.abort();
        this.agent?.clearAllQueues();
        this.agent?.reset();
      },
      openConfig: () => this.callbacks.onConfigRequest?.(),
      openDoctor: (doctor) => {
        this.currentDoctor = isDoctorResult(doctor) ? doctor : null;
        this.callbacks.onDoctorRequest?.(doctor);
      },
      openResume: () => {
        void this.collectCurrentSessionMeta()
          .then(meta => this.callbacks.onResumeRequest?.(meta))
          .catch(() => {});
      },
      openSession: () => {
        void this.collectCurrentSessionMeta()
          .then(meta => (this.callbacks.onSessionRequest ?? this.callbacks.onResumeRequest)?.(meta))
          .catch(() => {});
      },
      openPortfolio: () => this.callbacks.onPortfolioRequest?.(),
      openHelp: () => this.callbacks.onHelpRequest?.(),
      openArtifact: () => this.callbacks.onArtifactRequest?.(),
      syncMessagesFromAgentState: () => this.syncMessagesFromAgentState(),
      syncSessionPanel: () => {
        void this.collectCurrentSessionMeta()
          .then(meta => this.callbacks.onSessionRequest?.(meta))
          .catch(() => {});
      },
      emitLocalStorageState: () => this.emitLocalStorageState(),
      refreshMarketPanel: () => {
        void this.startMarketRefresh();
      },
    };
  }

  private upsertThinkingMessage(text: string): void {
    this.messages = reduceUpsertThinkingMessage(this.messages, text);
  }

  private finalizeThinking(): void {
    this.messages = reduceFinalizeThinking(this.messages);
  }

  private finalizeSkillMessage(isError: boolean): void {
    const result = reduceFinalizeSkillMessage(this.messages, isError);
    this.messages = result.messages;
    if (result.changed) this.emitMessages();
  }
}

function isDoctorResult(value: unknown): value is DoctorResult {
  return typeof value === "object"
    && value !== null
    && Array.isArray((value as { phases?: unknown }).phases)
    && typeof (value as { mode?: unknown }).mode === "string"
    && typeof (value as { overall?: unknown }).overall === "string";
}

export function createInitialAppState(version: string): AppState {
  const settings = loadSettings();
  const model = readModel(settings.env);
  const localState = buildLocalStorageState(settings, loadPanelPortfolio());
  return {
    model,
    modelLabel: readModelLabel(settings.env),
    version,
    user: process.env.USER || process.env.USERNAME || "trader",
    activity: "starting",
    cost: 0,
    cacheHit: 100,
    messages: [],
    panel: [],
    panelLoading: true,
    input: "",
    composerQueue: [],
    composerStatus: null,
    hud: createHudMetrics(),
    ...localState,
  };
}

function readModel(env: Record<string, string>): string {
  return env.WHYJ_DEFAULT_SONNET_MODEL || "deepseek-v4-pro";
}

function readModelLabel(env: Record<string, string>): string {
  const model = readModel(env);
  return SHORT_MODEL[model] || model.split("-").pop() || model;
}

function updateLastSymbol(flags: Record<string, unknown>): void {
  const symbol = flags["symbol"] || flags["code"];
  if (!symbol) return;
  updateSessionCtx({
    lastSymbol: String(symbol),
    lastMarket: String(flags["market"] || flags["m"] || "A"),
  });
}

export const helpText = buildCommandHelpText();


