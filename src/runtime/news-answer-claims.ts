import type { PriceAdjustment } from "../types/data.ts";

// Explicit price-basis labels only; absence of a label is not evidence for a basis.
const BASIS = /(?:收盘价|价格)\s*[:：=]?\s*(?:为|是|使用|采用)?\s*(未复权|非复权|前复权)(?:价)?|\b(?:price\s+(?:adjustment|basis)|close(?:\s+prices?)?)\s*[:=]\s*(unadjusted|forward-adjusted)\b|\b(unadjusted|forward-adjusted|raw)\s+(?:closes?|prices?)\b/giu;

export function knownNewsPriceBasisViolations(text: string, adjustment: PriceAdjustment | null): string[] {
  for (const match of text.matchAll(BASIS)) {
    const preceding = text.slice(Math.max(0, match.index! - 80), match.index!).split(/[。.!?！？;；\n]/u).at(-1)!;
    if (/(?:未知|未核实|不确定|不能|无法|不应|不代表|不表示|(?:not|cannot|unknown|unverified|do not|don't)\b)/iu.test(preceding)) continue;
    const label = match[1] ?? match[2] ?? match[3]!;
    const claimed = /前复权|forward-adjusted/iu.test(label) ? "forward-adjusted" : "unadjusted";
    if (claimed !== adjustment) return ["unsupported-news-price-adjustment"];
  }
  return [];
}
