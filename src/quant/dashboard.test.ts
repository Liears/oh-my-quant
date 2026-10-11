import { expect, it } from "bun:test";
import { collectResults, dashboardSummary, rankResults } from "./dashboard.ts";

it("calculates even and odd medians from the complete cohort, independent of ranking", () => {
  const rows = collectResults([10, 30, 50, 90].map((totalScore, i) => ({ strategy: `s${i}`, totalScore })));
  expect(dashboardSummary(rows)).toMatchObject({ totalEvals: 4, avgScore: 45, medianScore: 40, bestScore: 90 });
  expect(dashboardSummary(rows.slice(0, 3)).medianScore).toBe(30);
  expect(dashboardSummary([])).toMatchObject({ totalEvals: 0, avgSharpe: null, avgMaxDD: null });
});

it("does not turn invalid results or absent metrics into zero performance", () => {
  const rows = collectResults([{}, { strategy: "bad", totalScore: Infinity }, { strategy: "text", totalScore: "50" },
    { strategy: "missing", totalScore: 0 }, { strategy: "measured", totalScore: 20, details: { sharpe: 2, maxDrawdown: -0.1 } }]);
  expect(rows.map(row => row.strategy)).toEqual(["missing", "measured"]);
  expect(rows[0]).toMatchObject({ cagr: null, sharpe: null, maxDrawdown: null });
  expect(dashboardSummary(rows)).toMatchObject({ avgSharpe: 2, avgMaxDD: -0.1 });
});

it("keeps missing metrics last, stable ties and a top-ten limit without truncating summary", () => {
  const rows = collectResults(Array.from({ length: 12 }, (_, i) => ({ strategy: `s${i}`, totalScore: i, details: i === 11 ? {} : { sharpe: i === 0 ? -1 : 1 } })));
  expect(rankResults(rows, "sharpe").map(row => row.strategy)).toEqual(Array.from({ length: 10 }, (_, i) => `s${i + 1}`));
  expect(rankResults(rows, "score")[0]!.strategy).toBe("s11");
  expect(dashboardSummary(rows).totalEvals).toBe(12);
});
