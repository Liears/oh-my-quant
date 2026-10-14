import { expect, test } from "bun:test";
import { auditMacroReportFromInputs, MACRO_ETFS, parseMacroInput, type MacroEtf, type MacroPriceBar } from "../macro-input-audit.ts";

function history(close = 100): Record<string, unknown> {
  const last = new Date("2026-09-15T00:00:00.000Z");
  return { symbol: "RSP", historical: Array.from({ length: 600 }, (_, index) => {
    const day = new Date(last); day.setUTCDate(last.getUTCDate() - index);
    return { date: day.toISOString().slice(0, 10), open: close, high: close, low: close,
      close, adjClose: close, volume: 1000 };
  }) };
}

test("captured macro price response requires ordered adjusted OHLCV and the exact ETF identity", () => {
  const valid = parseMacroInput(history(), "RSP");
  expect(valid.receipt).toMatchObject({ rows: 600, latestDate: "2026-09-15" });
  const duplicate = history();
  const rows = duplicate.historical as Array<Record<string, unknown>>;
  rows[1]!.date = rows[0]!.date;
  expect(() => parseMacroInput(duplicate, "RSP")).toThrow("date order");
  rows[1]!.date = "2026-09-14"; rows[1]!.high = 90;
  expect(() => parseMacroInput(duplicate, "RSP")).toThrow("adjusted OHLCV");
  expect(() => parseMacroInput(history(), "SPY")).toThrow("scope or coverage");
});

test("six monthly ratio checks reject a changed price or report value independently of composite arithmetic", () => {
  const base = parseMacroInput(history(), "RSP").bars;
  const inputs = Object.fromEntries(MACRO_ETFS.map(symbol => [symbol, structuredClone(base)])) as Record<MacroEtf, MacroPriceBar[]>;
  const months = new Set(base.map(bar => bar.date.slice(0, 7))).size;
  const names = ["concentration", "yield_curve", "credit_conditions", "size_factor", "equity_bond", "sector_rotation"];
  const components = Object.fromEntries(names.map(name => [name, { data_available: true, current_date: "2026-09-15",
    current_ratio: 1, proxy_ratio: 1, monthly_points: months, sma_6m: 1, sma_12m: 1,
    roc_3m: 0, roc_12m: 0, percentile: 0 }]));
  const report = { components };
  expect(auditMacroReportFromInputs(report, inputs)).toEqual([]);
  (components.equity_bond as Record<string, unknown>).current_ratio = 2;
  expect(auditMacroReportFromInputs(report, inputs)).toContain("wrong-monthly-ratio-or-window-equity_bond");
  (components.equity_bond as Record<string, unknown>).current_ratio = 1;
  inputs.RSP[0]!.close = 150;
  expect(auditMacroReportFromInputs(report, inputs)).toContain("wrong-monthly-ratio-or-window-concentration");
});
