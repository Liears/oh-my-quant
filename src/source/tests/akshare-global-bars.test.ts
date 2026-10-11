import { afterEach, expect, it, spyOn } from "bun:test";
import * as python from "../src/akshare-python.ts";
import { fetchFromAKShareGlobalDetailed } from "../src/akshare-global-bars.ts";
import { fetchFromAKShareDetailed } from "../src/akshare.ts";

const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });

it("routes normalized US and HK identities to their public daily endpoints and preserves window dates", async () => {
  const calls: Array<{ args: string[]; signal: AbortSignal | undefined }> = [];
  const run = spyOn(python, "runPython").mockImplementation(async (script, args, options) => {
    calls.push({ args: [...(args ?? [])], signal: options?.signal });
    const endpoint = args?.[0] === "US" ? "stock_us_daily" : "stock_hk_daily";
    expect(script).toContain(`getattr(ak, endpoint)(symbol=symbol, adjust="")`);
    return { stdout: JSON.stringify({ endpoint, attempts: [{ endpoint, status: "ok", rows: 1 }],
      bars: [{ date: "2025-01-17", open: 10, high: 12, low: 9, close: 11, volume: 100,
        ...(endpoint === "stock_hk_daily" ? { amount: 200 } : {}) }] }), stderr: "" };
  });
  restores.push(() => run.mockRestore());
  const controller = new AbortController();
  const us = await fetchFromAKShareGlobalDetailed("aapl", "US", "2025-01-06", "2025-01-17", controller.signal);
  const hk = await fetchFromAKShareGlobalDetailed("00700.hk", "HK", "2025-01-06", "2025-01-17", controller.signal);
  expect(us).toMatchObject({ endpoint: "stock_us_daily", adjustment: "unadjusted", bars: [{ date: "2025-01-17", close: 11, amount: null }] });
  expect(hk).toMatchObject({ endpoint: "stock_hk_daily", adjustment: "unadjusted", bars: [{ date: "2025-01-17", close: 11, amount: 200 }] });
  expect(calls).toEqual([
    { args: ["US", "AAPL", "2025-01-06", "2025-01-17"], signal: controller.signal },
    { args: ["HK", "00700", "2025-01-06", "2025-01-17"], signal: controller.signal },
  ]);
});

it("records the basis of the successful A-market route including ambiguous fund/index fallback", async () => {
  const cases = [
    ["000001.SZ", "stock_zh_a_hist", "forward-adjusted"],
    ["000001.SZ", "stock_zh_a_daily", "forward-adjusted"],
    ["000001.SZ", "stock_zh_a_hist_tx", "forward-adjusted"],
    ["000300", "stock_zh_index_hist_csindex", "index-level"],
    ["270042", "fund_open_fund_info_em", "unit-nav"],
    ["000001.SZ", "unknown_daily", "provider-unspecified"],
  ] as const;
  const run = spyOn(python, "runPython");
  restores.push(() => run.mockRestore());
  for (const [symbol, endpoint, mode] of cases) {
    run.mockImplementation(async script => {
      expect(script.match(/adjust="qfq"/g)).toHaveLength(3);
      expect(script).toContain('indicator="单位净值走势"');
      return { stdout: JSON.stringify({ endpoint, bars: [{ date: "2025-01-17", open: 10, high: 10, low: 10, close: 10, volume: 0 }] }), stderr: "" };
    });
    expect((await fetchFromAKShareDetailed(symbol)).adjustment).toBe(mode);
  }
});

it("rejects a mismatched market, Python error payload, and cancellation before returning bars", async () => {
  const run = spyOn(python, "runPython").mockResolvedValue({ stdout: JSON.stringify({ error: "upstream unavailable" }), stderr: "" });
  restores.push(() => run.mockRestore());
  await expect(fetchFromAKShareGlobalDetailed("00700.HK", "US")).rejects.toThrow("market US");
  expect(run).not.toHaveBeenCalled();
  await expect(fetchFromAKShareGlobalDetailed("AAPL", "US")).rejects.toThrow("upstream unavailable");
  const controller = new AbortController(); controller.abort(new Error("stopped"));
  await expect(fetchFromAKShareGlobalDetailed("AAPL", "US", undefined, undefined, controller.signal)).rejects.toThrow("stopped");
  expect(run).toHaveBeenCalledTimes(1);
});
