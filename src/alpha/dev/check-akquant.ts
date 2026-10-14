import assert from "node:assert/strict";
import { createAkquantEngine } from "../index.ts";
import { sampleRequest } from "../test/fixtures/sample.ts";

// Explicit real-engine check. Synthetic data only; no model, market or storage IO.
if (process.argv.length !== 4 || process.argv[2] !== "--python") {
  throw new Error("Usage: bun run src/alpha/dev/check-akquant.ts --python <python executable>");
}
const engine = createAkquantEngine({ python: { command: process.argv[3]! }, timeoutMs: 180_000 });
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  const input = sampleRequest();
  const baseline = await engine.run(input, controller.signal);
  assert.deepEqual(baseline.curve.map(row => row.quantity), [0, 10, 10, 0]);
  assert.ok(Math.abs(baseline.curve.at(-1)!.equity - 1017.1402) < 1e-8);
  console.log(JSON.stringify({ case: "next-open-costs", engine: baseline.engine, finalEquity: baseline.curve.at(-1)!.equity, fills: baseline.fills.length }));

  const missingTurnover = sampleRequest();
  missingTurnover.bars[0]!.amount = null;
  const missingResult = await engine.run(missingTurnover, controller.signal);
  assert.equal(missingResult.request.bars[0]!.amount, null);
  assert.deepEqual(missingResult.curve.map(row => row.quantity), baseline.curve.map(row => row.quantity));
  assert.equal(missingResult.curve.at(-1)!.equity, baseline.curve.at(-1)!.equity);
  assert.notEqual(missingResult.inputHash, baseline.inputHash);
  console.log(JSON.stringify({ case: "missing-turnover", finalEquity: missingResult.curve.at(-1)!.equity, fills: missingResult.fills.length }));

  const partial = sampleRequest();
  partial.costs = { commissionRate: 0, slippageRate: 0 };
  partial.bars[1]!.volume = 2;
  const partialResult = await engine.run(partial, controller.signal);
  assert.deepEqual(partialResult.curve.map(row => row.quantity), [0, 2, 10, 0]);
  assert.equal(partialResult.curve.at(-1)!.equity, 1028);
  assert.equal(partialResult.orders[0]!.status, "cancelled");
  console.log(JSON.stringify({ case: "partial-retarget", finalEquity: 1028, orders: partialResult.orders.length }));

  const flat = sampleRequest();
  flat.strategy = { kind: "signals", values: [0, 0, 0, 1], quantity: 10 };
  const flatResult = await engine.run(flat, controller.signal);
  assert.deepEqual(flatResult.orders, []);
  assert.equal(flatResult.metrics.totalReturn, 0);
  console.log(JSON.stringify({ case: "last-bar-no-trade", finalEquity: flatResult.curve.at(-1)!.equity }));

  const sma = sampleRequest();
  sma.strategy = { kind: "sma", fast: 1, slow: 2, quantity: 10 };
  const smaResult = await engine.run(sma, controller.signal);
  assert.deepEqual(smaResult.fills.map(fill => fill.date), ["2024-01-04", "2024-01-05"]);
  console.log(JSON.stringify({ case: "sma-warmup", finalEquity: smaResult.curve.at(-1)!.equity }));

  const rejected = sampleRequest();
  rejected.initialCash = 1;
  const rejectedResult = await engine.run(rejected, controller.signal);
  assert.equal(rejectedResult.fills.length, 0);
  assert.ok(rejectedResult.orders.length > 0 && rejectedResult.orders.every(order => order.status === "rejected"));
  assert.equal(rejectedResult.curve.at(-1)!.equity, 1);
  console.log(JSON.stringify({ case: "insufficient-cash", rejected: rejectedResult.orders.length }));
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
