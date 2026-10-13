import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppRuntime } from "./app-runtime.ts";
import { saveSettings } from "./storage/index.ts";
import { DEFAULT_SETTINGS } from "./types/config.ts";

const originalRoot = process.env.OHQUANT_DIR;
const roots: string[] = [];
afterEach(() => {
  if (originalRoot === undefined) delete process.env.OHQUANT_DIR;
  else process.env.OHQUANT_DIR = originalRoot;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["fund", "factor"] as const)("archives a correct %s answer with Chinese qualifications", async kind => {
  const root = mkdtempSync(join(tmpdir(), "whyj-answer-qualifiers-"));
  roots.push(root);
  process.env.OHQUANT_DIR = root;
  saveSettings({ ...DEFAULT_SETTINGS, artifactGeneration: { auto: true } });
  const parameters = kind === "fund"
    ? { symbol: "270042", start_date: "2026-02-01", end_date: "2026-03-01", invest_amount: 100,
      frequency: "monthly", invest_day: 1, purchase_fee_rate: 0, purchase_fee_unit: "decimal" }
    : { symbol: "AAPL", factor: "momentum", period: 2, start: "2026-01-01", end: "2026-02-09" };
  const tool = kind === "fund" ? "fund_dca_backtest" : "compute_factor";
  const evidence = { callId: "verified-call", callEntryId: "verified-entry" };
  const research = {
    task: { status: "complete", spec: { scope: { symbols: [parameters.symbol], market: kind === "fund" ? "A" : "US",
      start: kind === "fund" ? "2026-02-01" : "2026-01-01", end: kind === "fund" ? "2026-03-01" : "2026-02-09" },
      criteria: [{ id: "result", tool, parameters, metrics: kind === "fund" ? ["Principal return", "Time-weighted return", "Maximum drawdown (TWR)"] : ["Latest"] }] },
      criteria: [{ id: "result", status: "satisfied", evidence }] },
    operations: [{ ...evidence, tool, status: "verified", parameters, findings: { kind: kind === "fund" ? "fund-dca" : "factor",
      metrics: kind === "fund"
        ? [{ label: "Principal return", value: 0.25 }, { label: "Time-weighted return", value: 0.5 }, { label: "Maximum drawdown (TWR)", value: 0 }]
        : [{ label: "Latest", value: 0.014598540145985384, unit: "number" }] } }],
  };
  const answer = kind === "fund" ? "本金收益率 +25.00%\n时间加权收益率 +50.00%\n最大回撤 (TWR口径) 0.00%"
    : "Latest 0.0146。momentum 分位不预测后续收益或均值回归。";
  type Event = { type: string; [key: string]: unknown };
  const listeners: Array<(event: Event) => void | Promise<void>> = [];
  const emit = async (event: Event) => { for (const listener of listeners) await listener(event); };
  const agent = {
    state: { isStreaming: false, pendingToolCalls: new Set<string>(), messages: [], thinkingText: "" },
    subscribe(listener: (event: Event) => void | Promise<void>) { listeners.push(listener); return () => {}; },
    async prompt() {
      await emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: answer }], usage: { output: 10 } } });
      await emit({ type: "agent_end", messages: [] });
    },
    getResearchState: async () => research,
    abort() {}, waitForIdle: async () => {},
  };
  const errors: string[] = [];
  const reports: string[] = [];
  const runtime = new AppRuntime({ onMessages: messages => errors.push(...messages.filter(message => message.role === "error").map(message => message.text ?? "")),
    onActivity: () => {}, onPanel: () => {} }, async () => [], async () => [], () => agent as never,
    async () => { reports.push(kind); return { success: true, message: `${kind} report` }; }, undefined, undefined, 0);
  try {
    await runtime.bootstrap();
    await runtime.submit(kind === "fund" ? "分析基金 270042.OF 的定投收益和回撤" : "分析 AAPL 的动量和风险");
    expect(errors).toEqual([]);
    expect(reports).toEqual([kind]);
  } finally { runtime.dispose(); }
});
