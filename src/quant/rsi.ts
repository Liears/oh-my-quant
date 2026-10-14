/** Wilder RSI, seeded with the first N close-to-close changes. */
export function rsi(close: number[], n = 14): (number | null)[] {
  const result: (number | null)[] = new Array(close.length).fill(null);
  if (close.length <= n) return result;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= n; i++) {
    const change = close[i]! - close[i - 1]!;
    avgGain += Math.max(change, 0) / n;
    avgLoss += Math.max(-change, 0) / n;
  }
  for (let i = n; i < close.length; i++) {
    if (i > n) {
      const change = close[i]! - close[i - 1]!;
      avgGain = (avgGain * (n - 1) + Math.max(change, 0)) / n;
      avgLoss = (avgLoss * (n - 1) + Math.max(-change, 0)) / n;
    }
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}
