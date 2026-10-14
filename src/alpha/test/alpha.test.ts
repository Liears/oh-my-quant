import { expect, test } from "bun:test";
import { createAkquantEngine } from "../index.ts";
import { prepareAlphaRequest, hash } from "../validation.ts";
import { sampleRequest, sampleResponse } from "./fixtures/sample.ts";

test("AKQuant boundary reconciles the independent cash ledger, costs and calendar CAGR", async () => {
  const input = sampleRequest();
  const engine = createAkquantEngine({ python: { command: "injected" }, runProcess: async job => {
    expect(job.args).toContain("-I");
    expect(job.args.some(arg => arg.includes('"EXAMPLE"'))).toBe(false);
    const sent = JSON.parse(job.input);
    expect(sent.signals).toEqual([1, 1, 0, 0]);
    return JSON.stringify(sampleResponse(sent.inputHash));
  } });
  const result = await engine.run(input);
  expect(result.curve.map(row => row.quantity)).toEqual([0, 10, 10, 0]);
  expect(result.curve[1]!.cash).toBeCloseTo(878.6788, 8);
  expect(result.curve.at(-1)!.equity).toBeCloseTo(1017.1402, 8);
  expect(result.metrics.totalReturn).toBeCloseTo(0.0171402, 10);
  expect(result.metrics.cagr).toBeCloseTo((1017.1402 / 1000) ** (365.25 / 3) - 1, 8);
  expect(result.metrics.maxDrawdown).toBeCloseTo(988.6788 / 1008.6788 - 1, 10);
  expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
});

test("request snapshot, canonical key order and input lineage are stable", async () => {
  const input = sampleRequest();
  const original = prepareAlphaRequest(input);
  const reversed = Object.fromEntries(Object.entries(input).reverse());
  expect(prepareAlphaRequest(reversed as typeof input).inputHash).toBe(original.inputHash);
  input.dataset = { version: 1, kind: "daily-bars", symbol: input.symbol, market: "US", source: "fixture",
    revision: "a".repeat(64), contentHash: hash(input.bars), dates: input.bars.map(bar => bar.date),
    requested: { start: null, end: null }, snapshotAt: "2024-01-06T00:00:00Z", adjustment: "forward-adjusted", availability: "observed-at-fetch", providerEndpoint: "stock_zh_a_hist" };
  const before = structuredClone(input);
  const engine = createAkquantEngine({ python: { command: "injected" }, runProcess: async job => {
    input.bars[0]!.close = 10.5;
    input.costs.commissionRate = 0.5;
    return JSON.stringify(sampleResponse(JSON.parse(job.input).inputHash));
  } });
  const result = await engine.run(input);
  expect(result.request).toEqual(before);
  expect(result.inputHash).not.toBe(original.inputHash);
  const changedBasis = { ...before, dataset: { ...before.dataset!, adjustment: "unadjusted" as const } };
  expect(prepareAlphaRequest(changedBasis).inputHash).not.toBe(result.inputHash);
  expect(() => prepareAlphaRequest({ ...before, dataset: { ...before.dataset!, providerEndpoint: "https://private.test?token=secret" } })).toThrow("DatasetRef");
  expect(() => prepareAlphaRequest(input)).toThrow("DatasetRef");
});

test("SMA signals have warmup and do not look at future prices", () => {
  const input = sampleRequest();
  input.strategy = { kind: "sma", fast: 1, slow: 2, quantity: 10 };
  expect(prepareAlphaRequest(input).signals).toEqual([0, 1, 0, 1]);
  input.bars[3]!.close = 14;
  expect(prepareAlphaRequest(input).signals.slice(0, 3)).toEqual([0, 1, 0]);
});

test("AKQuant request preserves unavailable turnover in the input lineage", () => {
  const input = sampleRequest();
  input.bars[0]!.amount = null;
  input.dataset = { version: 1, kind: "daily-bars", symbol: input.symbol, market: "US", source: "fixture",
    revision: "a".repeat(64), contentHash: hash(input.bars), dates: input.bars.map(bar => bar.date),
    requested: { start: null, end: null }, snapshotAt: "2024-01-06T00:00:00Z", adjustment: "provider-unspecified", availability: "observed-at-fetch" };
  const prepared = prepareAlphaRequest(input);
  expect(prepared.request.bars[0]!.amount).toBeNull();
  expect(prepared.request.dataset?.contentHash).toBe(hash(prepared.request.bars));
  input.bars[0]!.amount = 0;
  expect(prepareAlphaRequest({ ...input, dataset: undefined }).inputHash).not.toBe(prepared.inputHash);
  expect(() => prepareAlphaRequest({ ...input, dataset: undefined, bars: [{ ...input.bars[0]!, amount: -1 }, ...input.bars.slice(1)] })).toThrow("Invalid numeric value");
});

test("invalid dates, OHLC, unknown fields, costs and strategy fail before spawning", async () => {
  const mutations: ((input: ReturnType<typeof sampleRequest>) => void)[] = [
    input => { input.bars = []; }, input => { input.bars[0]!.date = "2024-02-30"; },
    input => { input.bars[1]!.date = input.bars[0]!.date; }, input => { input.bars.reverse(); },
    input => { input.bars[0]!.high = 9; }, input => { input.bars[0]!.volume = -1; },
    input => { input.initialCash = NaN; }, input => { input.costs.slippageRate = 1; },
    input => { input.strategy.quantity = 1.5; }, input => { Object.assign(input, { python: "untrusted.py" }); },
    input => { input.strategy = { kind: "sma", fast: 2, slow: 2, quantity: 1 }; },
    input => { input.strategy = { kind: "signals", values: [1], quantity: 1 }; },
  ];
  let calls = 0;
  const engine = createAkquantEngine({ python: { command: "injected" }, runProcess: async () => { calls++; return "{}"; } });
  for (const mutate of mutations) {
    const input = sampleRequest(); mutate(input);
    await expect(engine.run(input)).rejects.toMatchObject({ code: "input" });
  }
  expect(calls).toBe(0);
});

test("no fills is a valid flat result; final-bar signal does not execute", async () => {
  const input = sampleRequest();
  input.strategy = { kind: "signals", values: [0, 0, 0, 1], quantity: 10 };
  const engine = createAkquantEngine({ python: { command: "injected" }, runProcess: async job => {
    const response = sampleResponse(JSON.parse(job.input).inputHash);
    response.fills = []; response.orders = [];
    response.curve.forEach(row => { row.equity = 1000; });
    return JSON.stringify(response);
  } });
  const result = await engine.run(input);
  expect(result.fills).toEqual([]);
  expect(result.metrics).toMatchObject({ totalReturn: 0, cagr: 0, sharpe: null, maxDrawdown: 0 });
});

test("partial fills cancel residuals and retarget from actual holdings", async () => {
  const input = sampleRequest();
  input.costs = { commissionRate: 0, slippageRate: 0 };
  input.bars[1]!.volume = 2;
  const engine = createAkquantEngine({ python: { command: "injected" }, runProcess: async job => {
    const response = sampleResponse(JSON.parse(job.input).inputHash);
    response.curve.forEach((row, i) => { row.equity = [1000, 1002, 998, 1028][i]!; });
    response.orders = [
      { ...response.orders[0]!, filledQuantity: 2, status: "cancelled" },
      { ...response.orders[0]!, id: "order-mid", createdDate: "2024-01-03", quantity: 8, filledQuantity: 8 },
      response.orders[1]!,
    ];
    response.fills = [
      { ...response.fills[0]!, quantity: 2, price: 12, commission: 0 },
      { ...response.fills[0]!, id: "fill-mid", orderId: "order-mid", date: "2024-01-04", quantity: 8, price: 11, commission: 0 },
      { ...response.fills[1]!, price: 14, commission: 0 },
    ];
    return JSON.stringify(response);
  } });
  expect((await engine.run(input)).curve.map(row => row.quantity)).toEqual([0, 2, 10, 0]);
});

test("corrupt receipts cannot become research results", async () => {
  const mutations: ((response: ReturnType<typeof sampleResponse>) => void)[] = [
    r => { r.curve = []; }, r => { r.curve[1]!.equity += 10; }, r => { r.inputHash = "other"; },
    r => { r.fills[0]!.symbol = "OTHER"; }, r => { r.fills[1]!.id = r.fills[0]!.id; },
    r => { r.fills[0]!.date = "2024-01-02"; }, r => { r.fills[0]!.price = 12; },
    r => { r.fills[0]!.commission = 0; }, r => { r.orders[0]!.filledQuantity = 11; },
    r => { r.orders[0]!.status = "open"; }, r => { r.orders[0]!.quantity = 20; },
    r => { r.fills.reverse(); }, r => { r.orders = []; }, r => { r.fills = []; },
    r => { r.curve[0]!.date = "2023-01-01"; }, r => { r.engine.version = "0.3.59"; },
  ];
  for (const mutate of mutations) {
    const engine = createAkquantEngine({ python: { command: "injected" }, runProcess: async job => {
      const response = sampleResponse(JSON.parse(job.input).inputHash); mutate(response);
      return JSON.stringify(response);
    } });
    await expect(engine.run(sampleRequest())).rejects.toThrow();
  }
});

test("empty, malformed, unavailable and wrong-version output fail explicitly", async () => {
  for (const [output, code] of [["", "output"], ["INFO\n{}", "output"], ["{}", "output"],
    ['{"error":"unavailable"}', "unavailable"], ['{"error":"version"}', "version"], ['{"error":"process"}', "process"]]) {
    const engine = createAkquantEngine({ python: { command: "injected" }, runProcess: async () => output! });
    await expect(engine.run(sampleRequest())).rejects.toMatchObject({ code });
  }
});

test("cancellation before dispatch and after an uncooperative runner does not publish", async () => {
  const controller = new AbortController();
  let calls = 0;
  const engine = createAkquantEngine({ python: { command: "injected" }, runProcess: async job => {
    calls++; controller.abort();
    return JSON.stringify(sampleResponse(JSON.parse(job.input).inputHash));
  } });
  await expect(engine.run(sampleRequest(), controller.signal)).rejects.toMatchObject({ code: "cancelled" });
  await expect(engine.run(sampleRequest(), controller.signal)).rejects.toMatchObject({ code: "cancelled" });
  expect(calls).toBe(1);
});

test("finite equity with overflowing or unstable risk metrics is rejected", async () => {
  const input = sampleRequest();
  input.bars[1]!.close = input.bars[1]!.high = 1e200;
  const engine = createAkquantEngine({ python: { command: "injected" }, runProcess: async job => {
    const response = sampleResponse(JSON.parse(job.input).inputHash);
    response.curve[1]!.equity = 1e201;
    return JSON.stringify(response);
  } });
  await expect(engine.run(input)).rejects.toMatchObject({ code: "output" });
});
