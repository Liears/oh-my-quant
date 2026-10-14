import { afterEach, expect, it, spyOn } from "bun:test";
import { fetchSinaGlobalHistory, parseSinaGlobalHistory } from "../src/sina-global-history.ts";
import { fetchFromAKShareGlobalDetailed } from "../src/akshare-global-bars.ts";
import { pullBarsFromProviders } from "../src/sources.ts";
import * as python from "../src/akshare-python.ts";
import * as decoder from "../src/vendor/sina-history-decoder.js";
import { sinaDeclaration } from "./fixtures/sina-history.ts";

const originalFetch = globalThis.fetch, restores: Array<() => void> = [];
afterEach(() => { globalThis.fetch = originalFetch; for (const restore of restores.splice(0)) restore(); });

it("decodes both daily packet versions with fixed expected OHLCV and no inferred US turnover", () => {
  for (const format of [1479, 3466] as const) {
    const bars = parseSinaGlobalHistory("AAPL", "US", sinaDeclaration("AAPL", format), "2025-01-06", "2025-01-07");
    expect(bars).toEqual([
      { date: "2025-01-06", open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 100, amount: null },
      { date: "2025-01-07", open: 1.1, high: 1.2, low: 1, close: 1.15, volume: 200, amount: null },
    ]);
  }
  const hk = parseSinaGlobalHistory("00700.HK", "HK", sinaDeclaration("00700") + "\n/* upstream comment; var KLC_K2_99999 = 1 */");
  // The upstream decimal scaler rounds this half-way turnover to the even integer.
  expect(hk.map(row => row.amount)).toEqual([101, 222]);
});

it("preserves requested windows, genuine empty windows and the legacy last-30 default", () => {
  expect(parseSinaGlobalHistory("AAPL", "US", sinaDeclaration("AAPL"), "2025-01-07", "2025-01-07")).toHaveLength(1);
  expect(parseSinaGlobalHistory("AAPL", "US", sinaDeclaration("AAPL"), "2025-01-08", "2025-01-09")).toEqual([]);
  expect(parseSinaGlobalHistory("AAPL", "US", sinaDeclaration("AAPL", 3466, 32))).toHaveLength(30);
  expect(() => parseSinaGlobalHistory("AAPL", "US", sinaDeclaration("AAPL"), "2025-02-31")).toThrow();
});

it("rejects identity changes, injected code, duplicate declarations, unsupported versions and invalid data", () => {
  const valid = sinaDeclaration("AAPL");
  for (const text of [valid.replace("AAPL", "MSFT"), valid + valid, valid + "globalThis.exposed=true;", valid + "/* unfinished",
    valid.replace('="', '=d("'), valid.replace("K2/", "K2+"), valid.replace("K2/", "AAA"), valid.replace(/";/, '\\";'),
    "/* " + valid + " */", 'var other="' + valid.replaceAll('"', '\\"') + '";', valid.slice(0, -3),
    " ".repeat(2 * 1024 * 1024 + 1)]) expect(() => parseSinaGlobalHistory("AAPL", "US", text)).toThrow();
});

it("rejects invalid or repeated decoded dates and whole malformed requested windows without rounding or deleting bad rows", () => {
  const row = { date: new Date("2025-01-06T00:00:00Z"), open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 };
  const decode = spyOn(decoder, "decodeSinaHistory"); restores.push(() => decode.mockRestore());
  for (const rows of [[row, row], [{ ...row, date: new Date("invalid") }], [{ ...row, close: 3 }], [{ ...row, volume: -1 }], [{ ...row, low: 0 }]]) {
    decode.mockReturnValue(rows);
    expect(() => parseSinaGlobalHistory("AAPL", "US", sinaDeclaration("AAPL"), "2025-01-06", "2025-01-07")).toThrow("response invalid");
  }
  decode.mockReturnValue([{ ...row, close: 3 }, { ...row, date: new Date("2025-01-07T00:00:00Z") }]);
  expect(parseSinaGlobalHistory("AAPL", "US", sinaDeclaration("AAPL"), "2025-01-07", "2025-01-07")).toHaveLength(1);
});

it("uses fixed HTTPS addresses without redirects, cancels before requests and sanitizes transport failures", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    urls.push(String(input)); expect(init?.redirect).toBe("error");
    return new Response(sinaDeclaration(String(input).includes("hkstock") ? "00700" : "AAPL"));
  }) as typeof fetch;
  await fetchSinaGlobalHistory("aapl", "US"); await fetchSinaGlobalHistory("00700.hk", "HK");
  expect(urls).toEqual(["https://finance.sina.com.cn/staticdata/us/AAPL", "https://finance.sina.com.cn/stock/hkstock/00700/klc2_kl.js"]);
  const controller = new AbortController(); controller.abort(new Error("cancel before source"));
  await expect(fetchSinaGlobalHistory("AAPL", "US", undefined, undefined, controller.signal)).rejects.toThrow("cancel before source");
  expect(urls).toHaveLength(2);
  globalThis.fetch = (async () => { throw new Error("PRIVATE URL TOKEN"); }) as unknown as typeof fetch;
  await expect(fetchSinaGlobalHistory("AAPL", "US")).rejects.toThrow("Provider connection failed");
});

it("restores both native-blocked global adapters through the source facade with actual endpoint and price basis", async () => {
  const run = spyOn(python, "runPython").mockResolvedValue({ stdout: JSON.stringify({ error: "[WinError 4551] fixture DLL block" }), stderr: "" });
  restores.push(() => run.mockRestore());
  globalThis.fetch = (async input => new Response(sinaDeclaration(String(input).includes("hkstock") ? "00700" : "AAPL"))) as typeof fetch;
  for (const [market, symbol, endpoint] of [["US", "AAPL", "sina_us_daily_native_free"], ["HK", "00700.HK", "sina_hk_daily_native_free"]] as const) {
    const detailed = await fetchFromAKShareGlobalDetailed(symbol, market, "2025-01-06", "2025-01-07");
    expect(detailed).toMatchObject({ endpoint, adjustment: "unadjusted", attempts: [{ status: "error" }, { endpoint, status: "ok", rows: 2 }] });
    const pulled = await pullBarsFromProviders(symbol, market, "2025-01-06", "2025-01-07", "akshare", { fallbackOrder: { [market]: ["akshare"] } });
    expect(pulled).toMatchObject({ source: "akshare", providerEndpoint: endpoint, adjustment: "unadjusted", bars: [{ date: "2025-01-06" }, { date: "2025-01-07" }] });
  }
});

it("never activates the new fallback for unrelated failures, actual empty responses or cancellation", async () => {
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Response(sinaDeclaration("AAPL")); }) as unknown as typeof fetch;
  const run = spyOn(python, "runPython"); restores.push(() => run.mockRestore());
  run.mockResolvedValue({ stdout: JSON.stringify({ bars: [], endpoint: "stock_us_daily", attempts: [{ endpoint: "stock_us_daily", status: "ok", rows: 0 }] }), stderr: "" });
  expect((await fetchFromAKShareGlobalDetailed("AAPL", "US")).bars).toEqual([]);
  run.mockResolvedValue({ stdout: JSON.stringify({ error: "network failure" }), stderr: "" });
  await expect(fetchFromAKShareGlobalDetailed("AAPL", "US")).rejects.toThrow("network failure");
  const controller = new AbortController();
  run.mockImplementation(async () => { controller.abort(new Error("cancel native pull")); return { stdout: JSON.stringify({ error: "[WinError 4551] blocked" }), stderr: "" }; });
  await expect(fetchFromAKShareGlobalDetailed("AAPL", "US", undefined, undefined, controller.signal)).rejects.toThrow("cancel native pull");
  expect(requests).toBe(0);
});
