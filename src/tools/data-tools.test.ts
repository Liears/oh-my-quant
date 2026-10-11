import { describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import * as runtime from "../runtime/source-runtime.ts";
import { loadDataset, loadSettings, readBarsSnapshot, saveBars, saveSettings } from "../storage/index.ts";
import type { Bar } from "../types/data.ts";
import { fetchBarsTool, fetchIndexRowsTool, fetchSnapshotTool, formatBarsChartBlock } from "./data-tools.ts";

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .map((part) => part.type === "text" ? part.text : "")
    .join("\n");
}

describe("data tools UX messages", () => {
  it("shows the actual AKShare endpoint in bars and snapshots when provenance is available", async () => {
    const observed = makeBars(1)[0]!;
    const fetch = spyOn(runtime, "fetchBars").mockResolvedValue({
      bars: [observed], source: "akshare", providerEndpoint: "stock_zh_index_hist_csindex",
      origin: "provider", asOfDate: observed.date, attempts: [],
    });
    try {
      const bars = await fetchBarsTool.execute("endpoint-bars", { symbol: "000300.SH", market: "A" });
      const snapshot = await fetchSnapshotTool.execute("endpoint-snapshot", { symbol: "000300.SH", market: "A" });
      expect(resultText(bars)).toContain("stock_zh_index_hist_csindex");
      expect(bars.details).toMatchObject({ providerEndpoint: "stock_zh_index_hist_csindex" });
      expect(resultText(snapshot)).toContain("stock_zh_index_hist_csindex");
      expect(snapshot.details).toMatchObject({ snapshot: { providerEndpoint: "stock_zh_index_hist_csindex" } });
      expect(resultText(snapshot)).toContain("price date");
      expect(resultText(snapshot)).toContain("not application observation or proven publication time");
    } finally { fetch.mockRestore(); }
  });

  it("returns a structured invalid-symbol result before an incompatible market reaches the runtime", async () => {
    const fetch = spyOn(runtime, "fetchBars").mockImplementation(async () => { throw new Error("runtime must not run"); });
    try {
      const bars = await fetchBarsTool.execute("bad-bars", { symbol: "00700.HK", market: "US" });
      const snapshot = await fetchSnapshotTool.execute("bad-snapshot", { symbol: "AAPL", market: "HK" });
      const unknownMarket = await fetchSnapshotTool.execute("bad-market", { symbol: "AAPL", market: "WRONG" });
      expect(bars.details).toMatchObject({ error: { code: "INPUT_INVALID_SYMBOL" } });
      expect(snapshot.details).toMatchObject({ error: { code: "INPUT_INVALID_SYMBOL" } });
      expect(unknownMarket.details).toMatchObject({ error: { code: "INPUT_INVALID_SYMBOL" } });
      expect(resultText(bars)).toContain("market");
      expect(resultText(snapshot)).toContain("market");
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it("fetches US and HK data through the runtime and identifies offline fallback", async () => {
    const fetch = spyOn(runtime, "fetchBars").mockResolvedValue({
      bars: makeBars(6), source: "llmquant-data", origin: "stale-cache", asOfDate: "2026-01-06", attempts: [],
    });
    try {
      for (const [symbol, market] of [["AAPL", "US"], ["00700.HK", "HK"]]) {
        const result = await fetchBarsTool.execute("t1", { symbol: symbol!, market: market! });
        expect(resultText(result)).toContain("offline fallback");
        expect(result.details).toMatchObject({ symbol, market, source: "llmquant-data", barCount: 6 });
        expect(fetch).toHaveBeenLastCalledWith(symbol, market, undefined, undefined, undefined, { providers: { signal: undefined } });
      }
    } finally { fetch.mockRestore(); }
  });

  it("labels a bounded refresh failure in bars and snapshots while keeping stale values visibly cached", async () => {
    const fetch = spyOn(runtime, "fetchBars").mockResolvedValue({
      bars: makeBars(1), source: "akshare", origin: "stale-cache", asOfDate: "2026-01-01",
      attempts: [{ source: "akshare", status: "error", error: "Provider request timed out" }], budgetExhausted: true,
    });
    try {
      const bars = await fetchBarsTool.execute("budget-bars", { symbol: "000300.SH", market: "A" });
      const snapshot = await fetchSnapshotTool.execute("budget-snapshot", { symbol: "000300.SH", market: "A" });
      expect(resultText(bars)).toContain("offline fallback — cached data, refresh failed");
      expect(resultText(bars)).toContain("source request budget exhausted");
      expect(resultText(snapshot)).toContain("source request budget exhausted; snapshot is cached");
      expect(bars.details).toMatchObject({ origin: "stale-cache", budgetExhausted: true });
      expect(snapshot.details).toMatchObject({ budgetExhausted: true, snapshot: { origin: "stale-cache" } });
    } finally { fetch.mockRestore(); }
  });

  it("shows unavailable turnover in a snapshot while preserving a reported zero", async () => {
    const missing = { ...makeBars(1)[0]!, amount: null };
    const actualZero = { ...missing, amount: 0 };
    const fetch = spyOn(runtime, "fetchBars").mockResolvedValue({
      bars: [missing], source: "akshare", origin: "provider", asOfDate: missing.date, attempts: [],
    });
    try {
      const unavailable = await fetchSnapshotTool.execute("missing", { symbol: "AAPL", market: "US" });
      expect(unavailable.details).toMatchObject({ snapshot: { amount: null } });
      expect(resultText(unavailable)).toContain("amount  unavailable");
      expect(resultText(unavailable)).not.toContain("amount  0");
      fetch.mockResolvedValue({ bars: [actualZero], source: "akshare", origin: "provider", asOfDate: actualZero.date, attempts: [] });
      const zero = await fetchSnapshotTool.execute("zero", { symbol: "AAPL", market: "US" });
      expect(zero.details).toMatchObject({ snapshot: { amount: 0 } });
      expect(resultText(zero)).toContain("amount  0");
    } finally { fetch.mockRestore(); }
  });

  it("does not present an unverified legacy-cache zero as reported turnover", async () => {
    const observed = { ...makeBars(1)[0]!, amount: 0 };
    const fetch = spyOn(runtime, "fetchBars").mockResolvedValue({
      bars: [observed], source: "financial-datasets", origin: "stale-cache", asOfDate: observed.date,
      attempts: [], turnoverSemantics: "legacy-unknown",
    });
    try {
      const legacy = await fetchSnapshotTool.execute("legacy", { symbol: "AAPL", market: "US" });
      expect(legacy.details).toMatchObject({ snapshot: { amount: null, amountEvidence: "legacy-unknown" } });
      expect(resultText(legacy)).toContain("amount  unavailable");
      expect(resultText(legacy)).toContain("legacy-unknown");
      fetch.mockResolvedValue({ bars: [observed], source: "financial-datasets", origin: "cache",
        asOfDate: observed.date, attempts: [], turnoverSemantics: "nullable" });
      const reported = await fetchSnapshotTool.execute("reported", { symbol: "AAPL", market: "US" });
      expect(reported.details).toMatchObject({ snapshot: { amount: 0 } });
      expect(resultText(reported)).toContain("amount  0");
    } finally { fetch.mockRestore(); }
  });

  it("reads a legacy head through the real storage/source tool path and preserves its old revision", async () => {
    const previous = process.env.OHQUANT_DIR;
    const root = mkdtempSync(join(tmpdir(), "whyj-snapshot-legacy-"));
    const network = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider request"));
    process.env.OHQUANT_DIR = root;
    try {
      const settings = loadSettings(); settings.preferences.source = "financial-datasets"; saveSettings(settings);
      const zero = { ...makeBars(1)[0]!, amount: 0 };
      const ref = (await saveBars("AAPL", "financial-datasets", [zero]))!;
      const snapshot = readBarsSnapshot("AAPL", "financial-datasets")!;
      const { turnoverSemantics: _marker, ...legacyMeta } = snapshot.meta;
      const payload = { version: 1, bars: snapshot.bars, meta: legacyMeta };
      const revision = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      const bytes = JSON.stringify({ ...payload, revision });
      const dir = join(root, "data", "financial-datasets", "AAPL");
      writeFileSync(join(dir, "snapshot.json"), bytes);
      writeFileSync(join(dir, "revisions", `${revision}.json`), bytes);
      const legacy = await fetchSnapshotTool.execute("legacy-runtime", { symbol: "AAPL", market: "US" });
      expect(legacy.details).toMatchObject({ dataset: { revision }, snapshot: { amount: null, amountEvidence: "legacy-unknown" } });
      expect(resultText(legacy)).toContain("amount  unavailable");
      expect(loadDataset({ ...ref, revision })).toEqual([zero]);
      await saveBars("AAPL", "financial-datasets", [zero]);
      const current = await fetchSnapshotTool.execute("nullable-runtime", { symbol: "AAPL", market: "US" });
      expect(current.details).toMatchObject({ snapshot: { amount: 0 } });
      expect(resultText(current)).toContain("amount  0");
      expect(readFileSync(join(dir, "revisions", `${revision}.json`), "utf8")).toBe(bytes);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
      if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected legacy snapshot fixture root");
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects non-whitelisted AKShare index endpoints before calling Python", async () => {
    const result = await fetchIndexRowsTool.execute("t2", {
      endpoint: "stock_zh_a_spot_em",
    });

    const text = resultText(result);
    expect(text).toContain("Unsupported AKShare index endpoint");
    expect(text).toContain("whitelisted index endpoints");
  });

  it("formats fetched bars with deterministic close and K-line chart blocks", () => {
    const bars = makeBars(6);
    const lines = formatBarsChartBlock(bars);

    expect(lines[0]).toContain("⌁ Close");
    expect(lines[0]).toMatch(/[▁▂▃▄▅▆▇█]/);
    expect(lines[1]).toContain("▥ Volume");
    expect(lines[1]).toMatch(/[▁▂▃▄▅▆▇█]/);
    expect(lines).toContain("┃ K-line");
    expect(lines.some((line) => line.includes("2026-01-06") && line.includes("O=") && line.includes("C="))).toBe(true);
    expect(lines.some((line) => /[▲▼─]/.test(line))).toBe(true);
  });
});

function makeBars(count: number): Bar[] {
  const start = new Date(Date.UTC(2026, 0, 1));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const close = 10 + index * 0.4 + (index % 2 === 0 ? 0.2 : -0.1);
    return {
      date: date.toISOString().slice(0, 10),
      open: close - (index % 2 === 0 ? 0.2 : -0.2),
      high: close + 0.5,
      low: close - 0.6,
      close,
      volume: 1000 + index,
      amount: close * (1000 + index),
    };
  });
}
