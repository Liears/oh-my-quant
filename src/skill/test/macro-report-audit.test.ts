import { expect, test } from "bun:test";
import { auditMacroPresentation, auditMacroReport } from "../macro-report-audit.ts";

const weights = { concentration: 0.25, yield_curve: 0.20, credit_conditions: 0.15,
  size_factor: 0.15, equity_bond: 0.15, sector_rotation: 0.10 } as const;
const scores = { concentration: 50, yield_curve: 50, credit_conditions: 50,
  size_factor: 50, equity_bond: 50, sector_rotation: 50 } as const;

function receipt(): Record<string, unknown> {
  const components = Object.fromEntries(Object.entries(scores).map(([key, score]) => [key,
    { score, data_available: true }]));
  const component_scores = Object.fromEntries(Object.entries(scores).map(([key, score]) => [key,
    { score, weight: weights[key as keyof typeof weights], weighted_contribution: score * weights[key as keyof typeof weights] }]));
  return { metadata: { data_source: "yfinance", data_mode: "yfinance_only",
    etfs_analyzed: ["RSP", "SPY", "IWM", "TLT", "SHY", "HYG", "LQD", "XLY", "XLP"] },
  components, composite: { composite_score: 50, zone: "Transition Zone (Preparing)",
    data_quality: { available_count: 6, total_components: 6 }, signaling_components: 6,
    strongest_signal: { component: "concentration", score: 50 },
    weakest_signal: { component: "concentration", score: 50 }, component_scores } };
}

function presentation(source = "yfinance"): string {
  return [
    `**Data Source:** ${source}`,
    "| **Transition Score** | **50/100** |",
    "| **Signal Zone** | Transition Zone (Preparing) |",
    "| **Components Signaling** | 6/6 |",
    "| **Data Quality** | Complete (6/6 components) |",
    "## 2. Transition Signal Dashboard",
    "| # | Component | Weight | Score |",
    "| 1 | **Market Concentration (RSP/SPY)** | 25% | ███░ 50 |",
    "| 2 | **Yield Curve (10Y-2Y)** | 20% | ███░ 50 |",
    "| 3 | **Credit Conditions (HYG/LQD)** | 15% | ███░ 50 |",
    "| 4 | **Size Factor (IWM/SPY)** | 15% | ███░ 50 |",
    "| 5 | **Equity-Bond (SPY/TLT)** | 15% | ███░ 50 |",
    "| 6 | **Sector Rotation (XLY/XLP)** | 10% | ███░ 50 |",
    "## 3. Component Details",
  ].join("\n");
}

test("independent pinned macro receipt audit accepts a consistent six-component public report", () => {
  expect(auditMacroReport(receipt())).toEqual([]);
});

test("macro receipt audit detects altered score, component contribution, zone and input mode", () => {
  const forged = receipt();
  const composite = forged.composite as Record<string, unknown>;
  composite.composite_score = 80;
  composite.zone = "Confirmed Transition (Completing)";
  const rows = composite.component_scores as Record<string, Record<string, unknown>>;
  rows.concentration!.weighted_contribution = 15;
  (forged.metadata as Record<string, unknown>).data_mode = "fmp";
  expect(auditMacroReport(forged)).toEqual(expect.arrayContaining([
    "wrong-public-input-mode", "invalid-component-concentration", "wrong-composite-arithmetic", "wrong-transition-zone",
  ]));
});

test("macro receipt audit does not mistake absent or unusable components for a complete report", () => {
  const missing = receipt();
  delete (missing.components as Record<string, unknown>).yield_curve;
  expect(auditMacroReport(missing)).toEqual(expect.arrayContaining(["invalid-component-yield_curve", "missing-component-scores"]));
  expect(auditMacroReport({ composite: {} })).toEqual(["incomplete-report"]);
});

test("macro presentation audit exposes the pinned Markdown's FMP header under yfinance-only JSON", () => {
  expect(auditMacroPresentation(receipt(), presentation("FMP API (0 calls)"))).toEqual(["markdown-source-label-conflicts-with-json"]);
  expect(auditMacroPresentation(receipt(), presentation())).toEqual([]);
  expect(auditMacroPresentation(receipt(), presentation("yfinance + FMP API (0 calls)")))
    .toContain("markdown-source-label-conflicts-with-json");
});

test("macro presentation audit detects a false dashboard score even when JSON arithmetic and headline pass", () => {
  const markdown = presentation().replace("**Yield Curve (10Y-2Y)** | 20% | ███░ 50", "**Yield Curve (10Y-2Y)** | 20% | ███░ 70");
  expect(auditMacroReport(receipt())).toEqual([]);
  expect(auditMacroPresentation(receipt(), markdown)).toEqual(["markdown-component-dashboard-mismatch"]);
  expect(auditMacroPresentation(receipt(), presentation().replace("6/6 components", "5/6 components")))
    .toEqual(["markdown-data-quality-mismatch"]);
});
