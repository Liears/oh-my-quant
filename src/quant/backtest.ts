/** Self-financing long-only ledger. Previous-bar targets execute at the next close. */
export * from "./performance.ts";

export interface BacktestResult {
  equity: number[];
  returns: number[];
  cash: number[];
  position: number[];
  trade: number[];
  cost: number[];
}

export function validateBacktestCosts(commission: number, stampDuty: number): void {
  if (![commission, stampDuty].every(rate => Number.isFinite(rate) && rate >= 0) || commission + stampDuty >= 1)
    throw new Error("Cost rates must be nonnegative with a combined rate below 1.");
}

export function vectorizedBacktest(
  signals: number[],
  prices: number[],
  initialCash = 100_000,
  commission = 0.0003,
  stampDuty = 0,
): BacktestResult {
  const n = prices.length;
  if (n < 2 || signals.length !== n) throw new Error("Signals and prices must have the same length, at least 2.");
  if (prices.some(price => !Number.isFinite(price) || price <= 0))
    throw new Error("Prices must be finite and positive.");
  if (signals.some(weight => !Number.isFinite(weight) || weight < 0 || weight > 1))
    throw new Error("Target weights must be finite values in [0, 1].");
  if (!Number.isFinite(initialCash) || initialCash <= 0)
    throw new Error("Initial cash must be finite and positive.");
  validateBacktestCosts(commission, stampDuty);
  const equity = new Array<number>(n).fill(initialCash);
  const cash = new Array<number>(n).fill(initialCash);
  const position = new Array<number>(n).fill(0);
  const trade = new Array<number>(n).fill(0);
  const cost = new Array<number>(n).fill(0);
  const returns = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const price = prices[i], previousShares = position[i - 1], target = signals[i - 1];
    const markedEquity = cash[i - 1] + previousShares * price;
    const beforeCosts = target * markedEquity / price - previousShares;
    const rate = beforeCosts >= 0 ? commission : commission + stampDuty;
    // Solve target * post-fee equity = post-trade shares * price.
    trade[i] = beforeCosts / (beforeCosts >= 0 ? 1 + target * rate : 1 - target * rate);
    position[i] = target === 0 ? 0 : previousShares + trade[i];
    cost[i] = Math.abs(trade[i]) * price * rate;
    cash[i] = cash[i - 1] - trade[i] * price - cost[i];
    if (Math.abs(cash[i]) < Math.max(1, markedEquity) * 1e-12) cash[i] = 0;
    equity[i] = cash[i] + position[i] * price;
    if (![equity[i], cash[i], position[i], cost[i]].every(Number.isFinite) || cash[i] < 0 || equity[i] <= 0)
      throw new Error("Backtest ledger exceeded its finite, non-borrowing domain.");
    returns[i] = equity[i] / equity[i - 1] - 1;
  }
  return { equity, returns, cash, position, trade, cost };
}

/** SMA signal generation: 1 when fast > slow, 0 otherwise */
export function smaSignals(close: number[], fast: number, slow: number): number[] {
  if (!Number.isInteger(fast) || !Number.isInteger(slow) || fast < 1 || slow <= fast)
    throw new Error("SMA requires positive integer periods with fast < slow.");
  if (close.some(price => !Number.isFinite(price) || price <= 0))
    throw new Error("SMA prices must be finite and positive.");
  const signals: number[] = new Array(close.length).fill(0);
  const fastMA = rollingMean(close, fast);
  const slowMA = rollingMean(close, slow);
  for (let i = slow - 1; i < close.length; i++) {
    if (fastMA[i] !== null && slowMA[i] !== null) {
      signals[i] = fastMA[i]! > slowMA[i]! ? 1 : 0;
    }
  }
  return signals;
}

function rollingMean(values: number[], n: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < n) return result;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i]!;
  result[n - 1] = sum / n;
  for (let i = n; i < values.length; i++) {
    sum += values[i]! - values[i - n]!;
    result[i] = sum / n;
  }
  return result;
}
