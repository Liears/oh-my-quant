import { afterEach, expect, it, mock, spyOn } from "bun:test";
import * as python from "../src/akshare-python.ts";
import { fetchBars, fetchLiveBars, pullBarsFromProviders } from "../src/sources.ts";
import type { Bar } from "../../types/data.ts";

const bars: Bar[] = [{ date: "2025-01-06", open: 10, high: 11, low: 9, close: 10, volume: 100, amount: null }];
const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });

it("classifies all failed AKShare endpoints as a provider error and never saves their empty payload", async () => {
  const run = spyOn(python, "runPython").mockResolvedValue({ stdout: JSON.stringify({ bars: [], endpoint: null,
    attempts: [{ endpoint: "fund_open_fund_info_em", status: "error", error: "connection failed private-source-text" }] }), stderr: "" });
  restores.push(() => run.mockRestore());
  const save = mock(async (_symbol: string, _source: string, _bars: Bar[]) => {});
  const result = await fetchBars("270042.OF", "A", "2025-01-06", "2025-01-06", "akshare", {
    deps: { loadCache: async () => ({ bars: [], fresh: false }), saveBars: save, getPreferredSource: () => "akshare" },
    providers: { fallbackOrder: { A: ["akshare"] } },
  });
  expect(result).toMatchObject({ origin: "unavailable", source: "unavailable", bars: [],
    attempts: [{ source: "akshare", status: "error" }] });
  expect(JSON.stringify(result)).not.toContain("private-source-text");
  expect(save).not.toHaveBeenCalled();
});

it("does not retry an unrestricted live window when every internal endpoint failed", async () => {
  const run = spyOn(python, "runPython").mockResolvedValue({ stdout: JSON.stringify({ bars: [], endpoint: null,
    attempts: [{ endpoint: "index_zh_a_hist", status: "error", error: "timeout" },
      { endpoint: "stock_zh_index_daily_em", status: "error", error: "timeout" }] }), stderr: "" });
  restores.push(() => run.mockRestore());
  const result = await fetchLiveBars("000300.SH", "A", "2025-01-06", "2025-01-06", {
    providers: { fallbackOrder: { A: ["akshare"] } },
  });
  expect(result).toMatchObject({ window: "unavailable", bars: [],
    attempts: [{ source: "akshare", status: "error", error: "Provider request timed out" }] });
  expect(result.budgetExhausted).toBeUndefined(); // An endpoint error is not the shared request deadline.
  expect(run).toHaveBeenCalledTimes(1);
});

it("preserves a genuine empty response and its latest-available live retry even with another failed endpoint", async () => {
  const run = spyOn(python, "runPython").mockResolvedValueOnce({ stdout: JSON.stringify({ bars: [], endpoint: null,
    attempts: [{ endpoint: "index_zh_a_hist", status: "error", error: "offline" },
      { endpoint: "stock_zh_index_daily_em", status: "ok", rows: 0 }] }), stderr: "" })
    .mockResolvedValueOnce({ stdout: JSON.stringify({ bars, endpoint: "stock_zh_index_daily_em",
      attempts: [{ endpoint: "stock_zh_index_daily_em", status: "ok", rows: 1 }] }), stderr: "" });
  restores.push(() => run.mockRestore());
  const result = await fetchLiveBars("000300.SH", "A", "2025-01-07", "2025-01-07", {
    providers: { fallbackOrder: { A: ["akshare"] } },
  });
  expect(result).toMatchObject({ window: "latest-available", bars, source: "akshare", adjustment: "index-level",
    attempts: [{ source: "akshare", status: "empty" }, { source: "akshare", status: "success" }] });
  expect(run).toHaveBeenCalledTimes(2);
});

it("continues the compatible provider chain and saves only the successful provider's rows", async () => {
  const run = spyOn(python, "runPython").mockResolvedValue({ stdout: JSON.stringify({ bars: [], endpoint: null,
    attempts: [{ endpoint: "stock_zh_a_hist", status: "error", error: "HTTP 503 private-token-value" }] }), stderr: "" });
  restores.push(() => run.mockRestore());
  const save = mock(async (_symbol: string, _source: string, _bars: Bar[]) => {});
  const result = await fetchBars("000001.SZ", "A", "2025-01-06", "2025-01-06", "akshare", {
    deps: { loadCache: async () => ({ bars: [], fresh: false }), saveBars: save, getPreferredSource: () => "akshare" },
    providers: { adapters: { tushare: { fetchBars: async () => ({ bars, endpoint: "daily", adjustment: "unadjusted" }) } } },
  });
  expect(result).toMatchObject({ origin: "provider", source: "tushare", bars, adjustment: "unadjusted",
    attempts: [{ source: "akshare", status: "error", error: "HTTP 503" }, { source: "tushare", status: "success" }] });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.slice(0, 3)).toEqual(["000001.SZ", "tushare", bars]);
  expect(JSON.stringify(result)).not.toContain("private-token-value");
});

it("keeps successful AKShare internal fallback and legacy empty responses valid", async () => {
  const run = spyOn(python, "runPython").mockResolvedValueOnce({ stdout: JSON.stringify({ bars, endpoint: "stock_zh_a_daily",
    attempts: [{ endpoint: "stock_zh_a_hist", status: "error", error: "offline" },
      { endpoint: "stock_zh_a_daily", status: "ok", rows: 1 }] }), stderr: "" })
    .mockResolvedValueOnce({ stdout: "[]", stderr: "" });
  restores.push(() => run.mockRestore());
  const providers = { fallbackOrder: { A: ["akshare"] } } as const;
  expect(await pullBarsFromProviders("000001.SZ", "A", undefined, undefined, "akshare", providers))
    .toMatchObject({ source: "akshare", bars, providerEndpoint: "stock_zh_a_daily", adjustment: "forward-adjusted" });
  expect(await pullBarsFromProviders("000001.SZ", "A", undefined, undefined, "akshare", providers))
    .toMatchObject({ source: "unavailable", bars: [], attempts: [{ source: "akshare", status: "empty" }] });
});
