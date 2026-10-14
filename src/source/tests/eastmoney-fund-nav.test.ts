import { afterEach, expect, it, spyOn } from "bun:test";
import { fetchEastmoneyFundNav, parseEastmoneyFundNav } from "../src/eastmoney-fund-nav.ts";
import * as python from "../src/akshare-python.ts";
import { fetchAkshareFundNav } from "../src/akshare.ts";
import { pullBarsFromProviders } from "../src/sources.ts";
import { FUND_LITERAL, BLOCKED_FUND_ATTEMPTS } from "./fixtures/eastmoney-fund.ts";

const restores: Array<() => void> = [];
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; for (const restore of restores.splice(0)) restore(); });

it("joins NAV literals by Shanghai date, sorts rows, and preserves missing values without claiming trading availability", () => {
  const nav = parseEastmoneyFundNav("270042.OF", FUND_LITERAL);
  expect(nav.map(row => [row.navDate, row.unitNav, row.accumulatedNav, row.dailyReturnPct])).toEqual([
    ["2025-01-06", 1, 1.1, null], ["2025-01-07", 0.5, 0.6, -50],
  ]);
  expect(nav.every(row => row.fundCode === "270042" && row.source === "akshare" && !row.isOpenDay)).toBe(true);
  expect(parseEastmoneyFundNav("270042", FUND_LITERAL.replace(/var Data_ACWorthTrend.*$/s, "")).every(row => row.accumulatedNav === null)).toBe(true);
  expect(() => parseEastmoneyFundNav("270042.SH", FUND_LITERAL)).toThrow();
});

it("rejects wrong identities, dynamic code, fake declarations inside comments/strings, duplicate declarations and truncated literals", () => {
  for (const text of [
    FUND_LITERAL.replace('"270042"', '"999999"'), FUND_LITERAL.replace('var fS_code = "270042";', '/* var fS_code = "270042"; */'),
    FUND_LITERAL.replace('var fS_code = "270042";', 'var fake = \'var fS_code = "270042";\';'),
    FUND_LITERAL + 'var fS_code = "270042";', FUND_LITERAL + 'fS_code = "999999";', FUND_LITERAL + 'var other=(fS_code="999999");',
    FUND_LITERAL.replace('"y":0.5', '"y":(()=>0.5)()'), FUND_LITERAL.slice(0, -1), FUND_LITERAL + '/* unclosed',
    'function fake(){' + FUND_LITERAL + '}', FUND_LITERAL.replace('var fS_code = "270042";', 'var fS_code = `270042`;'),
  ]) expect(() => parseEastmoneyFundNav("270042", text)).toThrow();
});

it("rejects an entire response with invalid values or repeated NAV dates rather than silently retaining partial rows", () => {
  for (const [from, to] of [
    ['"y":0.5', '"y":0'], ['"y":0.5', '"y":"0.5"'], ['"y":0.5', '"y":1e309'],
    ['"x":1736179200000', '"x":null'], ['"x":1736179200000', '"x":1736092800000'],
    ['"equityReturn":-50', '"equityReturn":"-50"'], ['1736179200000,0.6', '1736092800000,0.6'],
  ]) expect(() => parseEastmoneyFundNav("270042", FUND_LITERAL.replace(from!, to!))).toThrow("Provider response invalid");
  expect(() => parseEastmoneyFundNav("270042", " ".repeat(8 * 1024 * 1024 + 1))).toThrow("truncated");
});

it("uses only the canonical public URL without redirects and sanitizes provider errors", async () => {
  let url: unknown, request: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => { url = input; request = init; return new Response(FUND_LITERAL); }) as typeof fetch;
  expect(await fetchEastmoneyFundNav("270042.OF")).toHaveLength(2);
  expect(url).toBe("https://fund.eastmoney.com/pingzhongdata/270042.js");
  expect(request?.redirect).toBe("error"); expect(request?.signal).toBeInstanceOf(AbortSignal);
  globalThis.fetch = (async () => new Response("PRIVATE BODY", { status: 503 })) as unknown as typeof fetch;
  await expect(fetchEastmoneyFundNav("270042")).rejects.toThrow("HTTP 503");
  globalThis.fetch = (async () => { throw new Error("private-token-url"); }) as unknown as typeof fetch;
  await expect(fetchEastmoneyFundNav("270042")).rejects.toThrow("Provider connection failed");
});

it("cancels stalled body reads, rejects oversized responses and never converts cancellation into empty data", async () => {
  const controller = new AbortController();
  globalThis.fetch = (async (_input, init) => new Response(new ReadableStream({ start(stream) {
    init!.signal!.addEventListener("abort", () => stream.error(init!.signal!.reason), { once: true });
  } }))) as typeof fetch;
  const pending = fetchEastmoneyFundNav("270042", controller.signal);
  await Promise.resolve(); controller.abort(new Error("cancel public NAV"));
  await expect(pending).rejects.toThrow("cancel public NAV");
  let cancelled = false;
  globalThis.fetch = (async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } }))) as unknown as typeof fetch;
  await expect(fetchEastmoneyFundNav("270042")).rejects.toThrow("Provider response truncated");
  expect(cancelled).toBe(true);
});

it("restores both NAV and source facade bars after the exact native block and records the real endpoint and unit NAV basis", async () => {
  const run = spyOn(python, "runPython").mockResolvedValue({ stdout: JSON.stringify({ symbol: "270042", nav: [], bars: [], endpoint: null, attempts: BLOCKED_FUND_ATTEMPTS }), stderr: "" });
  restores.push(() => run.mockRestore());
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Response(FUND_LITERAL); }) as unknown as typeof fetch;
  const nav = await fetchAkshareFundNav("270042");
  expect(nav).toMatchObject({ endpoint: "eastmoney_fund_net_worth", nav: [{ navDate: "2025-01-06" }, { navDate: "2025-01-07" }] });
  expect(nav.attempts.map(item => item.endpoint)).toEqual(["fund_open_fund_info_em", "eastmoney_fund_net_worth"]);
  const pulled = await pullBarsFromProviders("270042.OF", "A", "2025-01-07", "2025-01-07", "akshare", { fallbackOrder: { A: ["akshare"] } });
  expect(pulled).toMatchObject({ source: "akshare", providerEndpoint: "eastmoney_fund_net_worth", adjustment: "unit-nav",
    bars: [{ date: "2025-01-07", open: 0.5, high: 0.5, low: 0.5, close: 0.5, volume: 0, amount: null }] });
  expect(requests).toBe(2);
});

it("does not make a new public request for genuine empty data, unrelated errors, stocks or cancellation", async () => {
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Response(FUND_LITERAL); }) as unknown as typeof fetch;
  const run = spyOn(python, "runPython"); restores.push(() => run.mockRestore());
  for (const attempts of [[], [{ endpoint: "fund_open_fund_info_em", status: "ok", rows: 0 }], [{ ...BLOCKED_FUND_ATTEMPTS[0], error: "network failure" }]]) {
    run.mockResolvedValue({ stdout: JSON.stringify({ symbol: "270042", nav: [], bars: [], attempts }), stderr: "" });
    expect((await fetchAkshareFundNav("270042")).nav).toEqual([]);
  }
  run.mockResolvedValue({ stdout: JSON.stringify({ bars: [], endpoint: null, attempts: BLOCKED_FUND_ATTEMPTS }), stderr: "" });
  await pullBarsFromProviders("000001.SZ", "A", undefined, undefined, "akshare", { fallbackOrder: { A: ["akshare"] } });
  const controller = new AbortController(); controller.abort(new Error("cancel before request"));
  await expect(fetchAkshareFundNav("270042", controller.signal)).rejects.toThrow();
  expect(requests).toBe(0);
});
