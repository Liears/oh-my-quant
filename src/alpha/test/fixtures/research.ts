import { createAkquantEngine } from "../../index.ts";
import type { AlphaResearchRequest } from "../../../types/alpha.ts";
import { sampleRequest, sampleResponse } from "./sample.ts";

export const researchRequest: AlphaResearchRequest = { symbol: "AAPL", start: "2024-01-02", end: "2024-01-05",
  fast: 1, slow: 2, quantity: 10, cash: 1000, commission: 0.001, slippage: 0.01, periods_per_year: 252, simulation: "generic-stock-next-open" };
export const researchBars = sampleRequest().bars;

/** Independent SMA(1,2) receipts: buy on day 3; sell on day 4. */
export const researchEngine = createAkquantEngine({ python: { command: "fixture-unused" }, runProcess: async ({ input }) => {
  const response = sampleResponse((JSON.parse(input) as { inputHash: string }).inputHash);
  response.curve = response.curve.map((point, index) => ({ ...point, equity: [1000, 1000, 998.7889, 1027.2503][index]! }));
  response.fills.forEach(fill => { fill.symbol = "AAPL"; });
  Object.assign(response.fills[0]!, { date: "2024-01-04", price: 11.11, commission: 0.1111 });
  response.orders.forEach(order => { order.symbol = "AAPL"; });
  response.orders[0]!.createdDate = "2024-01-03";
  return JSON.stringify(response);
} });
