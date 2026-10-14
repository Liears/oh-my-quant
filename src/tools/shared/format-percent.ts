/** Preserve ordinary formatting; shift a decimal exponent when value * 100 would overflow. */
export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) throw new Error("Cannot format a nonfinite percentage.");
  const percent = value * 100;
  if (Number.isFinite(percent)) return `${percent.toFixed(digits)}%`;
  const [coefficient, exponent] = value.toExponential(digits).split("e");
  return `${coefficient}e+${Number(exponent) + 2}%`;
}
