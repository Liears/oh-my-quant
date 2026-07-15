import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "../src/buffer.ts";
import { PanelController } from "../src/panel.ts";
import { saveArtifact, savePanelPortfolio, loadSettings, saveSettings } from "../../storage/index.ts";
import type { DoctorResult } from "../../cli/doctor.ts";

const OHQ = join(process.cwd(), ".ohquant-test-panel-ctrl");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
  savePanelPortfolio({ updated: "", symbols: [], groups: [] });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

function key(name: string, char = "") {
  return { name, sequence: char, shift: false, ctrl: false, meta: false };
}

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

describe("PanelController portfolio UI", () => {
  it("renders a doctor panel with report data", () => {
    const panel = new PanelController();
    panel.open("doctor");
    panel.setDoctor({
      ready: true,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "pass", label: "Model", detail: "Anthropic Messages HTTP 200", warnings: ["Network probe skipped by WHYJ_DOCTOR_SKIP_NETWORK."] },
        { phase: "tools", status: "pass", label: "Tools", detail: "schemas loaded" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY", error: "Missing WHYJ_QUANT_LLMQUANT_API_KEY", action: "Open /doctor Configure and set WHYJ_QUANT_LLMQUANT_API_KEY." },
      ],
      auth: {
        WHYJ_QUANT_API_KEY: { available: true, source: "env", value: "test...1234 · fp:abcd1234" },
        WHYJ_QUANT_AUTH_TOKEN: { available: false, source: "missing", value: "-" },
        WHYJ_QUANT_BASE_URL: { available: true, source: "env", value: "https://api.deepseek.com/anthropic" },
        WHYJ_QUANT_TUSHARE_TOKEN: { available: false, source: "missing", value: "-" },
        WHYJ_QUANT_LLMQUANT_API_KEY: { available: false, source: "missing", value: "-" },
        WHYJ_QUANT_FINANCIAL_DATASETS_KEY: { available: false, source: "missing", value: "-" },
      },
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com/anthropic",
        endpointMode: "Anthropic Messages",
        dataSource: "llmquant-data",
      },
      hints: ["Open /doctor Configure and set WHYJ_QUANT_LLMQUANT_API_KEY."],
      logPath: ".ohquant/logs/doctor/latest.log",
    } as DoctorResult);

    const buf = new Buffer(120, 36);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("WhyJ Doctor");
    expect(plain).toContain("partial_fail");
    expect(plain).toContain("Missing WHYJ_QUANT_LLMQUANT_API_KEY");
    expect(plain).toContain("Warn · Network probe skipped by WHYJ_DOCTOR_SKIP_NETWORK.");
    expect(plain).toContain("r Retry all  ·  m Model");
    expect(panel.handleKey("", key("escape"))).toEqual({ close: true });
    panel.close();
  });

  it("retries doctor directly from the diagnostic panel", () => {
    const panel = new PanelController();
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "fail", label: "Model", detail: "Missing WHYJ_QUANT_API_KEY" },
        { phase: "tools", status: "pass", label: "Tools", detail: "schemas loaded" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);

    expect(panel.handleKey("r", key("", "r"))).toEqual({ command: "/doctor" });
  });

  it("retries tools and data phases from the diagnostic panel", () => {
    const panel = new PanelController();
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "pass", label: "Model", detail: "model ok" },
        { phase: "tools", status: "fail", label: "Tools", detail: "Python missing" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);

    expect(panel.handleKey("t", key("", "t"))).toEqual({ command: "/doctor --phase tools" });
    panel.setDoctor({
      ready: false,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "pass", label: "Model", detail: "model ok" },
        { phase: "tools", status: "fail", label: "Tools", detail: "Python missing" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);
    expect(panel.handleKey("d", key("", "d"))).toEqual({ command: "/doctor --phase data" });
  });

  it("enters configure mode from the diagnostic panel", () => {
    const panel = new PanelController();
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "fail", label: "Model", detail: "Missing WHYJ_QUANT_API_KEY" },
        { phase: "tools", status: "pass", label: "Tools", detail: "schemas loaded" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);

    panel.handleKey("c", key("", "c"));
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Doctor · Configure");
    expect(plain).toContain("Provider");
    expect(plain).toContain("Save & Verify");
  });

  it("keeps doctor first-setup edits in draft until save", () => {
    const panel = new PanelController();
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "first_setup",
      overall: "unconfigured",
      phases: [
        { phase: "model", status: "fail", label: "Model", detail: "Missing WHYJ_QUANT_API_KEY" },
        { phase: "tools", status: "pending", label: "Tools", detail: "" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: ["Configure API and data credentials."],
    } as DoctorResult);

    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    for (const ch of "sk-draft-only") panel.handleKey(ch, key("", ch));
    panel.handleKey("", key("return"));
    expect(loadSettings().env.WHYJ_QUANT_API_KEY).toBeUndefined();

    expect(panel.handleKey("", key("escape"))).toEqual({ close: true });
    expect(loadSettings().env.WHYJ_QUANT_API_KEY).toBeUndefined();
  });

  it("saves doctor first-setup draft and reruns doctor on save", () => {
    const panel = new PanelController();
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "first_setup",
      overall: "unconfigured",
      phases: [
        { phase: "model", status: "fail", label: "Model", detail: "Missing WHYJ_QUANT_API_KEY" },
        { phase: "tools", status: "pending", label: "Tools", detail: "" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: ["Configure API and data credentials."],
    } as DoctorResult);

    panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    for (const ch of "sk-live-1234") panel.handleKey(ch, key("", ch));
    panel.handleKey("", key("return"));

    panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    for (const ch of "https://api.deepseek.com/anthropic") panel.handleKey(ch, key("", ch));
    panel.handleKey("", key("return"));

    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    for (const ch of "llmq-key-5678") panel.handleKey(ch, key("", ch));
    panel.handleKey("", key("return"));

    panel.handleKey("", key("down"));
    const result = panel.handleKey("", key("return"));
    expect(result).toEqual({ command: "/doctor" });

    const settings = loadSettings();
    expect(settings.env.WHYJ_QUANT_API_KEY).toBe("sk-live-1234");
    expect(settings.env.WHYJ_QUANT_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(settings.env.WHYJ_QUANT_LLMQUANT_API_KEY).toBe("llmq-key-5678");
  });

  it("maps the MiniMax doctor preset to the supported runtime endpoint", () => {
    const panel = new PanelController();
    panel.open("doctor");
    panel.setDoctor({
      ready: false,
      mode: "first_setup",
      overall: "unconfigured",
      phases: [
        { phase: "model", status: "fail", label: "Model", detail: "Missing WHYJ_QUANT_API_KEY" },
        { phase: "tools", status: "pending", label: "Tools", detail: "" },
        { phase: "data", status: "fail", label: "Data", detail: "Missing WHYJ_QUANT_LLMQUANT_API_KEY" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "",
        endpointMode: "Custom",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);

    (panel as any).setDoctorProviderPreset("MiniMax");
    expect((panel as any).doctorDraft.env.WHYJ_QUANT_BASE_URL).toBe("https://api.minimaxi.com/anthropic");
    expect((panel as any).doctorProviderPreset()).toBe("MiniMax");
  });

  it("accepts a legacy auth token when saving doctor configure flow", () => {
    const settings = loadSettings();
    settings.env.WHYJ_QUANT_AUTH_TOKEN = "legacy-provider-token";
    settings.env.WHYJ_QUANT_BASE_URL = "https://api.deepseek.com/anthropic";
    settings.env.WHYJ_QUANT_LLMQUANT_API_KEY = "llmq-key-5678";
    saveSettings(settings);

    const panel = new PanelController();
    panel.open("doctor");
    panel.setDoctor({
      ready: true,
      mode: "diagnostic",
      overall: "partial_fail",
      phases: [
        { phase: "model", status: "pass", label: "Model", detail: "model ok" },
        { phase: "tools", status: "pass", label: "Tools", detail: "tools ok" },
        { phase: "data", status: "fail", label: "Data", detail: "data missing" },
      ],
      auth: {},
      config: {
        settingsPath: ".ohquant/settings.json",
        model: "sonnet",
        baseUrl: "https://api.deepseek.com/anthropic",
        endpointMode: "Anthropic Messages",
        dataSource: "llmquant-data",
      },
      hints: [],
    } as DoctorResult);

    panel.handleKey("c", key("", "c"));
    for (let i = 0; i < 5; i++) panel.handleKey("", key("down"));
    const result = panel.handleKey("", key("return"));
    expect(result).toEqual({ command: "/doctor" });
  });

  it("lets config switch the current portfolio file used by the portfolio panel", () => {
    const portfolioDir = join(OHQ, "portfolio");
    mkdirSync(portfolioDir, { recursive: true });
    writeFileSync(join(portfolioDir, "holdings.json"), JSON.stringify({
      name: "当前主组合",
      updated: "2026-06-01T00:00:00+08:00",
      funds: [{ code: "161725", name: "招商中证白酒" }, { code: "_CASH_", name: "现金" }],
      focusSectors: ["消费"],
    }, null, 2));
    writeFileSync(join(portfolioDir, "holdings_v2_semicon.json"), JSON.stringify({
      name: "聚焦半导体",
      updated: "2026-05-31T00:00:00+08:00",
      funds: [{ code: "008888", name: "半导体芯片ETF联接C" }],
      focusSectors: ["半导体"],
    }, null, 2));

    const configPanel = new PanelController();
    configPanel.open("config");
    const configBuf = new Buffer(120, 28);
    configPanel.render(configBuf);
    expect(configBuf.toPlain().join("\n")).toContain("Research  holdings.json · llmquant-data");
    expect(configBuf.toPlain().join("\n")).toContain("Active Portfolio");
    expect(configBuf.toPlain().join("\n")).toContain("Market Data");
    expect(configBuf.toPlain().join("\n")).toContain("Data Token");
    expect(configBuf.toPlain().join("\n")).toContain("External Skills");
    expect(configBuf.toPlain().join("\n")).not.toContain("Codex Skills");
    expect(configBuf.toPlain().join("\n")).not.toContain("Claude Skills");
    expect(configBuf.toPlain().join("\n")).not.toContain("Changes save immediately");
    expect(configBuf.toPlain().join("\n")).toContain("-- Agent Runtime --");
    expect(configBuf.toPlain().join("\n")).not.toContain("↑↓ select");
    expect(configBuf.toPlain().join("\n")).not.toContain("change/edit");
    expect(configBuf.toPlain().join("\n")).not.toContain("esc done");
    expect(configBuf.toPlain().join("\n")).not.toContain("About ·");
    expect(configBuf.toPlain().join("\n")).not.toContain("Use slash commands for data");
    expect(configBuf.toPlain().join("\n")).toContain("holdings.json");
    for (let i = 0; i < 6; i++) configPanel.handleKey("", key("down"));
    configPanel.handleKey("", key("return"));
    configPanel.close();

    const settings = loadSettings();
    expect(settings.preferences.currentPortfolioFile).toBe("holdings_v2_semicon.json");

    const portfolioPanel = new PanelController();
    portfolioPanel.open("portfolio");
    const buf = new Buffer(120, 28);
    portfolioPanel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Selected: 当前主组合");
    expect(plain).toContain("聚焦半导体");
    expect(plain).toContain("当前主组合");
  });

  it("renders local portfolio comparison rows in the portfolio panel", () => {
    const panel = new PanelController();
    const portfolioDir = join(OHQ, "portfolio");
    mkdirSync(portfolioDir, { recursive: true });
    writeFileSync(join(portfolioDir, "holdings.json"), JSON.stringify({
      name: "当前主组合",
      updated: "2026-06-01T00:00:00+08:00",
      funds: [{ code: "161725", name: "招商中证白酒" }, { code: "_CASH_", name: "现金" }],
      focusSectors: ["消费"],
    }, null, 2));
    writeFileSync(join(portfolioDir, "holdings_v2_kc50.json"), JSON.stringify({
      name: "科创50宽基",
      updated: "2026-05-30T00:00:00+08:00",
      funds: [{ code: "011613", name: "华夏科创50ETF联接C" }, { code: "_CASH_", name: "现金" }],
      focusSectors: ["科创50", "AI"],
    }, null, 2));
    writeFileSync(join(portfolioDir, "holdings_v2_semicon.json"), JSON.stringify({
      name: "聚焦半导体",
      updated: "2026-05-31T00:00:00+08:00",
      funds: [{ code: "008888", name: "半导体芯片ETF联接C" }],
      focusSectors: ["半导体"],
    }, null, 2));
    const settings = loadSettings();
    settings.preferences.currentPortfolioFile = "holdings_v2_semicon.json";
    saveSettings(settings);

    panel.open("portfolio");
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Local portfolios");
    expect(plain).toContain("Selected: 当前主组合");
    expect(plain).toContain("聚焦半导体");
    expect(plain).toContain("当前主组合");

    panel.close();
  });

  it("keeps Settings free of per-field explanation rows", () => {
    const panel = new PanelController();
    panel.open("config");

    for (let index = 0; index < 10; index++) {
      const buf = new Buffer(120, 28);
      panel.render(buf);
      expect(buf.toPlain().join("\n")).not.toContain("About ·");
      panel.handleKey("", key("down"));
    }

    panel.close();
  });

  it("masks provider credentials while they are being edited", () => {
    const panel = new PanelController();
    panel.open("config");
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    for (const ch of "super-secret-key") panel.handleKey(ch, key("", ch));

    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).not.toContain("super-secret-key");
    expect(plain).toContain("••••");
    expect(plain).not.toContain("code or code name");
    panel.close();
  });

  it("lets config save a source-specific key", () => {
    const panel = new PanelController();
    panel.open("config");
    for (let i = 0; i < 5; i++) panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    for (const ch of "test-llmquant-key") {
      panel.handleKey(ch, key("", ch));
    }
    panel.handleKey("", key("return"));
    panel.close();

    const settings = loadSettings();
    expect(settings.env.WHYJ_QUANT_LLMQUANT_API_KEY).toBe("test-llmquant-key");
  });

  it("lets config cycle through data sources", () => {
    const panel = new PanelController();
    panel.open("config");
    for (let i = 0; i < 4; i++) panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    panel.close();

    const settings = loadSettings();
    expect(settings.preferences.source).toBe("financial-datasets");
  });

  it("lets config toggle user-level skill integrations", () => {
    const panel = new PanelController();
    panel.open("config");
    for (let i = 0; i < 7; i++) panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    panel.close();

    const settings = loadSettings();
    expect(settings.skillIntegrations).toEqual({ external: true });
  });

  it("lets config enable automatic artifact generation", () => {
    const panel = new PanelController();
    panel.open("config");
    for (let i = 0; i < 9; i++) panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    panel.close();

    expect(loadSettings().artifactGeneration.auto).toBe(true);
  });

  it("renders a dedicated resume selector and returns a resume command", () => {
    const cwdDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    const otherDir = join(OHQ, "sessions", encodeCwd("C:\\tmp\\other-project"));
    mkdirSync(cwdDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });

    const activeId = "019eaf98-85f6-7ddc-96c1-1a32a2389963";
    const otherId = "019eaf98-85f6-7ddc-96c1-1a32a2389977";
    writeFileSync(
      join(cwdDir, `2026-06-13T08-00-00-000Z_${activeId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: activeId, timestamp: "2026-06-13T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", timestamp: "2026-06-13T08:03:00.000Z", message: { role: "user", content: "请你参考 https://github.com/earendil-works/pi 这个进行一次修改" } }),
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(otherDir, `2026-06-10T08-00-00-000Z_${otherId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: otherId, timestamp: "2026-06-10T08:00:00.000Z", cwd: "C:\\tmp\\other-project" }),
        JSON.stringify({ type: "message", id: "m2", timestamp: "2026-06-10T08:05:00.000Z", message: { role: "user", content: "Install gstack: run git clone --single-branch" } }),
      ].join("\n"),
      "utf-8",
    );

    const panel = new PanelController();
    panel.open("resume");
    panel.setCurrentSessionMeta({
      id: activeId,
      createdAt: "2026-06-13T08:00:00.000Z",
      usage: { tokens: 100, contextWindow: 1000, percent: 10 },
      entryCount: { messages: 1, compactions: 0, branches: 0 },
    });
    expect((panel as any)["mode"]).toBe("resume");

    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Resume a previous session");
    expect(plain).not.toContain("↑↓ move");
    expect(plain).not.toContain("esc close");
    expect(plain).toContain("U: 请你参考");

    const result = panel.handleKey("", key("return"));
    expect(result?.command).toContain("/resume ");
    expect(result?.close).toBe(true);
    panel.close();
  });

  it("resumes the arrow-key selected JSONL session instead of the first item", () => {
    const cwdDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    mkdirSync(cwdDir, { recursive: true });

    const firstId = "019eaf98-85f6-7ddc-96c1-1a32a2381111";
    const secondId = "019eaf98-85f6-7ddc-96c1-1a32a2382222";
    writeFileSync(
      join(cwdDir, `2026-06-13T08-00-00-000Z_${firstId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: firstId, timestamp: "2026-06-13T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", timestamp: "2026-06-13T08:03:00.000Z", message: { role: "user", content: "第一个会话" } }),
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(cwdDir, `2026-06-12T08-00-00-000Z_${secondId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: secondId, timestamp: "2026-06-12T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m2", parentId: null, timestamp: "2026-06-12T08:05:00.000Z", message: { role: "user", content: "第二个会话" } }),
        JSON.stringify({
          type: "message",
          id: "m3",
          parentId: "m2",
          timestamp: "2026-06-12T08:06:00.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "第二个会话回答" }],
            provider: "openrouter",
            model: "openai/gpt-5.5",
            api: "responses",
            usage: {
              input: 300,
              output: 100,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 400,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "end_turn",
            timestamp: Date.now(),
          },
        }),
      ].join("\n"),
      "utf-8",
    );

    const panel = new PanelController();
    panel.open("resume");
    panel.handleKey("", key("down"));
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain(`Selected: ${secondId}`);
    expect(plain).toContain("400/1,050,000");

    const result = panel.handleKey("", key("return"));
    expect(result).toEqual({ command: `/resume ${secondId}`, close: true });
    panel.close();
  });

  it("marks legacy markdown session history as unsupported in resume panel", () => {
    const legacyDir = join(OHQ, "sessions", "2026-06-10");
    const cwdDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(cwdDir, { recursive: true });

    const legacyPath = join(legacyDir, "session-031036.md");
    writeFileSync(
      legacyPath,
      [
        "# Session 2026-06-10 031036",
        "",
        "## 03:08:19 · User",
        "股票代码 — 比如 000001.SZ 或 AAPL",
        "",
        "## 03:08:24 · Assistant",
        "数据拉取遇到点问题，加日期参数再试。",
      ].join("\n"),
      "utf-8",
    );
    const activeId = "019eaf98-85f6-7ddc-96c1-1a32a2389963";
    writeFileSync(
      join(cwdDir, `2026-06-13T08-00-00-000Z_${activeId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: activeId, timestamp: "2026-06-13T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", timestamp: "2026-06-13T08:03:00.000Z", message: { role: "user", content: "新的 JSONL 会话" } }),
      ].join("\n"),
      "utf-8",
    );
    const future = new Date("2026-06-14T00:00:00.000Z");
    utimesSync(legacyPath, future, future);

    const panel = new PanelController();
    panel.open("resume");
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("[legacy]");
    expect(plain).toContain("Legacy transcript");
    expect(plain).toContain("U: 股票代码");
    expect(plain).toContain("A: 数据拉取遇到点问题");

    const result = panel.handleKey("", key("return"));
    expect(result?.command).toBeUndefined();
    const after = new Buffer(120, 28);
    panel.render(after);
    expect(after.toPlain().join("\n")).toContain("Unsupported legacy session archive");
    panel.close();
  });


  it("renders a dedicated artifact panel and returns an internal restore intent", () => {
    const sessionDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "2026-07-13T00-00-00-000Z_sess-artifact-1.jsonl"),
      JSON.stringify({
        type: "session",
        version: 3,
        id: "sess-artifact-1",
        timestamp: "2026-07-13T00:00:00.000Z",
        cwd: process.cwd(),
      }),
      "utf-8",
    );
    saveArtifact("sess-artifact-1", "<html><body>artifact</body></html>", { title: "Analysis artifact", messageCount: 3 });

    const panel = new PanelController();
    panel.open("artifact");
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Artifacts");
    expect(plain).toContain("Analysis artifact");
    expect(plain).not.toContain("Hotkeys");
    expect(plain).not.toContain("↑↓ select");
    expect(plain).not.toContain("restore & open");
    expect(plain).not.toContain("esc close");

    const open = panel.handleKey("", key("return"));
    expect(open).toEqual({ restoreArtifact: "sess-artifact-1", close: true });

    const ignored = panel.handleKey("g", key("g", "g"));
    expect(ignored).toEqual({});
    panel.close();
  });
  it("uses the same panel frame size for config, resume, and portfolio", () => {
    const configPanel = new PanelController();
    configPanel.open("config");
    const resumePanel = new PanelController();
    resumePanel.open("resume");
    const portfolioPanel = new PanelController();
    portfolioPanel.open("portfolio");

    const configBuf = new Buffer(120, 28);
    const resumeBuf = new Buffer(120, 28);
    const portfolioBuf = new Buffer(120, 28);
    configPanel.render(configBuf);
    resumePanel.render(resumeBuf);
    portfolioPanel.render(portfolioBuf);

    const configLines = configBuf.toPlain();
    const resumeLines = resumeBuf.toPlain();
    const portfolioLines = portfolioBuf.toPlain();
    const configTop = configLines.find((line) => line.includes("Settings"));
    const resumeTop = resumeLines.find((line) => line.includes("Resume a previous session"));
    const portfolioTop = portfolioLines.find((line) => line.includes("Local portfolios"));
    expect(configTop).toBeDefined();
    expect(resumeTop).toBeDefined();
    expect(portfolioTop).toBeDefined();
    expect(configTop!.indexOf("╭")).toBe(resumeTop!.indexOf("╭"));
    expect(configTop!.lastIndexOf("╮")).toBe(resumeTop!.lastIndexOf("╮"));
    expect(configTop!.indexOf("╭")).toBe(portfolioTop!.indexOf("╭"));
    expect(configTop!.lastIndexOf("╮")).toBe(portfolioTop!.lastIndexOf("╮"));
  });
});
