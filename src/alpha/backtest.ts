import { calendarYears, report } from "../quant/index.ts";
import type { AlphaBacktestRequest, AlphaBacktestResult, AlphaFill, AlphaOrder } from "../types/alpha.ts";
import { AlphaEngineError } from "./types.ts";
import { AKQUANT_RULE_VERSION, AKQUANT_VERSION, finite, identifier, record } from "./validation.ts";

function agrees(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-8;
}

/** Verify the engine result with a separate self-financing ledger before publishing it. */
export function validateAlphaResult(output: string, request: AlphaBacktestRequest, signals: number[], inputHash: string): AlphaBacktestResult {
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { throw new AlphaEngineError("output", "Alpha engine did not return JSON."); }
  const raw = record(parsed, ["error", "protocol", "engine", "inputHash", "curve", "fills", "orders"], "output");
  if (raw.error !== undefined) {
    const code = raw.error === "unavailable" || raw.error === "version" ? raw.error : "process";
    throw new AlphaEngineError(code, `Alpha engine reported ${code}.`);
  }
  const engine = record(raw.engine, ["name", "version", "ruleVersion", "python"], "output");
  if (engine.name !== "akquant" || engine.version !== AKQUANT_VERSION || engine.ruleVersion !== AKQUANT_RULE_VERSION)
    throw new AlphaEngineError("version", "Alpha engine version does not match the verified adapter.");
  if (raw.protocol !== 1 || raw.inputHash !== inputHash || typeof engine.python !== "string" || !/^\d+\.\d+\.\d+$/.test(engine.python)
    || !Array.isArray(raw.curve) || raw.curve.length !== request.bars.length || !Array.isArray(raw.fills) || !Array.isArray(raw.orders))
    throw new AlphaEngineError("output", "Incomplete alpha response or mismatched input identity.");
  const dates = new Set(request.bars.map(bar => bar.date));
  const orders: AlphaOrder[] = raw.orders.map(value => {
    const row = record(value, ["id", "symbol", "side", "createdDate", "quantity", "filledQuantity", "status"], "output");
    if (row.symbol !== request.symbol || (row.side !== "buy" && row.side !== "sell")
      || typeof row.createdDate !== "string" || !dates.has(row.createdDate) || row.createdDate === request.bars.at(-1)!.date
      || (row.status !== "filled" && row.status !== "cancelled" && row.status !== "rejected"))
      throw new AlphaEngineError("output", "Invalid order identity, timing or terminal state.");
    const quantity = finite(row.quantity, 1, "output"), filledQuantity = finite(row.filledQuantity, 0, "output");
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(filledQuantity) || quantity > request.strategy.quantity || filledQuantity > quantity
      || (row.status === "filled" && quantity !== filledQuantity) || (row.status === "rejected" && filledQuantity !== 0))
      throw new AlphaEngineError("output", "Order quantities contradict its state.");
    return { id: identifier(row.id, "output"), createdDate: row.createdDate, side: row.side, quantity, filledQuantity, status: row.status };
  });
  const byOrder = new Map(orders.map(order => [order.id, order]));
  const byDate = new Map(orders.map(order => [order.createdDate, order]));
  if (byOrder.size !== orders.length || new Set(orders.map(order => order.createdDate)).size !== orders.length)
    throw new AlphaEngineError("output", "Duplicate order identity or daily submission.");
  const filled = new Map<string, number>();
  const fills: AlphaFill[] = raw.fills.map(value => {
    const row = record(value, ["id", "orderId", "symbol", "date", "side", "quantity", "price", "commission"], "output");
    const orderId = identifier(row.orderId, "output"), order = byOrder.get(orderId);
    if (!order || row.symbol !== request.symbol || row.side !== order.side || typeof row.date !== "string"
      || !dates.has(row.date) || row.date <= order.createdDate)
      throw new AlphaEngineError("output", "Fill does not match an earlier order.");
    const quantity = finite(row.quantity, 1, "output"), price = finite(row.price, Number.MIN_VALUE, "output"), commission = finite(row.commission, 0, "output");
    if (!Number.isSafeInteger(quantity)) throw new AlphaEngineError("output", "Fractional fills are not supported.");
    filled.set(orderId, (filled.get(orderId) ?? 0) + quantity);
    return { id: identifier(row.id, "output"), orderId, date: row.date, side: order.side, quantity, price, commission };
  });
  if (new Set(fills.map(fill => fill.id)).size !== fills.length || fills.some((fill, i) => i > 0 && fill.date < fills[i - 1]!.date)
    || orders.some(order => order.filledQuantity !== (filled.get(order.id) ?? 0)))
    throw new AlphaEngineError("output", "Fill totals, identities or order are inconsistent.");
  const reportedCurve = raw.curve;
  let cash = request.initialCash, quantity = 0, fillIndex = 0;
  const curve = request.bars.map((bar, index) => {
    let tradedQuantity = 0;
    while (fillIndex < fills.length && fills[fillIndex]!.date === bar.date) {
      const fill = fills[fillIndex++]!;
      tradedQuantity += fill.quantity;
      const previousDate = request.bars[index - 1]?.date;
      if (byOrder.get(fill.orderId)!.createdDate !== previousDate
        || !agrees(fill.price, bar.open * (1 + (fill.side === "buy" ? 1 : -1) * request.costs.slippageRate))
        || !agrees(fill.commission, fill.quantity * fill.price * request.costs.commissionRate))
        throw new AlphaEngineError("output", "Fill violates next-open timing or cost assumptions.");
      const delta = fill.side === "buy" ? fill.quantity : -fill.quantity;
      quantity += delta;
      cash -= delta * fill.price + fill.commission;
      if (quantity < 0 || quantity > request.strategy.quantity || tradedQuantity > bar.volume
        || cash < -Math.max(1, request.initialCash) * 1e-8)
        throw new AlphaEngineError("output", "Fill violates long-only cash constraints.");
    }
    const emitted = byDate.get(bar.date);
    const targetDelta = signals[index]! * request.strategy.quantity - quantity;
    if (emitted && (emitted.quantity !== Math.abs(targetDelta) || emitted.side !== (targetDelta > 0 ? "buy" : "sell")))
      throw new AlphaEngineError("output", "Order contradicts the strategy target.");
    if (index < request.bars.length - 1 && targetDelta !== 0 && !emitted)
      throw new AlphaEngineError("output", "Strategy order is missing.");
    const row = record(reportedCurve[index], ["date", "equity"], "output");
    const equity = finite(row.equity, Number.MIN_VALUE, "output");
    if (row.date !== bar.date || !agrees(equity, cash + quantity * bar.close))
      throw new AlphaEngineError("output", "Engine equity contradicts the fill ledger.");
    return { date: bar.date, equity, cash, quantity };
  });
  const returns = curve.slice(1).map((row, i) => row.equity / curve[i]!.equity - 1);
  let metrics: ReturnType<typeof report>;
  try {
    metrics = report(returns, undefined, { elapsedYears: calendarYears(curve.map(row => row.date)), periodsPerYear: request.periodsPerYear, riskFreeAnnual: 0 });
    if (Object.values(metrics).some(value => typeof value === "number" && !Number.isFinite(value))
      || !agrees(metrics.totalReturn, curve.at(-1)!.equity / request.initialCash - 1)) throw new Error("Unstable return calculation.");
  } catch { throw new AlphaEngineError("output", "Alpha risk metrics exceeded the supported numeric domain."); }
  return { version: 1, engine: { name: "akquant", version: AKQUANT_VERSION, ruleVersion: AKQUANT_RULE_VERSION, python: engine.python },
    inputHash, request, curve, fills, orders,
    metrics: { totalReturn: metrics.totalReturn, cagr: metrics.cagr, annualVol: metrics.annualVol,
      sharpe: metrics.sharpe, maxDrawdown: metrics.maxDrawdown, maxDrawdownPeriods: metrics.maxDdDays } };
}
