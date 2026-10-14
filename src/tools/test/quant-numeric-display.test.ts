import { expect, test } from "bun:test";
import { createPriceAnalysisTools } from "../quant-tools.ts";
import type { Bar } from "../../types/data.ts";

test("risk text preserves finite metrics when percentage conversion exceeds Number range", async () => {
  const bars: Bar[] = Array.from({ length: 100 }, (_, index) => {
    const close = index === 99 ? 1e307 : 0.1;
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    return { date, open: close, high: close, low: close, close, volume: 1, amount: close };
  });
  const { checkRiskTool } = createPriceAnalysisTools(async () => ({ bars, source: "financial-datasets",
    origin: "provider", asOfDate: bars.at(-1)!.date, attempts: [] }));
  const result = await checkRiskTool.execute("finite-percentage", { symbol: "AAPL" });
  const details = result.details as { annualVol: number; var95Parametric: number };
  expect(Number.isFinite(details.annualVol)).toBe(true);
  expect(details.annualVol).toBeGreaterThan(Number.MAX_VALUE / 100);
  const text = result.content.map(part => part.type === "text" ? part.text : "").join("\n");
  expect(text).not.toMatch(/Infinity|NaN/);
  expect(text).toMatch(/Annual vol\s+1\.60e\+310%/);
});
