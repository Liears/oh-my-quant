import type * as readline from "node:readline";
import { Buffer } from "./buffer.ts";
import { S } from "./styles.ts";
import { drawPanelFrame, renderConfigHeaderInfo, type PanelFrame } from "./panel-chrome.ts";
import { renderArtifactPanelView, renderConfigPanelView, renderDoctorPanelView, renderHelpPanelView, renderPortfolioPanelView, renderResumePanelView, type ConfigRowView, type DoctorPanelView } from "./panel-views.ts";
import { buildArtifactPanelData, buildConfigRowViews, buildHelpPanelData, buildPortfolioPanelData, buildResumePanelData } from "./panel-models.ts";
import { COMMAND_CATALOG } from "../../runtime/command-catalog.ts";
import { describeEndpointMode } from "../../runtime/doctor-contract.ts";
import type { DoctorResult } from "../../runtime/doctor-contract.ts";
import { createStoragePanelDataService, type ArtifactMeta, type LocalPortfolioSummary, type PanelDataService, type StoredSessionSummary, type WhyjEnvAliasKey } from "../../runtime/panel-data.ts";
import type { DataSource, OhQuantSettings } from "../../types/config.ts";

export type PanelResult = { command?: string; close?: boolean; refreshPanel?: boolean };
type PanelMode = "config" | "doctor" | "resume" | "portfolio" | "help" | "artifact";

export interface CurrentSessionMeta {
  id: string;
  createdAt: string;
  usage: { tokens: number; contextWindow: number; percent: number | null } | null;
  entryCount: { messages: number; compactions: number; branches: number };
}
type ResumeFilter = "cwd" | "all";
type ResumeSort = "updated" | "created";
type PortfolioFilter = "current" | "all";
type PortfolioSort = "updated" | "name";

type Field = {
  label: string;
  get: () => string;
  set?: (v: string) => void;
  apply?: (v: string) => string;
  secret?: boolean;
  options?: string[];
  optionsFn?: () => string[];
  pickRemove?: boolean;
  onEnter?: () => string;
  action?: string;
  prompt?: string;
};

type Row = { section: string } | { field: Field; index: number };
const MODEL_SHORT_NAMES = ["sonnet", "opus", "haiku"];

function resolveModelId(shortName: string): string {
  const envKey = `WHYJ_DEFAULT_${shortName.toUpperCase()}_MODEL`;
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  switch (shortName) {
    case "sonnet": return "deepseek-v4-pro";
    case "opus": return "deepseek-v4-pro";
    case "haiku": return "deepseek-v4-flash";
    default: return shortName;
  }
}

function buildModelOptions(): string[] {
  return MODEL_SHORT_NAMES.map((name) => resolveModelId(name));
}

function formatRelativeAge(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMins = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function normalizeSearch(text: string): string {
  return text.trim().toLowerCase();
}

function currentPortfolioOption(fileName: string, name: string): string {
  return `${name} · ${fileName}`;
}

const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh"];
const ENABLE_OPTIONS = ["on", "off"];
const SOURCE_OPTIONS: DataSource[] = ["akshare", "tushare", "llmquant-data", "financial-datasets"];

function cloneSettings(settings: OhQuantSettings): OhQuantSettings {
  return JSON.parse(JSON.stringify(settings)) as OhQuantSettings;
}

export class PanelController {
  private readonly data: PanelDataService;
  private mode: PanelMode = "config";
  private cfg: OhQuantSettings | null = null;
  private recentSessions: StoredSessionSummary[] = [];
  private localPortfolios: LocalPortfolioSummary[] = [];
  private artifacts: ArtifactMeta[] = [];
  private doctor: DoctorResult | null = null;
  private doctorDraft: OhQuantSettings | null = null;
  private doctorEditing = false;
  private resumeQuery = "";
  private resumeFilter: ResumeFilter = "cwd";
  private resumeSort: ResumeSort = "updated";
  private resumeSelection = 0;
  private portfolioQuery = "";
  private portfolioFilter: PortfolioFilter = "all";
  private portfolioSort: PortfolioSort = "updated";
  private portfolioSelection = 0;
  private cursor = 0;
  private draft: string | null = null;
  private status = "";
  private dirty = false;
  private currentSessionMeta: CurrentSessionMeta | null = null;
  private helpSelection = 0;
  private artifactSelection = 0;

  constructor(data: PanelDataService = createStoragePanelDataService()) {
    this.data = data;
  }

  open(mode: PanelMode = "config"): void {
    this.mode = mode;
    this.cfg = this.data.loadSettings();
    this.doctor = null;
    this.doctorDraft = null;
    this.doctorEditing = false;
    this.cursor = 0;
    this.draft = null;
    this.status = "";
    this.resumeQuery = "";
    this.resumeFilter = "cwd";
    this.resumeSort = "updated";
    this.resumeSelection = 0;
    this.portfolioQuery = "";
    this.portfolioFilter = "all";
    this.portfolioSort = "updated";
    this.portfolioSelection = 0;
    this.helpSelection = 0;
    this.artifactSelection = 0;
    this.dirty = false;
    if (mode === "resume") this.refreshResumeSessions();
    if (mode === "portfolio") this.refreshLocalPortfolios();
    if (mode === "artifact") this.refreshArtifacts();
  }

  setCurrentSessionMeta(meta: CurrentSessionMeta): void {
    this.currentSessionMeta = meta;
  }

  isOpen(): boolean { return this.cfg !== null; }

  close(): void {
    this.cfg = null;
    this.draft = null;
    this.status = "";
    this.mode = "config";
    this.doctor = null;
    this.doctorDraft = null;
    this.doctorEditing = false;
  }

  isDoctorMode(): boolean {
    return this.cfg !== null && this.mode === "doctor";
  }

  handleKey(input: string, key: readline.Key): PanelResult | null {
    if (!this.cfg) return null;
    if (this.mode === "resume") return this.handleResumeKey(input, key);
    if (this.mode === "portfolio") return this.handlePortfolioKey(input, key);
    if (this.mode === "artifact") return this.handleArtifactKey(input, key);
    if (this.mode === "help") {
      if (key.name === "escape") return { close: true };
      const total = COMMAND_CATALOG.length;
      if (key.name === "up") { this.helpSelection = (this.helpSelection - 1 + total) % total; return {}; }
      if (key.name === "down") { this.helpSelection = (this.helpSelection + 1) % total; return {}; }
      if (key.name === "return") {
        const cmd = COMMAND_CATALOG[this.helpSelection];
        if (cmd) return { command: cmd.name, close: true };
      }
      return {};
    }
    if (this.mode === "doctor") {
      return this.handleDoctorKey(input, key);
    }

    const fields = this.fields();
    const field = fields[this.cursor];

    if (this.draft !== null) {
      return this.handleDraft(input, key, field);
    }

    if (key.name === "escape") return { close: true, refreshPanel: this.dirty };
    if (key.name === "up" || key.name === "down") {
      const delta = key.name === "up" ? -1 : 1;
      this.cursor = (this.cursor + delta + fields.length) % fields.length;
      return {};
    }
    if (key.name !== "return" || !field) return {};

    if (field.onEnter) {
      this.status = field.onEnter();
      return this.status.startsWith("Imported") ? { refreshPanel: true } : {};
    }
    if (field.action && !field.prompt) return { command: field.action, close: true };
    if (this.fieldOptions(field).length > 0) { this.cycle(field, 1); return {}; }
    if (field.apply || field.set || field.prompt) this.draft = "";
    return {};
  }

  private handleResumeKey(_input: string, key: readline.Key): PanelResult {
    if (key.name === "escape") return { close: true };
    if (key.name === "up") {
      const items = this.filteredResumeSessions();
      if (items.length > 0) this.resumeSelection = (this.resumeSelection - 1 + items.length) % items.length;
      return {};
    }
    if (key.name === "down") {
      const items = this.filteredResumeSessions();
      if (items.length > 0) this.resumeSelection = (this.resumeSelection + 1) % items.length;
      return {};
    }
    if (key.name === "return") {
      const selected = this.filteredResumeSessions()[this.resumeSelection];
      if (!selected) return {};
      if (selected.format === "markdown") {
        this.status = "Unsupported legacy session archive. Resume uses JSONL sessions only.";
        return {};
      }
      this.status = `Resuming ${selected.id}...`;
      return { command: `/resume ${selected.id}`, close: true };
    }
    return {};
  }


  private handleArtifactKey(input: string, key: readline.Key): PanelResult {
    if (key.name === "escape") return { close: true };
    if (input.toLowerCase() === "g") {
      this.status = "Generating artifact...";
      return { command: "/artifact --generate", close: true };
    }
    if (key.name === "up") {
      const items = this.artifacts;
      if (items.length > 0) this.artifactSelection = (this.artifactSelection - 1 + items.length) % items.length;
      return {};
    }
    if (key.name === "down") {
      const items = this.artifacts;
      if (items.length > 0) this.artifactSelection = (this.artifactSelection + 1) % items.length;
      return {};
    }
    if (key.name === "return") {
      const selected = this.artifacts[this.artifactSelection];
      if (!selected) return {};
      this.status = `Opening ${selected.sessionId}...`;
      return { command: `/artifact --open ${selected.sessionId}`, close: true };
    }
    return {};
  }
  private handlePortfolioKey(_input: string, key: readline.Key): PanelResult {
    if (key.name === "escape") return { close: true };
    if (key.name === "up") {
      const items = this.filteredPortfolioItems();
      if (items.length > 0) this.portfolioSelection = (this.portfolioSelection - 1 + items.length) % items.length;
      return {};
    }
    if (key.name === "down") {
      const items = this.filteredPortfolioItems();
      if (items.length > 0) this.portfolioSelection = (this.portfolioSelection + 1) % items.length;
      return {};
    }
    if (key.name === "return") {
      const selected = this.filteredPortfolioItems()[this.portfolioSelection];
      if (!selected || !this.cfg) return {};
      this.cfg.preferences.currentPortfolioFile = selected.fileName;
      this.data.saveSettings(this.cfg);
      this.data.syncPanelPortfolioFromLocalPortfolio(selected.fileName);
      return { close: true, refreshPanel: true };
    }
    return {};
  }

  activePortfolioName(): string {
    return this.currentPortfolioName();
  }

  showPortfolioPanel(): boolean {
    return this.cfg?.showPortfolioPanel !== false;
  }

  /** Name of the currently highlighted item in the panel list. */
  selectedPortfolioName(): string {
    const items = this.filteredPortfolioItems();
    return items[this.portfolioSelection]?.name || this.currentPortfolioName();
  }

  render(buf: Buffer): void {
    if (!this.cfg) return;
    if (this.mode === "resume") {
      this.renderResumePanel(buf);
      return;
    }
    if (this.mode === "doctor") {
      this.renderDoctorPanel(buf);
      return;
    }
    if (this.mode === "portfolio") {
      this.renderPortfolioPanel(buf);
      return;
    }
    if (this.mode === "help") {
      this.renderHelpPanel(buf);
      return;
    }
    if (this.mode === "artifact") {
      this.renderArtifactPanel(buf);
      return;
    }
    const rows = this.rows();
    const fields = this.fields();
    const frame = this.drawPanelFrame(
      buf,
      "Config",
      "↑↓ move  ↵ toggle/edit  esc close",
    );
    const { inner } = frame;

    this.renderConfigHeaderInfo(buf, frame);
    const footer = this.status || "↑↓ move  ↵ toggle/edit  esc close";
    const rowViews: ConfigRowView[] = buildConfigRowViews(rows, this.cursor, this.draft, (field, active) => this.valueText(field as Field, active));
    const draftLine = this.draft !== null && fields[this.cursor]
      ? `${fields[this.cursor].label}${fields[this.cursor].apply ? " (code or code name)" : ""}: ${this.draft}|`
      : undefined;
    renderConfigPanelView(buf, frame, rowViews, footer, draftLine);
  }

  private renderResumePanel(buf: Buffer): void {
    const frame = this.drawPanelFrame(
      buf,
      "Resume a previous session",
      "↑↓ move  ↵ resume  esc close",
    );
    const sessions = this.filteredResumeSessions();
    renderResumePanelView(buf, frame, buildResumePanelData({
      sessions,
      selection: this.resumeSelection,
      currentSessionMeta: this.currentSessionMeta,
      resumeFilter: this.resumeFilter,
      resumeSort: this.resumeSort,
      status: this.status,
      innerWidth: frame.inner.w,
      formatRelativeAge,
    }));
  }

  private renderDoctorPanel(buf: Buffer): void {
    if (this.doctor?.mode === "first_setup" || this.doctorEditing) {
      this.renderDoctorWizard(buf);
      return;
    }
    const frame = this.drawPanelFrame(
      buf,
      "Doctor",
      this.doctor ? "↵/r retry  esc close" : "esc close",
    );
    if (!this.doctor) {
      renderDoctorPanelView(buf, frame, {
        title: "WhyJ Doctor",
        status: "running",
        mode: "diagnostic",
        model: this.cfg?.model || "sonnet",
        baseUrl: this.cfg?.env?.WHYJ_QUANT_BASE_URL || "",
        endpointMode: describeEndpointMode(this.cfg?.env?.WHYJ_QUANT_BASE_URL || ""),
        dataSource: this.currentSource(),
        settingsPath: "loading...",
        phases: [
          { phase: "model", status: "checking", detail: "Checking model..." },
          { phase: "tools", status: "checking", detail: "Checking tools..." },
          { phase: "data", status: "checking", detail: "Checking data..." },
        ],
        actions: [],
        hints: [],
      });
      return;
    }
    renderDoctorPanelView(buf, frame, this.toDoctorPanelView(this.doctor));
  }

  private renderDoctorWizard(buf: Buffer): void {
    const frame = this.drawPanelFrame(
      buf,
      this.doctor?.mode === "first_setup" ? "Doctor · First Setup" : "Doctor · Configure",
      "↑↓ move  ↵ edit/save  esc discard",
    );
    const rows = this.doctorWizardRows();
    const fields = this.doctorWizardFields();
    const footer = this.status || "↑↓ move  ↵ edit/save  esc discard";
    const rowViews: ConfigRowView[] = buildConfigRowViews(rows, this.cursor, this.draft, (field, active) => this.valueText(field as Field, active));
    const draftLine = this.draft !== null && fields[this.cursor]
      ? `${fields[this.cursor].label}: ${this.draft}|`
      : undefined;
    renderConfigPanelView(buf, frame, rowViews, footer, draftLine);
  }

  private renderPortfolioPanel(buf: Buffer): void {
    this.refreshLocalPortfolios();
    const frame = this.drawPanelFrame(
      buf,
      "Local portfolios",
      "↑↓ move  esc close",
    );
    const items = this.filteredPortfolioItems();
    const activeFile = this.cfg?.preferences.currentPortfolioFile || "holdings.json";
    renderPortfolioPanelView(buf, frame, buildPortfolioPanelData({
      items,
      selection: this.portfolioSelection,
      activeFile,
      status: this.status,
      formatRelativeAge,
    }));
  }


  private renderArtifactPanel(buf: Buffer): void {
    this.refreshArtifacts();
    const frame = this.drawPanelFrame(
      buf,
      "Artifacts",
      "↑↓ move  ↵ open  g generate  esc close",
    );
    renderArtifactPanelView(buf, frame, buildArtifactPanelData({
      items: this.artifacts,
      selection: this.artifactSelection,
      status: this.status,
      formatRelativeAge,
    }));
  }
  private renderHelpPanel(buf: Buffer): void {
    const frame = this.drawPanelFrame(buf, "Help", "↑↓ select  ↵ run  esc close");
    const total = COMMAND_CATALOG.length;
    this.helpSelection = Math.min(this.helpSelection, total - 1);
    renderHelpPanelView(buf, frame, buildHelpPanelData(this.helpSelection));
  }

  private drawPanelFrame(buf: Buffer, title: string, titleRight: string): PanelFrame {
    return drawPanelFrame(buf, title, titleRight);
  }

  private renderConfigHeaderInfo(buf: Buffer, frame: PanelFrame): void {
    if (!this.cfg) return;
    renderConfigHeaderInfo(buf, frame, {
      model: this.cfg.model || "sonnet",
      thinking: this.cfg.thinkingLevel || "high",
      panel: this.cfg.showPortfolioPanel === false ? "off" : "on",
      activePortfolio: this.currentPortfolioName(),
    });
  }

  private handleDraft(input: string, key: readline.Key, field: Field | undefined): PanelResult {
    if (key.name === "escape") { this.draft = null; return {}; }
    if (key.name === "backspace" || key.name === "delete") { this.draft = this.draft!.slice(0, -1); return {}; }
    if (key.name === "return") {
      const value = this.draft!.trim();
      this.draft = null;
      if (!field || !value) return {};
      if (field.apply) {
        this.status = field.apply(value);
        const ok = this.status.startsWith("Added") || this.status.startsWith("Imported") ||
                   this.status.startsWith("Created") || this.status.startsWith("Renamed") ||
                   this.status.startsWith("Deleted");
        return ok ? { refreshPanel: true } : {};
      }
      if (field.prompt) {
        const command = field.prompt + value;
        this.status = `Running: ${command}`;
        return { command, close: true };
      }
      field.set?.(value);
      this.data.saveSettings(this.cfg!);
      return {};
    }
    if (input && !key.ctrl && !key.meta) this.draft += input;
    return {};
  }

  private handleDoctorKey(input: string, key: readline.Key): PanelResult {
    if (this.doctor?.mode !== "first_setup" && !this.doctorEditing) {
      if (key.name === "return" || input.toLowerCase() === "r") {
        if (!this.doctor) return {};
        this.status = "Re-running doctor...";
        this.doctor = null;
        return { command: "/doctor" };
      }
      if (input.toLowerCase() === "m") {
        this.status = "Re-running model checks...";
        this.doctor = null;
        return { command: "/doctor --phase model" };
      }
      if (input.toLowerCase() === "t") {
        this.status = "Re-running tools checks...";
        this.doctor = null;
        return { command: "/doctor --phase tools" };
      }
      if (input.toLowerCase() === "d") {
        this.status = "Re-running data checks...";
        this.doctor = null;
        return { command: "/doctor --phase data" };
      }
      if (input.toLowerCase() === "c") {
        this.doctorEditing = true;
        this.doctorDraft = this.cfg ? cloneSettings(this.cfg) : null;
        this.cursor = 0;
        this.draft = null;
        this.status = "Editing doctor settings draft.";
        return {};
      }
      if (key.name === "escape") return { close: true };
      return {};
    }

    const fields = this.doctorWizardFields();
    const field = fields[this.cursor];

    if (this.draft !== null) {
      return this.handleDoctorDraft(input, key, field);
    }

    if (key.name === "escape") {
      this.doctorDraft = this.cfg ? cloneSettings(this.cfg) : null;
      if (this.doctor?.mode === "first_setup") return { close: true };
      this.doctorEditing = false;
      this.cursor = 0;
      this.status = "";
      return {};
    }
    if (key.name === "up" || key.name === "down") {
      const delta = key.name === "up" ? -1 : 1;
      this.cursor = (this.cursor + delta + fields.length) % fields.length;
      return {};
    }
    if (key.name !== "return" || !field) return {};

    if (field.onEnter) {
      this.status = field.onEnter();
      if (this.status.startsWith("Saved")) {
        this.doctorEditing = false;
        this.doctor = null;
        return { command: "/doctor" };
      }
      return {};
    }
    if (this.fieldOptions(field).length > 0) {
      this.cycleDoctorField(field, 1);
      return {};
    }
    if (field.apply || field.set) this.draft = "";
    return {};
  }

  private handleDoctorDraft(input: string, key: readline.Key, field: Field | undefined): PanelResult {
    if (key.name === "escape") {
      this.draft = null;
      return {};
    }
    if (key.name === "backspace" || key.name === "delete") {
      this.draft = this.draft!.slice(0, -1);
      return {};
    }
    if (key.name === "return") {
      const value = this.draft!.trim();
      this.draft = null;
      if (!field || !value) return {};
      if (field.apply) {
        this.status = field.apply(value);
        return {};
      }
      field.set?.(value);
      return {};
    }
    if (input && !key.ctrl && !key.meta) this.draft += input;
    return {};
  }

  private fieldOptions(field: Field): string[] {
    return field.optionsFn?.() ?? field.options ?? [];
  }

  private rows(): Row[] {
    const groups = this.groups();
    if (groups.length === 1) {
      let index = 0;
      return groups[0]!.fields.map((field) => ({ field, index: index++ }) as Row);
    }
    let index = 0;
    return groups.flatMap((group) => [
      { section: group.label } as Row,
      ...group.fields.map((field) => ({ field, index: index++ }) as Row),
    ]);
  }

  private fields(): Field[] {
    return this.groups().flatMap((group) => group.fields);
  }

  private apiKeyLabel(): string {
    return this.data.hasWhyjEnvValue(this.cfg?.env || {}, "apiKey") ? "✓ configured" : "○ enter key";
  }

  private baseUrlLabel(): string {
    const baseUrl = this.data.stripTerminalControlCodes(this.cfg?.env?.WHYJ_QUANT_BASE_URL || "");
    if (!baseUrl) return "○ enter url";
    return `${baseUrl} · ${describeEndpointMode(baseUrl)}`;
  }

  private dataSourceEnvVar(source: DataSource): string | null {
    switch (source) {
      case "tushare":
        return "WHYJ_QUANT_TUSHARE_TOKEN";
      case "llmquant-data":
        return "WHYJ_QUANT_LLMQUANT_API_KEY";
      case "financial-datasets":
        return "WHYJ_QUANT_FINANCIAL_DATASETS_KEY";
      default:
        return null;
    }
  }

  private dataSourceEnvKey(source: DataSource): WhyjEnvAliasKey | null {
    switch (source) {
      case "tushare":
        return "tushareToken";
      case "llmquant-data":
        return "llmquantApiKey";
      case "financial-datasets":
        return "financialDatasetsKey";
      default:
        return null;
    }
  }

  private dataSourceKeyLabel(source: DataSource): string {
    const envKey = this.dataSourceEnvKey(source);
    if (!envKey) return "○ no key needed";
    return this.data.hasWhyjEnvValue(this.cfg?.env || {}, envKey) ? "✓ configured" : "○ enter key";
  }

  private currentSource(): DataSource {
    return this.cfg?.preferences.source || "llmquant-data";
  }

  private doctorSource(): DataSource {
    return this.doctorDraft?.preferences.source || this.currentSource();
  }

  private currentPortfolioLabel(): string {
    const fileName = this.cfg?.preferences.currentPortfolioFile || "holdings.json";
    const match = this.localPortfolios.find((item) => item.fileName === fileName);
    if (match) return currentPortfolioOption(match.fileName, match.name);
    const panelPortfolio = this.data.loadPanelPortfolio();
    if (panelPortfolio.groups.length === 1 && panelPortfolio.groups[0]?.name) return panelPortfolio.groups[0].name;
    return fileName;
  }

  private currentPortfolioOptions(): string[] {
    if (this.localPortfolios.length === 0) this.refreshLocalPortfolios();
    if (this.localPortfolios.length === 0) return [this.currentPortfolioLabel()];
    return this.localPortfolios.map((item) => currentPortfolioOption(item.fileName, item.name));
  }

  private currentPortfolioName(): string {
    const fileName = this.cfg?.preferences.currentPortfolioFile || "holdings.json";
    const match = this.localPortfolios.find((item) => item.fileName === fileName);
    if (match) return match.name;
    const panelPortfolio = this.data.loadPanelPortfolio();
    if (panelPortfolio.groups.length === 1 && panelPortfolio.groups[0]?.name) return panelPortfolio.groups[0].name;
    return fileName;
  }

  private setCurrentPortfolio(value: string): void {
    if (!this.cfg) return;
    const fileName = value.split(" · ")[1] || value;
    this.cfg.preferences.currentPortfolioFile = fileName;
    this.data.syncPanelPortfolioFromLocalPortfolio(fileName);
    this.dirty = true;
  }

  private saveProviderKey(raw: string): string {
    const key = raw.trim();
    if (!key) return "Enter an API key.";
    if (!this.cfg) return "Config not loaded.";
    this.cfg.env = { ...(this.cfg.env || {}), WHYJ_QUANT_API_KEY: key };
    this.data.saveSettings(this.cfg);
    return "Saved WHYJ_QUANT_API_KEY.";
  }

  private saveBaseUrl(raw: string): string {
    const value = raw.trim();
    if (!value) return "Enter a base URL.";
    if (!this.cfg) return "Config not loaded.";
    this.cfg.env = { ...(this.cfg.env || {}), WHYJ_QUANT_BASE_URL: value };
    this.data.saveSettings(this.cfg);
    return "Saved WHYJ_QUANT_BASE_URL.";
  }

  private saveDataSourceKey(source: DataSource, raw: string): string {
    const envVar = this.dataSourceEnvVar(source);
    if (!envVar) return `${source} does not require a key.`;
    const key = raw.trim();
    if (!key) return `Enter ${envVar}.`;
    if (!this.cfg) return "Config not loaded.";
    this.cfg.env = { ...(this.cfg.env || {}), [envVar]: key };
    this.data.saveSettings(this.cfg);
    return `Saved ${envVar}.`;
  }

  private saveDoctorProviderKey(raw: string): string {
    const key = raw.trim();
    if (!key) return "Enter an API key.";
    if (!this.doctorDraft) return "Doctor config not loaded.";
    this.doctorDraft.env = { ...(this.doctorDraft.env || {}), WHYJ_QUANT_API_KEY: key };
    return "Added API key to draft.";
  }

  private saveDoctorBaseUrl(raw: string): string {
    const value = raw.trim();
    if (!value) return "Enter a base URL.";
    if (!this.doctorDraft) return "Doctor config not loaded.";
    this.doctorDraft.env = { ...(this.doctorDraft.env || {}), WHYJ_QUANT_BASE_URL: value };
    return "Added base URL to draft.";
  }

  private saveDoctorDataSourceKey(raw: string): string {
    const source = this.doctorSource();
    const envVar = this.dataSourceEnvVar(source);
    if (!envVar) return `${source} does not require a key.`;
    const key = raw.trim();
    if (!key) return `Enter ${envVar}.`;
    if (!this.doctorDraft) return "Doctor config not loaded.";
    this.doctorDraft.env = { ...(this.doctorDraft.env || {}), [envVar]: key };
    return `Added ${envVar} to draft.`;
  }

  private saveDoctorDraft(): string {
    if (!this.cfg || !this.doctorDraft) return "Doctor config not loaded.";
    const apiKey = this.doctorDraft.env?.WHYJ_QUANT_API_KEY?.trim()
      || this.doctorDraft.env?.WHYJ_QUANT_AUTH_TOKEN?.trim();
    const baseUrl = this.doctorDraft.env?.WHYJ_QUANT_BASE_URL?.trim();
    const source = this.doctorDraft.preferences.source;
    const tokenKey = this.dataSourceEnvVar(source);
    const sourceToken = tokenKey ? this.doctorDraft.env?.[tokenKey]?.trim() : "ok";
    if (!apiKey) return "Enter WHYJ_QUANT_API_KEY before saving.";
    if (!baseUrl) return "Enter WHYJ_QUANT_BASE_URL before saving.";
    if (tokenKey && !sourceToken) return `Enter ${tokenKey} before saving.`;
    this.cfg = cloneSettings(this.doctorDraft);
    this.data.saveSettings(this.cfg);
    return "Saved settings. Re-running doctor...";
  }

  private groups(): Array<{ label: string; fields: Field[] }> {
    if (!this.cfg) return [];
    return [
      {
        label: "Basic",
        fields: [
          { label: "Model", get: () => this.cfg?.model || "sonnet", set: (v) => { if (this.cfg) this.cfg.model = v; }, optionsFn: buildModelOptions },
          { label: "Thinking", get: () => this.cfg?.thinkingLevel || "high", set: (v) => { if (this.cfg) this.cfg.thinkingLevel = v; }, options: THINKING_OPTIONS },
          {
            label: "Portfolio",
            get: () => this.currentPortfolioLabel(),
            set: (v) => this.setCurrentPortfolio(v),
            optionsFn: () => this.currentPortfolioOptions(),
          },
          {
            label: "API Key",
            get: () => this.apiKeyLabel(),
            apply: (v) => this.saveProviderKey(v),
          },
          {
            label: "Base URL",
            get: () => this.baseUrlLabel(),
            apply: (v) => this.saveBaseUrl(v),
          },
          {
            label: "Source",
            get: () => this.currentSource(),
            set: (v) => { if (this.cfg) this.cfg.preferences.source = v as DataSource; },
            options: [...SOURCE_OPTIONS],
          },
          {
            label: "Token",
            get: () => this.dataSourceKeyLabel(this.currentSource()),
            apply: (v) => this.saveDataSourceKey(this.currentSource(), v),
          },
          {
            label: "Codex Skills",
            get: () => this.cfg?.skillIntegrations.codex ? "on" : "off",
            set: (v) => { if (this.cfg) this.cfg.skillIntegrations.codex = v !== "off"; },
            options: ENABLE_OPTIONS,
          },
          {
            label: "Claude Skills",
            get: () => this.cfg?.skillIntegrations.claude ? "on" : "off",
            set: (v) => { if (this.cfg) this.cfg.skillIntegrations.claude = v !== "off"; },
            options: ENABLE_OPTIONS,
          },
          { label: "Panel", get: () => this.cfg?.showPortfolioPanel === false ? "off" : "on", set: (v) => { if (this.cfg) this.cfg.showPortfolioPanel = v !== "off"; }, options: ENABLE_OPTIONS },
          { label: "Insight", get: () => this.cfg?.insightEnabled === false ? "off" : "on", set: (v) => { if (this.cfg) this.cfg.insightEnabled = v !== "off"; }, options: ENABLE_OPTIONS },
                  ],
      },
    ];
  }

  private valueText(field: Field, active: boolean): string {
    if (this.draft !== null && active) return `[${this.draft}|]`;
    return `[${field.action ? ">" : ""}${field.pickRemove ? "▼ " : ""}${field.get()}]`;
  }

  private cycle(field: Field, direction: 1 | -1): void {
    if (!this.cfg || !field.set) return;
    const opts = this.fieldOptions(field);
    if (opts.length === 0) return;
    const idx = opts.indexOf(field.get());
    field.set(opts[(idx + direction + opts.length) % opts.length]);
    this.data.saveSettings(this.cfg);
  }

  private doctorWizardRows(): Row[] {
    return this.doctorWizardFields().map((field, index) => ({ field, index }) as Row);
  }

  private doctorWizardFields(): Field[] {
    return [
      {
        label: "Provider",
        get: () => this.doctorProviderPreset(),
        set: (v) => this.setDoctorProviderPreset(v),
        options: ["DeepSeek", "GLM", "MiniMax", "Custom"],
      },
      {
        label: "API Key",
        get: () => this.doctorApiKeyLabel(),
        apply: (v) => this.saveDoctorProviderKey(v),
      },
      {
        label: "Base URL",
        get: () => this.doctorBaseUrlLabel(),
        apply: (v) => this.saveDoctorBaseUrl(v),
      },
      {
        label: "Source",
        get: () => this.doctorSource(),
        set: (v) => {
          if (this.doctorDraft) this.doctorDraft.preferences.source = v as DataSource;
        },
        options: [...SOURCE_OPTIONS],
      },
      {
        label: "Token",
        get: () => this.doctorDataSourceKeyLabel(),
        apply: (v) => this.saveDoctorDataSourceKey(v),
      },
      {
        label: "Save & Verify",
        get: () => "run /doctor",
        onEnter: () => this.saveDoctorDraft(),
      },
    ];
  }

  private doctorApiKeyLabel(): string {
    const value = this.doctorDraft?.env?.WHYJ_QUANT_API_KEY?.trim()
      || this.doctorDraft?.env?.WHYJ_QUANT_AUTH_TOKEN?.trim();
    return value ? `✓ ${this.maskSecret(value)}` : "○ enter key";
  }

  private doctorBaseUrlLabel(): string {
    const value = this.doctorDraft?.env?.WHYJ_QUANT_BASE_URL?.trim();
    if (!value) return "○ enter url";
    return `${this.data.stripTerminalControlCodes(value)} · ${describeEndpointMode(value)}`;
  }

  private doctorDataSourceKeyLabel(): string {
    const source = this.doctorSource();
    const envVar = this.dataSourceEnvVar(source);
    if (!envVar) return "○ no key needed";
    const value = this.doctorDraft?.env?.[envVar]?.trim();
    return value ? `✓ ${this.maskSecret(value)}` : `○ enter ${envVar}`;
  }

  private cycleDoctorField(field: Field, direction: 1 | -1): void {
    if (!field.set) return;
    const opts = this.fieldOptions(field);
    if (opts.length === 0) return;
    const idx = opts.indexOf(field.get());
    field.set(opts[(idx + direction + opts.length) % opts.length]);
    this.status = `Selected ${field.get()}.`;
  }

  private maskSecret(value: string): string {
    if (value.length <= 8) return `${value.slice(0, 2)}...`;
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  private refreshResumeSessions(): void {
    this.recentSessions = this.data.listStoredSessions({
      cwd: this.data.cwd(),
      limit: 200,
      scope: this.resumeFilter,
      sort: this.resumeSort,
    });
    this.clampResumeSelection();
  }

  private filteredResumeSessions(): StoredSessionSummary[] {
    const query = normalizeSearch(this.resumeQuery);
    if (!query) return this.recentSessions;
    return this.recentSessions.filter((session) => {
      const haystack = normalizeSearch([session.preview, session.sessionName, session.id, session.cwd].filter(Boolean).join(" "));
      return haystack.includes(query);
    });
  }

  private clampResumeSelection(): void {
    const items = this.filteredResumeSessions();
    this.resumeSelection = Math.max(0, Math.min(this.resumeSelection, items.length - 1));
  }

  private filteredPortfolioItems(): LocalPortfolioSummary[] {
    const query = normalizeSearch(this.portfolioQuery);
    const currentFile = this.cfg?.preferences.currentPortfolioFile || "holdings.json";
    const scopedItems = this.portfolioFilter === "current"
      ? this.localPortfolios.filter((item) => item.fileName === currentFile)
      : this.localPortfolios;
    const items = [...scopedItems];
    return query
      ? items.filter((item) => normalizeSearch(`${item.name} ${item.fileName} ${item.focusSectors.join(" ")} ${item.holdings.map((fund) => `${fund.code} ${fund.name}`).join(" ")}`).includes(query))
      : items;
  }

  private clampPortfolioSelection(): void {
    const items = this.filteredPortfolioItems();
    this.portfolioSelection = Math.max(0, Math.min(this.portfolioSelection, items.length - 1));
  }


  private refreshArtifacts(): void {
    this.artifacts = this.data.listArtifacts();
    this.artifactSelection = Math.max(0, Math.min(this.artifactSelection, this.artifacts.length - 1));
  }

  setDoctor(doctor: DoctorResult | null): void {
    this.doctor = doctor;
    this.cursor = 0;
    this.draft = null;
    this.status = "";
    if (doctor?.mode === "first_setup") {
      this.doctorDraft = this.cfg ? cloneSettings(this.cfg) : null;
    } else if (!this.doctorEditing) {
      this.doctorDraft = null;
    }
  }

  private toDoctorPanelView(doctor: DoctorResult): DoctorPanelView {
    const actions = ["[Retry All]  press Enter or r"];
    if (doctor.phases.some((phase) => phase.phase === "model")) actions.push("[Retry Model] press m");
    if (doctor.phases.some((phase) => phase.phase === "tools")) actions.push("[Retry Tools] press t");
    if (doctor.phases.some((phase) => phase.phase === "data")) actions.push("[Retry Data]  press d");
    actions.push("[Configure]   press c");
    return {
      title: "WhyJ Doctor",
      status: doctor.overall,
      mode: doctor.mode,
      model: doctor.config.model,
      baseUrl: doctor.config.baseUrl,
      endpointMode: doctor.config.endpointMode,
      dataSource: doctor.config.dataSource,
      settingsPath: doctor.config.settingsPath,
      phases: doctor.phases.map((phase) => ({
        phase: phase.phase,
        status: phase.status,
        detail: phase.error || phase.detail,
        action: phase.action,
        warnings: phase.warnings,
      })),
      actions,
      hints: doctor.hints,
      logPath: doctor.logPath,
    };
  }

  private doctorProviderPreset(): string {
    const baseUrl = this.doctorDraft?.env?.WHYJ_QUANT_BASE_URL?.trim() || "";
    if (!baseUrl) return "Custom";
    if (baseUrl === "https://api.deepseek.com/anthropic") return "DeepSeek";
    if (baseUrl === "https://open.bigmodel.cn/api/anthropic") return "GLM";
    if (baseUrl === "https://api.minimaxi.com/anthropic" || baseUrl === "https://api.minimaxi.com/v1") return "MiniMax";
    return "Custom";
  }

  private setDoctorProviderPreset(value: string): void {
    if (!this.doctorDraft) return;
    const presets: Record<string, string> = {
      DeepSeek: "https://api.deepseek.com/anthropic",
      GLM: "https://open.bigmodel.cn/api/anthropic",
      MiniMax: "https://api.minimaxi.com/anthropic",
    };
    if (value !== "Custom") {
      this.doctorDraft.env = {
        ...(this.doctorDraft.env || {}),
        WHYJ_QUANT_BASE_URL: presets[value] || this.doctorDraft.env.WHYJ_QUANT_BASE_URL || "",
      };
    }
  }
  private refreshLocalPortfolios(): void {
    const portfolios = this.data.listLocalPortfolios();
    this.localPortfolios = portfolios.sort((a, b) => {
      if (this.portfolioSort === "name") return a.name.localeCompare(b.name, "zh-CN");
      return new Date(b.updated || 0).getTime() - new Date(a.updated || 0).getTime();
    });
    this.clampPortfolioSelection();
  }
}

