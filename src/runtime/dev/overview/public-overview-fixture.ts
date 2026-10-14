// Explicit public benchmark symbols, unrelated to saved watchlists or holdings.
const A_SYMBOLS = ["000001.SZ", "600519.SH", "000858.SZ", "600036.SH", "601318.SH", "600900.SH", "601398.SH", "601288.SH", "601939.SH", "601988.SH", "600000.SH", "601166.SH", "600030.SH", "600887.SH", "000333.SZ", "000651.SZ", "002594.SZ", "300750.SZ", "002415.SZ", "002475.SZ"];
const US_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AMD", "INTC", "ORCL", "IBM", "CSCO", "JPM", "BAC", "V", "MA", "KO", "PEP", "WMT", "DIS"];
const HK_SYMBOLS = ["00700.HK", "09988.HK", "03690.HK", "00941.HK", "01299.HK", "02318.HK", "00388.HK", "00005.HK", "00883.HK", "00939.HK"];

export function publicOverviewPortfolio(size: number) {
  if (![4, 10, 50].includes(size)) throw new Error("--portfolio-size must be 4, 10 or 50.");
  if (size === 4) return [
    { code: "000001.SZ", name: "A share", added: "" },
    { code: "000300.SH", name: "Shared index", added: "" },
    { code: "AAPL", name: "US stock", added: "" },
    { code: "00700.HK", name: "HK stock", added: "" },
  ];
  return A_SYMBOLS.flatMap((symbol, index) => [symbol, US_SYMBOLS[index]!, ...(HK_SYMBOLS[index] ? [HK_SYMBOLS[index]!] : [])])
    .slice(0, size).map(code => ({ code, name: code, added: "" }));
}
