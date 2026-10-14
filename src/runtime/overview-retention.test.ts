import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePanelPortfolio } from "../storage/index.ts";
import { OverviewRefresh } from "./overview-refresh.ts";
import { OverviewRequestPool, type OverviewQuote } from "./overview-data.ts";
import { buildOverviewLines } from "../tui/src/overview-render.ts";
import { drawPortfolio, layout } from "../tui/src/render.ts";
import { Buffer } from "../tui/src/buffer.ts";
import type { PanelSection } from "../tui/src/types.ts";
import type { LiveBarsFetchResult } from "../source/index.ts";

it("retains an unavailable symbol's original observation and retries only the failed symbol", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-retained-quotes-"));
  const previous = process.env.OHQUANT_DIR;
  process.env.OHQUANT_DIR = root;
  savePanelPortfolio({ updated: "", groups: [], symbols: [{ code: "AAPL", name: "Apple", added: "" }] });
  let round = 0;
  const seen: string[][] = [];
  let panel: PanelSection[] = [];
  let refreshingText = "";
  const rows = (): OverviewQuote[] => panel.flatMap(section => section.kind === "quotes" || section.kind === "holdings" || section.kind === "group" ? section.rows : []);
  const refresh = new OverviewRefresh({ intervalMs: 0, onPanel: (value, loading) => {
    panel = value;
    if (loading && rows().some(row => row.refreshState === "refreshing" && row.code === "AAPL")) {
      const buffer = new Buffer(160, 48);
      drawPortfolio(buffer, layout(160, 48).portfolio, panel, loading);
      refreshingText = buffer.toPlain().join("\n");
    }
  },
    poolFactory: (signal, budget) => {
      round++;
      const requests: string[] = []; seen.push(requests);
      return new OverviewRequestPool({ signal, budget, fetcher: async symbol => {
        requests.push(symbol);
        const date = round === 1 ? "2026-09-11" : "2026-09-12";
        const close = round === 1 ? 105 : 110;
        const result: LiveBarsFetchResult = { source: "akshare", window: "requested", asOfDate: date,
          attempts: [{ source: "akshare", status: "success" }], bars: [100, close].map((value, index) => ({ date: index ? date : "2026-09-10", open: value, high: value, low: value, close: value, volume: 1, amount: value })) };
        return round === 2 && symbol === "AAPL" ? { ...result, source: "unavailable", window: "unavailable", asOfDate: "", bars: [] } : result;
      } });
    } });
  try {
    await refresh.refresh();
    const original = structuredClone(rows().find(row => row.code === "AAPL")!);
    await refresh.refresh();
    expect(refreshingText).toContain("AAPL");
    expect(refreshingText).toContain("2026-09-11");
    const retained = rows().find(row => row.code === "AAPL")!;
    expect(retained.price).toBe(105);
    expect(retained.observation).toEqual(original.observation);
    expect(retained.refreshState).toBe("stale");
    expect(buildOverviewLines(panel, 48).map(line => line.text).join("\n")).toContain("2026-09-11");
    await refresh.retryFailed();
    expect(seen[2]).toEqual(["AAPL"]);
    const recovered = rows().find(row => row.code === "AAPL")!;
    expect(recovered.price).toBe(110);
    expect(recovered.refreshState).toBeUndefined();
    expect(recovered.observation?.asOfDate).toBe("2026-09-12");
    await refresh.retryFailed();
    expect(seen.length).toBe(3);
  } finally {
    refresh.dispose();
    if (previous === undefined) delete process.env.OHQUANT_DIR;
    else process.env.OHQUANT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
