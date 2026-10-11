import type { AlphaBacktestRequest } from "../../../types/alpha.ts";

export function sampleRequest(): AlphaBacktestRequest {
  return { version: 1, symbol: "EXAMPLE", bars: [
    { date: "2024-01-02", open: 10, high: 11, low: 9, close: 10, volume: 10000, amount: 100000 },
    { date: "2024-01-03", open: 12, high: 13, low: 11, close: 13, volume: 10000, amount: 120000 },
    { date: "2024-01-04", open: 11, high: 12, low: 10, close: 11, volume: 10000, amount: 110000 },
    { date: "2024-01-05", open: 14, high: 15, low: 13, close: 15, volume: 10000, amount: 140000 },
  ], strategy: { kind: "signals", values: [1, 1, 0, 0], quantity: 10 }, initialCash: 1000,
  costs: { commissionRate: 0.001, slippageRate: 0.01 }, periodsPerYear: 252, simulation: "generic-stock-next-open" };
}

/** Manually calculated cash: 1000 - 10*12.12 - .1212 + 10*13.86 - .1386. */
export function sampleResponse(inputHash: string) {
  return { protocol: 1, engine: { name: "akquant", version: "0.3.58", ruleVersion: "1.5.4", python: "3.14.3" }, inputHash,
    curve: [{ date: "2024-01-02", equity: 1000 }, { date: "2024-01-03", equity: 1008.6788 },
      { date: "2024-01-04", equity: 988.6788 }, { date: "2024-01-05", equity: 1017.1402 }],
    fills: [
      { id: "fill-1", orderId: "order-1", symbol: "EXAMPLE", date: "2024-01-03", side: "buy", quantity: 10, price: 12.12, commission: 0.1212 },
      { id: "fill-2", orderId: "order-2", symbol: "EXAMPLE", date: "2024-01-05", side: "sell", quantity: 10, price: 13.86, commission: 0.1386 },
    ], orders: [
      { id: "order-1", symbol: "EXAMPLE", createdDate: "2024-01-02", side: "buy", quantity: 10, filledQuantity: 10, status: "filled" },
      { id: "order-2", symbol: "EXAMPLE", createdDate: "2024-01-04", side: "sell", quantity: 10, filledQuantity: 10, status: "filled" },
    ] };
}
