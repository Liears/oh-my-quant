import { createHash } from "node:crypto";
import { normalizeSymbol } from "../../../market/symbols.ts";
import type { OverviewQuote } from "../../workspace/overview-data.ts";
import type { LiveBarsFetchResult } from "../../../source/index.ts";

/** Retains public inputs and compares the final application rows with the same generation. */
export function publicOverviewEvidence(quotes: OverviewQuote[], inputs: Map<string, LiveBarsFetchResult>, expectedSymbols: string[]) {
  const rowIdentitiesMatch = JSON.stringify(quotes.map(row => normalizeSymbol(row.code)).sort()) === JSON.stringify(expectedSymbols.toSorted());
  const quoteAudit = quotes.map(row => {
    const symbol = normalizeSymbol(row.code), input = inputs.get(symbol), last = input?.bars.at(-1), previous = input?.bars.at(-2);
    const priceMatches = last !== undefined && Number.isFinite(row.price) && row.price === last.close;
    const changeMatches = last !== undefined && previous !== undefined && Number.isFinite(row.pct)
      && Math.abs(row.pct - (last.close / previous.close - 1) * 100) <= 1e-10;
    const sourceMatches = input !== undefined && row.observation?.source === input.source;
    const dateMatches = last !== undefined && row.observation?.asOfDate === last.date && input?.asOfDate === last.date;
    const symbolMatches = row.observation?.symbol === symbol;
    return { symbol, passed: priceMatches && changeMatches && sourceMatches && dateMatches && symbolMatches, priceMatches, changeMatches, sourceMatches, dateMatches, symbolMatches };
  });
  const publicInputs = [...inputs].map(([symbol, input]) => ({ symbol, source: input.source, asOfDate: input.asOfDate,
    window: input.window, endpoint: input.providerEndpoint, barsSha256: createHash("sha256").update(JSON.stringify(input.bars)).digest("hex"), bars: input.bars }));
  return { rowIdentitiesMatch, quoteAudit, publicInputs };
}

export type PublicOverviewEvidence = ReturnType<typeof publicOverviewEvidence>;
