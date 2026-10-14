import { afterEach, expect, it, spyOn } from "bun:test";
import { fetchSinaAHistory, parseSinaQfqFactors } from "../src/sina-a-history.ts";
import { fetchFromAKShareDetailed } from "../src/akshare.ts";
import { fetchBars, pullBarsFromProviders } from "../src/sources.ts";
import * as python from "../src/akshare-python.ts";
import { sinaDeclaration } from "./fixtures/sina-history.ts";

const originalFetch = globalThis.fetch, restores: Array<() => void> = [];
afterEach(() => { globalThis.fetch = originalFetch; for (const restore of restores.splice(0)) restore(); });
const history = (code: string) => sinaDeclaration(code).replace("KLC_K2_", "KLC_KL_");
const factors = (code = "sz000001") => `var ${code}qfq=${JSON.stringify({ total: 3, data: [
  { d: "2025-01-08", f: "1" }, { d: "2025-01-07", f: "2" }, { d: "1900-01-01", f: "4" },
] })}\n/* non-executable comment */`;

it("parses only identity-matched JSON factor declarations with ordered positive effective dates", () => {
  expect(parseSinaQfqFactors("sz000001", factors())).toEqual([
    { date: "2025-01-08", factor: 1 }, { date: "2025-01-07", factor: 2 }, { date: "1900-01-01", factor: 4 },
  ]);
  expect(parseSinaQfqFactors("sz000001", factors().replace("\n/* non-executable comment */", "; /* comment with } and { */"))).toHaveLength(3);
  for (const text of [factors("sh600000"), factors() + ";globalThis.exposed=true", factors() + factors(), "/*" + factors() + "*/",
    factors().replace('"total":3', '"total":2'), factors().replace('"total":3', '"total":3,"total":3'),
    factors().replace('"f":"4"', '"f":"0"'), factors().replace('"f":"4"', '"f":"NaN"'),
    factors().replace('"f":"4"', '"f":"4","f":"4"'), factors().replace("1900-01-01", "2025-01-07"),
    factors().replace("1900-01-01", "2025-02-31"), factors().replace('"data":', '"extra":'),
    factors().replace('"f":"4"', '"f":compute()'), " ".repeat(1024 * 1024 + 1)]) {
    expect(() => parseSinaQfqFactors("sz000001", text)).toThrow();
  }
});

it("applies the latest factor effective on each price date while retaining raw volume, amount and precision", async () => {
  const urls: string[] = [], signals: Array<AbortSignal | null | undefined> = [];
  globalThis.fetch = (async (input, init) => {
    urls.push(String(input)); signals.push(init?.signal); expect(init?.redirect).toBe("error");
    return new Response(String(input).endsWith("qfq.js") ? factors() : history("sz000001"));
  }) as typeof fetch;
  const bars = await fetchSinaAHistory("000001.sz", "stock", "2025-01-06", "2025-01-07");
  expect(bars).toEqual([
    { date: "2025-01-06", open: 0.25, high: 0.275, low: 0.225, close: 0.2625, volume: 100, amount: 101 },
    { date: "2025-01-07", open: 0.55, high: 0.6, low: 0.5, close: 0.575, volume: 200, amount: 222 },
  ]);
  expect(urls).toEqual(["https://finance.sina.com.cn/realstock/company/sz000001/hisdata/klc_kl.js", "https://finance.sina.com.cn/realstock/company/sz000001/qfq.js"]);
  expect(signals.every(signal => signal instanceof AbortSignal)).toBe(true);
});

it("preserves index levels and empty price windows without fetching equity factors", async () => {
  let requests = 0;
  globalThis.fetch = (async input => { requests++; return new Response(history(String(input).includes("sh000300") ? "sh000300" : "sz000001")); }) as typeof fetch;
  expect((await fetchSinaAHistory("000300.SH", "index", "2025-01-06", "2025-01-07"))[0]?.close).toBe(1.05);
  expect(await fetchSinaAHistory("000001.SZ", "stock", "2025-01-08", "2025-01-09")).toEqual([]);
  expect(requests).toBe(2);
});

it("rejects wrong instrument identity, absent effective factors and invalid ranges without inventing adjustment", async () => {
  let requests = 0;
  globalThis.fetch = (async input => { requests++; return new Response(String(input).endsWith("qfq.js") ? factors().replace("1900-01-01", "2025-01-06") : history("sz000001")); }) as typeof fetch;
  for (const [symbol, kind] of [["000300.SH", "stock"], ["000001.SZ", "index"], ["270042.OF", "stock"], ["AAPL", "stock"], ["430001.BJ", "stock"]] as const) {
    await expect(fetchSinaAHistory(symbol, kind)).rejects.toThrow();
  }
  await expect(fetchSinaAHistory("000001.SZ", "stock", "2025-02-31")).rejects.toThrow();
  expect(requests).toBe(0);
  // No factor effective on Jan 6: future factors cannot be backfilled into a historical price.
  const onlyFuture = `var sz000001qfq={"total":1,"data":[{"d":"2025-01-07","f":"2"}]}`;
  globalThis.fetch = (async input => new Response(String(input).endsWith("qfq.js") ? onlyFuture : history("sz000001"))) as typeof fetch;
  await expect(fetchSinaAHistory("000001.SZ", "stock", "2025-01-06", "2025-01-06")).rejects.toThrow("Provider response invalid");
});

it("propagates cancellation between price and factors and sanitizes transport failure text", async () => {
  const controller = new AbortController(); let requests = 0;
  globalThis.fetch = (async () => { requests++; controller.abort(new Error("cancel after price")); return new Response(history("sz000001")); }) as unknown as typeof fetch;
  await expect(fetchSinaAHistory("000001.SZ", "stock", undefined, undefined, controller.signal)).rejects.toThrow("cancel after price");
  expect(requests).toBe(1);
  globalThis.fetch = (async () => { throw new Error("PRIVATE URL TOKEN"); }) as unknown as typeof fetch;
  await expect(fetchSinaAHistory("000300.SH", "index")).rejects.toThrow("Provider connection failed");
});

it("restores timed-out A stock/index chains through the actual source facade with correct endpoint and basis", async () => {
  const run = spyOn(python, "runPython").mockRejectedValue(new Error("AKShare failed (timeout after 30000ms): PRIVATE PROCESS TEXT")); restores.push(() => run.mockRestore());
  globalThis.fetch = (async input => new Response(String(input).endsWith("qfq.js") ? factors() : history(String(input).includes("sh000300") ? "sh000300" : "sz000001"))) as typeof fetch;
  for (const [symbol, endpoint, adjustment] of [["000001.SZ", "sina_a_daily_qfq_native_free", "forward-adjusted"], ["000300.SH", "sina_a_index_daily_native_free", "index-level"]] as const) {
    const result = await fetchFromAKShareDetailed(symbol, "2025-01-06", "2025-01-07");
    expect(result).toMatchObject({ endpoint, adjustment, attempts: [{ endpoint: "akshare_daily_chain", status: "error", error: "Provider request timed out" }, { endpoint, status: "ok", rows: 2 }] });
    const pulled = await pullBarsFromProviders(symbol, "A", "2025-01-06", "2025-01-07", "akshare", { fallbackOrder: { A: ["akshare"] } });
    expect(pulled).toMatchObject({ source: "akshare", providerEndpoint: endpoint, adjustment });
    expect(JSON.stringify(result)).not.toContain("PRIVATE PROCESS TEXT");
  }
});

it("never dispatches the fallback for unrelated errors, genuine empty results, excluded Sina or cancellation", async () => {
  let requests = 0; globalThis.fetch = (async () => { requests++; return new Response(history("sz000001")); }) as unknown as typeof fetch;
  const run = spyOn(python, "runPython"); restores.push(() => run.mockRestore());
  run.mockRejectedValue(new Error("AKShare failed (exit 1): upstream problem"));
  await expect(fetchFromAKShareDetailed("000001.SZ")).rejects.toThrow("exit 1");
  run.mockResolvedValue({ stdout: JSON.stringify({ bars: [], endpoint: null, attempts: [{ endpoint: "stock_zh_a_hist", status: "ok", rows: 0 }] }), stderr: "" });
  expect((await fetchFromAKShareDetailed("000001.SZ")).bars).toEqual([]);
  run.mockResolvedValue({ stdout: JSON.stringify({ bars: [], endpoint: null,
    attempts: [{ endpoint: "fund_open_fund_info_em", status: "error", error: "[WinError 4551] unrelated instrument" }] }), stderr: "" });
  expect((await fetchFromAKShareDetailed("000001.SZ")).bars).toEqual([]);
  run.mockRejectedValue(new Error("AKShare failed (timeout after 30000ms):"));
  await expect(fetchFromAKShareDetailed("000001.SZ", undefined, undefined, { sourcePriority: "eastmoney" })).rejects.toThrow("timeout");
  await expect(fetchFromAKShareDetailed("270042.OF")).rejects.toThrow("timeout");
  const controller = new AbortController();
  run.mockImplementation(async () => { controller.abort(new Error("cancel chain")); throw new Error("AKShare failed (timeout after 30000ms):"); });
  await expect(fetchFromAKShareDetailed("000001.SZ", undefined, undefined, { signal: controller.signal })).rejects.toThrow("cancel chain");
  expect(requests).toBe(0);
});

it("also handles explicitly selected Sina when every completed attempt is the known native block", async () => {
  const run = spyOn(python, "runPython").mockResolvedValue({ stdout: JSON.stringify({ bars: [], endpoint: null,
    attempts: [{ endpoint: "stock_zh_a_daily", status: "error", error: "[WinError 4551] PRIVATE DLL PATH" }] }), stderr: "" });
  restores.push(() => run.mockRestore());
  globalThis.fetch = (async input => new Response(String(input).endsWith("qfq.js") ? factors() : history("sz000001"))) as typeof fetch;
  const result = await fetchFromAKShareDetailed("000001.SZ", "2025-01-06", "2025-01-07", { sourcePriority: "sina" });
  expect(result).toMatchObject({ endpoint: "sina_a_daily_qfq_native_free", bars: [{ date: "2025-01-06" }, { date: "2025-01-07" }],
    attempts: [{ endpoint: "stock_zh_a_daily", status: "error", error: "Native runtime blocked (WinError 4551)" }, { status: "ok" }] });
  expect(JSON.stringify(result)).not.toContain("PRIVATE DLL PATH");
});

it("does not archive price observations when the factor response is wrong or missing", async () => {
  const run = spyOn(python, "runPython").mockRejectedValue(new Error("AKShare failed (timeout after 30000ms):")); restores.push(() => run.mockRestore());
  globalThis.fetch = (async input => new Response(String(input).endsWith("qfq.js") ? factors("sh600000") : history("sz000001"))) as typeof fetch;
  let saves = 0;
  const result = await fetchBars("000001.SZ", "A", "2025-01-06", "2025-01-07", "akshare", {
    deps: { getPreferredSource: () => "akshare", loadCache: async () => ({ bars: [], fresh: false }), saveBars: async () => { saves++; } },
    providers: { fallbackOrder: { A: ["akshare"] } },
  });
  expect(result).toMatchObject({ origin: "unavailable", bars: [], attempts: [{ status: "error", error: "Provider identity mismatch" }] });
  expect(saves).toBe(0);
});
