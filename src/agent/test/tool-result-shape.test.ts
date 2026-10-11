import { expect, it } from "bun:test";
import { inferResultShape } from "../src/tool-result-shape.ts";

it("keeps stable hints for built-in tools even when result text is missing or localized", () => {
  expect(inferResultShape("fetch_bars")).toBe("bars_summary");
  expect(inferResultShape("check_risk", { content: [{ type: "text", text: "风险分析" }] })).toBe("risk_metrics");
  expect(inferResultShape("show_dashboard", { details: { summary: {} } })).toBe("dashboard_ranking");
});

it("recognizes external result text and handles malformed results and object-key names", () => {
  expect(inferResultShape("external", { content: [null, { type: "image" }, { type: "text", text: "Total Return 10%; Sharpe 1.0" }] })).toBe("backtest_metrics");
  expect(inferResultShape("constructor", null)).toBeNull();
  expect(inferResultShape("external", { content: {} })).toBeNull();
  expect(inferResultShape("akshare_fund_custom", { details: { endpoint: "custom", rows: [] } })).toBe("fund_akshare_endpoint");
});
