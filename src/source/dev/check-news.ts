import { fetchNews } from "../index.ts";
import type { Market } from "../../types/data.ts";
import type { NewsProvider } from "../../types/news.ts";

const args = process.argv.slice(2);
if (args[0] === "--help") {
  console.log("Usage: bun run src/source/dev/check-news.ts SYMBOL A|US|HK START END [auto|yahoo|eastmoney]\nDates: YYYY-MM-DD. Public news only; no model, prices, credentials or storage. Exit 0: articles; 2: unavailable; 3: empty/outside window.");
} else {
  const [symbol, market, start, end, provider = "auto"] = args;
  if (!symbol || !market || !["A", "US", "HK"].includes(market) || !start || !end || !["auto", "yahoo", "eastmoney"].includes(provider) || args.length > 5) {
    throw new Error("Use --help for the explicit news observation parameters.");
  }
  const result = await fetchNews({ symbol, market: market as Market, start, end, provider: provider as NewsProvider | "auto" });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "available" ? 0 : result.status === "unavailable" ? 2 : 3;
}
