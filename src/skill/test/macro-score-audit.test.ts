import { expect, test } from "bun:test";
import { MACRO_ETFS, parseMacroInput, type MacroEtf, type MacroPriceBar } from "../macro-input-audit.ts";
import { auditMacroScoresFromInputs } from "../macro-score-audit.ts";

test("flat captured ETF closes imply a converging score of 25, and forged signals fail independently", () => {
  const last = new Date("2026-09-15T00:00:00.000Z");
  const historical = Array.from({ length: 600 }, (_, index) => {
    const day = new Date(last); day.setUTCDate(last.getUTCDate() - index);
    return { date: day.toISOString().slice(0, 10), open: 100, high: 100, low: 100,
      close: 100, adjClose: 100, volume: 1000 };
  });
  const inputs = Object.fromEntries(MACRO_ETFS.map(symbol => [symbol,
    parseMacroInput({ symbol, historical }, symbol).bars])) as Record<MacroEtf, MacroPriceBar[]>;
  const names = ["concentration", "yield_curve", "credit_conditions", "size_factor", "equity_bond", "sector_rotation"];
  const components = Object.fromEntries(names.map(name => [name, {
    score: 25, crossover: { type: "converging", bars_ago: null as number | null, gap_pct: 0 },
    direction: ({ concentration: "concentrating", yield_curve: "stable", credit_conditions: "stable",
      size_factor: "neutral", equity_bond: "neutral", sector_rotation: "neutral" } as Record<string, string>)[name],
    momentum_qualifier: "N/A", correlation_6m: 0, correlation_12m: 0, correlation_regime: "near_zero",
  }]));
  const report = { components };
  expect(auditMacroScoresFromInputs(report, inputs)).toEqual([]);
  components.credit_conditions!.score = 60;
  components.size_factor!.crossover.bars_ago = 4;
  components.sector_rotation!.direction = "risk_on";
  components.equity_bond!.correlation_6m = 0.5;
  expect(auditMacroScoresFromInputs(report, inputs)).toEqual(expect.arrayContaining([
    "wrong-transition-score-credit_conditions", "wrong-crossover-size_factor",
    "wrong-direction-sector_rotation", "wrong-equity-bond-correlation",
  ]));
});
