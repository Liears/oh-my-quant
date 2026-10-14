/** Same-period, same-currency total returns; tolerance only absorbs floating point noise. */
export function compareTotalReturns(portfolio: number, benchmark: number) {
  if (!Number.isFinite(portfolio) || !Number.isFinite(benchmark)) throw new Error("Total returns must be finite.");
  const excessReturn = portfolio - benchmark;
  if (!Number.isFinite(excessReturn)) throw new Error("Return difference exceeds supported numeric range.");
  return { excessReturn, direction: Math.abs(excessReturn) <= 1e-12 ? "matched" as const
    : excessReturn > 0 ? "outperformed" as const : "underperformed" as const };
}
