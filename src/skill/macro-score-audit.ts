/** Replays the pinned public macro scorer from captured adjusted ETF closes. */
import {
  MACRO_PAIRS, macroMonthlyBars, macroRatioSeries, type MacroEtf, type MacroPriceBar,
} from "./macro-input-audit.ts";

type CrossType = "golden_cross" | "death_cross" | "converging" | "none";
type Cross = { type: CrossType; barsAgo: number | null; gapPct: number | null };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mean(values: number[], count: number): number | null {
  return values.length < count ? null : values.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
}

function roc(values: number[], months: number): number | null {
  return values.length <= months || values[months] === 0 ? null
    : (values[0]! - values[months]!) / values[months]! * 100;
}

function roundHalfEven(value: number, places: number): number {
  const scale = 10 ** places, scaled = value * scale, lower = Math.floor(scaled);
  const nearest = Math.abs(scaled - lower - 0.5) < 1e-10 ? lower + Math.abs(lower % 2) : Math.round(scaled);
  return nearest / scale;
}

function cross(values: number[]): Cross {
  if (values.length < 15) return { type: "none", barsAgo: null, gapPct: null };
  const count = Math.min(values.length, 24) - 11;
  const averages = Array.from({ length: count }, (_, offset) => ({
    short: mean(values.slice(offset), 6)!, long: mean(values.slice(offset), 12)!,
  }));
  const current = averages[0]!;
  const gapPct = current.long === 0 ? 0 : (current.short - current.long) / current.long * 100;
  const reportedGap = roundHalfEven(gapPct, 3);
  for (let index = 1; index < averages.length; index++) {
    const previous = averages[index]!, newer = averages[index - 1]!;
    if (previous.short <= previous.long && newer.short > newer.long)
      return { type: "golden_cross", barsAgo: index - 1, gapPct: reportedGap };
    if (previous.short >= previous.long && newer.short < newer.long)
      return { type: "death_cross", barsAgo: index - 1, gapPct: reportedGap };
  }
  return { type: Math.abs(gapPct) < 1 ? "converging" : "none", barsAgo: null, gapPct: reportedGap };
}

function transitionScore(crossover: Cross, shortRoc: number | null, longRoc: number | null,
  shortSma: number | null, longSma: number | null): number {
  const isCross = crossover.type === "golden_cross" || crossover.type === "death_cross";
  let score = 0;
  if (isCross) score += crossover.barsAgo !== null && crossover.barsAgo <= 2 ? 40
    : crossover.barsAgo !== null && crossover.barsAgo <= 5 ? 30 : 20;
  else if (crossover.type === "converging") score += Math.floor(Math.max(0, 1 - Math.abs(crossover.gapPct ?? 0)) * 25);
  if (shortRoc !== null && longRoc !== null) {
    if (longRoc < 0 && shortRoc > 0 || longRoc > 0 && shortRoc < 0)
      score += Math.floor(Math.min(Math.abs(shortRoc), 5) / 5 * 30);
    else if (Math.abs(shortRoc) > 3) score += 10;
  }
  let confirmations = isCross ? 1 : 0;
  if (crossover.type === "golden_cross" && shortRoc !== null && shortRoc > 0
    || crossover.type === "death_cross" && shortRoc !== null && shortRoc < 0) confirmations++;
  if (shortSma !== null && longSma !== null && longSma !== 0
    && Math.abs(shortSma - longSma) / longSma * 100 > 0.5) confirmations++;
  return Math.min(100, Math.max(0, score + confirmations * 10));
}

function direction(crossover: Cross, shortRoc: number | null, positive: string, negative: string, neutral: string,
  fallback?: { short: number | null; long: number | null }): { value: string; qualifier: string } {
  const crossDirection = crossover.type === "golden_cross" ? positive : crossover.type === "death_cross" ? negative : null;
  const momentumDirection = shortRoc !== null && shortRoc > 0 ? positive : shortRoc !== null && shortRoc < 0 ? negative : null;
  const stale = crossover.barsAgo !== null && crossover.barsAgo >= 3;
  if (crossDirection) {
    if (stale && momentumDirection && momentumDirection !== crossDirection)
      return { value: momentumDirection, qualifier: "reversing" };
    return { value: crossDirection, qualifier: momentumDirection === crossDirection ? "confirmed"
      : momentumDirection ? "fading" : "N/A" };
  }
  if (fallback && fallback.short !== null && fallback.long !== null)
    return { value: fallback.short > fallback.long ? positive : negative, qualifier: "N/A" };
  return { value: momentumDirection ?? neutral, qualifier: "N/A" };
}

function monthlyReturns(bars: MacroPriceBar[]): number[] {
  const closes = macroMonthlyBars(bars).map(bar => bar.close);
  return closes.slice(0, -1).map((close, index) => (close - closes[index + 1]!) / closes[index + 1]!);
}

function correlation(left: number[], right: number[], window: number): number | null {
  if (left.length < window || right.length < window) return null;
  const a = left.slice(0, window), b = right.slice(0, window);
  const meanA = mean(a, window)!, meanB = mean(b, window)!;
  const covariance = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index]! - meanB), 0) / window;
  const stdA = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0) / window);
  const stdB = Math.sqrt(b.reduce((sum, value) => sum + (value - meanB) ** 2, 0) / window);
  return stdA === 0 || stdB === 0 ? 0 : covariance / (stdA * stdB);
}

function closeToRounded(value: unknown, expected: number | null, places: number): boolean {
  return expected === null ? value === null : typeof value === "number" && Number.isFinite(value)
    && Math.abs(value - expected) <= 0.5 * 10 ** -places + 1e-8;
}

/** Checks crossover, direction, momentum qualifier and score; the upstream prose remains unverified. */
export function auditMacroScoresFromInputs(rawReport: unknown, inputs: Record<MacroEtf, MacroPriceBar[]>): string[] {
  const components = object(object(rawReport)?.components);
  if (!components) return ["missing-macro-components"];
  const issues: string[] = [];
  for (const pair of MACRO_PAIRS) {
    const item = object(components[pair.component]);
    const numerator = inputs[pair.numerator], denominator = inputs[pair.denominator];
    if (!item || !numerator?.length || !denominator?.length) {
      issues.push(`missing-score-input-or-component-${pair.component}`); continue;
    }
    const values = macroRatioSeries(numerator, denominator).map(point => point.value);
    if (values.length < 15) { issues.push(`short-score-window-${pair.component}`); continue; }
    const crossover = cross(values), reportedCross = object(item.crossover);
    if (!reportedCross || reportedCross.type !== crossover.type || reportedCross.bars_ago !== crossover.barsAgo
      || reportedCross.gap_pct !== crossover.gapPct)
      issues.push(`wrong-crossover-${pair.component}`);
    const shortRoc = roc(values, 3), longRoc = roc(values, 12);
    const shortSma = mean(values, 6), longSma = mean(values, 12);
    let score = transitionScore(crossover, shortRoc, longRoc, shortSma, longSma);
    if (pair.component === "equity_bond") {
      const six = correlation(monthlyReturns(inputs.SPY), monthlyReturns(inputs.TLT), 6);
      const twelve = correlation(monthlyReturns(inputs.SPY), monthlyReturns(inputs.TLT), 12);
      if (!closeToRounded(item.correlation_6m, six, 3) || !closeToRounded(item.correlation_12m, twelve, 3))
        issues.push("wrong-equity-bond-correlation");
      const regime = six === null ? "unknown" : six < -0.3 ? "negative_strong" : six < 0 ? "negative_mild"
        : six < 0.3 ? "near_zero" : "positive";
      if (item.correlation_regime !== regime) issues.push("wrong-equity-bond-correlation-regime");
      if (six !== null && twelve !== null) score = Math.min(100, score
        + ((six > 0) !== (twelve > 0) ? 20 : Math.abs(six - twelve) > 0.3 ? 10 : 0));
    }
    if (item.score !== score) issues.push(`wrong-transition-score-${pair.component}`);
    const labels: Record<string, [string, string, string]> = {
      concentration: ["broadening", "concentrating", "unknown"],
      credit_conditions: ["easing", "tightening", "stable"],
      size_factor: ["small_cap_leading", "large_cap_leading", "neutral"],
      equity_bond: ["risk_on", "risk_off", "neutral"],
      sector_rotation: ["risk_on", "risk_off", "neutral"],
    };
    if (pair.component === "yield_curve") {
      const expected = shortRoc !== null && shortRoc < 0 ? "steepening"
        : shortRoc !== null && shortRoc > 0 ? "flattening" : "stable";
      if (item.direction !== expected) issues.push("wrong-direction-yield_curve");
    } else {
      const [positive, negative, neutral] = labels[pair.component]!;
      const expected = direction(crossover, shortRoc, positive, negative, neutral,
        pair.component === "concentration" ? { short: shortSma, long: longSma } : undefined);
      if (item.direction !== expected.value || item.momentum_qualifier !== expected.qualifier)
        issues.push(`wrong-direction-${pair.component}`);
    }
  }
  return issues;
}
