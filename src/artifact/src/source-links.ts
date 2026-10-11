import type { ResearchReport } from "../../research/types.ts";

export interface InstrumentLookupUrl { label: string; url: string }

/** External lookup pages are selected from verified archive identities, never title or assistant text. */
export function instrumentLookupUrls(datasets: ResearchReport["datasets"]): InstrumentLookupUrl[] {
  const urls: InstrumentLookupUrl[] = [];
  const seen = new Set<string>();
  for (const dataset of datasets) {
    const ref = dataset.ref;
    if (seen.has(ref.symbol)) continue;
    if (ref.kind === "fund-nav") {
      const match = /^(\d{6})\.OF$/.exec(ref.symbol);
      if (!match) continue;
      seen.add(ref.symbol);
      urls.push({ label: `雪球 · ${ref.symbol}`, url: `https://danjuanfunds.com/funding/${match[1]}` },
        { label: `同花顺 · ${ref.symbol}`, url: `https://fund.10jqka.com.cn/${match[1]}/` });
      continue;
    }
    // An A-market suffix alone does not distinguish a stock from an ETF or index.
    if (ref.kind !== "daily-bars" || ref.market !== "A" || ref.providerEndpoint !== "stock_zh_a_daily") continue;
    const match = /^(\d{6})\.(SZ|SH)$/.exec(ref.symbol);
    if (!match) continue;
    seen.add(ref.symbol);
    urls.push({ label: `雪球 · ${ref.symbol}`, url: `https://xueqiu.com/S/${match[2]}${match[1]}` },
      { label: `同花顺 · ${ref.symbol}`, url: `https://stockpage.10jqka.com.cn/${match[1]}/` });
  }
  return urls;
}
