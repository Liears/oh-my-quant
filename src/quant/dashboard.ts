/**
 * Dashboard result aggregation — reads benchmark JSON results.
 */

export interface ResultRow {
  strategy: string;
  date: string;
  symbol: string;
  benchmarkSymbol: string;
  totalScore: number;
  grade: string;
  returnScore: number | null;
  riskScore: number | null;
  robustnessScore: number | null;
  cagr: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
  strategyFetcher: string;
  strategyMarket: string;
  benchmarkFetcher: string;
  benchmarkMarket: string;
}

export interface DashboardSummary {
  totalEvals: number;
  avgScore: number;
  medianScore: number;
  bestStrategy: string;
  bestScore: number;
  gradeDistribution: Record<string, number>;
  avgSharpe: number | null;
  avgMaxDD: number | null;
  sourceDistribution: Record<string, number>;
}

function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

export function collectResults(results: Record<string, unknown>[]): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const r of results) {
    try {
      const score = finite(r.totalScore ?? r.total_score);
      if (score === null || score < 0 || score > 100 || typeof r.strategy !== "string" || !r.strategy.trim()) continue;
      const details = (r.details || {}) as Record<string, unknown>;
      const source = (r.source || {}) as Record<string, Record<string, unknown>>;
      const stratSource = source.strategy || {};
      const benchSource = source.benchmark || {};

      rows.push({
        strategy: String(r.strategy || ""),
        date: String(r.date || ""),
        symbol: String(r.symbol || ""),
        benchmarkSymbol: String(r.benchmark_symbol || ""),
        totalScore: score,
        grade: String(r.grade || "N/A"),
        returnScore: finite(r.returnScore ?? r.return_score),
        riskScore: finite(r.riskScore ?? r.risk_score),
        robustnessScore: finite(r.robustnessScore ?? r.robustness_score),
        cagr: finite(details.cagr),
        sharpe: typeof details.sharpe === "number" && Number.isFinite(details.sharpe) ? details.sharpe : null,
        maxDrawdown: finite(details.maxDrawdown ?? details.max_drawdown),
        strategyFetcher: String(stratSource.fetcher || ""),
        strategyMarket: String(stratSource.market || ""),
        benchmarkFetcher: String(benchSource.fetcher || ""),
        benchmarkMarket: String(benchSource.market || ""),
      });
    } catch {
      // skip malformed result
    }
  }
  return rows;
}

export function rankResults(rows: ResultRow[], sortBy: "score" | "cagr" | "sharpe" = "score"): ResultRow[] {
  const key = sortBy === "score" ? "totalScore" : sortBy;
  return [...rows].sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity)).slice(0, 10);
}

export function dashboardSummary(rows: ResultRow[]): DashboardSummary {
  if (rows.length === 0) {
    return {
      totalEvals: 0,
      avgScore: 0,
      medianScore: 0,
      bestStrategy: "",
      bestScore: 0,
      gradeDistribution: {},
      avgSharpe: null,
      avgMaxDD: null,
      sourceDistribution: {},
    };
  }

  const scores = rows.map((r) => r.totalScore);
  const sharpes = rows.map(r => r.sharpe).filter((value): value is number => value !== null);
  const drawdowns = rows.map(r => r.maxDrawdown).filter((value): value is number => value !== null);
  const sorted = [...scores].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const bestIdx = scores.indexOf(Math.max(...scores));

  const gradeDist = new Map<string, number>();
  for (const r of rows) {
    gradeDist.set(r.grade, (gradeDist.get(r.grade) ?? 0) + 1);
  }

  const sourceDist = new Map<string, number>();
  for (const r of rows) {
    sourceDist.set(r.strategyFetcher, (sourceDist.get(r.strategyFetcher) ?? 0) + 1);
  }

  return {
    totalEvals: rows.length,
    avgScore: Math.round((scores.reduce((a, b) => a + b, 0) / rows.length) * 100) / 100,
    medianScore: Math.round(median * 100) / 100,
    bestStrategy: rows[bestIdx]?.strategy || "",
    bestScore: scores[bestIdx] || 0,
    gradeDistribution: Object.fromEntries(gradeDist),
    avgSharpe: sharpes.length ? Math.round((sharpes.reduce((sum, value) => sum + value, 0) / sharpes.length) * 100) / 100 : null,
    avgMaxDD: drawdowns.length ? Math.round((drawdowns.reduce((sum, value) => sum + value, 0) / drawdowns.length) * 10000) / 10000 : null,
    sourceDistribution: Object.fromEntries(sourceDist),
  };
}
