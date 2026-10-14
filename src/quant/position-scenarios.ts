/** Explicit supplied long-position inputs; no account, quote, fee or option evidence is inferred. */
export interface PositionScenarioInputs {
  shares: number;
  costPerShare: number;
  observedClose: number;
}

export function calculatePositionScenarios(position: PositionScenarioInputs, changes: readonly number[]) {
  if (![position.shares, position.costPerShare, position.observedClose].every(value => Number.isFinite(value) && value > 0)
    || changes.length > 32 || changes.some(change => !Number.isFinite(change) || change < -1)) {
    throw new Error("Position scenarios require positive finite supplied inputs and at most 32 finite price changes of -100% or greater.");
  }
  const cost = position.shares * position.costPerShare;
  if (!Number.isFinite(cost) || cost <= 0) throw new Error("Position scenario cost overflow or underflow.");
  return changes.map(change => {
    const price = position.observedClose * (1 + change), value = position.shares * price;
    const profitLoss = value - cost, returnOnCost = profitLoss / cost;
    if (![cost, price, value, profitLoss, returnOnCost].every(Number.isFinite)) throw new Error("Position scenario arithmetic overflow.");
    return { change, price, value, profitLoss, returnOnCost };
  });
}
