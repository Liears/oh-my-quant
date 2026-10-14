import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fetchNews } from "../../source/index.ts";
import { extractNewsDocument } from "../../source/src/news-document.ts";
import { saveBars } from "../../storage/index.ts";
import { createBuiltinTools } from "../../tools/registry.ts";
import { formatResearchContext, projectResearchState } from "../../research/state.ts";
import { researchEntries, researchMessages } from "../../research/test/fixtures.ts";
import { researchNews } from "../research/news-research.ts";

let root: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-news-qualification-")); process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected news qualification fixture root");
  rmSync(root, { recursive: true, force: true });
});

test.each(["AAPL didn't beat estimates", "AAPL 未上调评级", "If demand improves, AAPL raises guidance"])(
  "production news tool and recovery retain uncertainty despite matching price direction: %s", async title => {
    const request = { symbol: "AAPL", market: "US" as const, start: "2026-09-01", end: "2026-09-10" };
    const bars = [1, 2, 3, 4, 7, 8, 9, 10].map((day, index) => {
      const close = 100 + index;
      return { date: `2026-09-${String(day).padStart(2, "0")}`, open: close, high: close, low: close, close, volume: 100, amount: 1000 };
    });
    const dataset = (await saveBars("AAPL", "financial-datasets", bars, request.start, request.end))!;
    const tool = createBuiltinTools({ news: {
      news: (input, options) => fetchNews(input, { ...options, now: () => new Date("2026-09-14T12:00:00Z"), transport: async () => [
        { title, uuid: "qualification", publisher: "Synthetic News", link: "https://finance.yahoo.com/news/qualification",
          relatedTickers: ["AAPL"], providerPublishTime: Date.parse("2026-09-07T12:00:00Z") / 1000 },
      ] }),
      prices: async () => ({ bars, dataset, source: "financial-datasets", origin: "provider", attempts: [], asOfDate: request.end }),
      readDocument: async article => extractNewsDocument(article,
        `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>This synthetic article reports a conditional management discussion. It does not establish an actual change in reported financial results or support a directional allocation decision.</p></article></body></html>`,
        article.origins[0]!.url, article.origins[0]!.url, "2026-09-14T12:00:00Z"),
    } }).find(tool => tool.name === "research_news")!;
    const args = { ...request, read_articles: 1 };
    const output = await tool.execute("qualification", args);
    const result = output.details as Awaited<ReturnType<typeof researchNews>>;
    expect(result.price.status).toBe("available"); expect(result.price.momentum).toBeGreaterThan(0);
    expect(result.price.newsWindows.windows[0]!.subsequentReturn).toBeGreaterThan(0);
    expect(result.documents[0]!.status).toBe("available");
    expect(result.sentiment.tone).toBe("unknown"); expect(result.sentiment.counts.unknown).toBe(1);
    expect(result.adjustment.status).toBe("insufficient"); expect(result.adjustment.evidence.articleIds).toEqual([]);
    expect(result.adjustment.blockers).toContain("No interpretable directional title evidence for the target candidate.");
    const state = projectResearchState(researchEntries(researchMessages("research_news", args, result)), [tool.name]);
    const recovered = formatResearchContext(state);
    expect(recovered).toContain("manual review"); expect(recovered).toContain('"tone":"unknown"');
    expect(recovered).toContain('"status":"insufficient"');
    const legacy = { ...structuredClone(result), sentiment: { ...structuredClone(result.sentiment), method: "headline-phrases-v1" } };
    const older = projectResearchState(researchEntries(researchMessages("research_news", args, legacy)), [tool.name]);
    expect(older.operations[0]!.recordedScope!.sentiment).toEqual(legacy.sentiment);
    expect(formatResearchContext(older)).toContain("headline-phrases-v1");
  },
);
