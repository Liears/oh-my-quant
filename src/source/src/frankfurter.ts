import { getJson, type HttpOptions } from "./http.ts";
import { isDailyDate, validateDateRange } from "../../market/bars.ts";
import type { ComparisonFx } from "../../types/portfolio-comparison.ts";

/** ECB daily reference observations through Frankfurter v2; no interpolation or forward fill. */
export async function fetchComparisonFx(baseCurrency: string, currencies: string[], start: string, end: string,
  options: HttpOptions & { baseUrl?: string } = {}): Promise<ComparisonFx> {
  options.signal?.throwIfAborted();
  validateDateRange(start, end);
  if ([baseCurrency, ...currencies].some(currency => !/^[A-Z]{3}$/.test(currency))) throw new Error("Use three-letter uppercase quote currencies.");
  const foreign = [...new Set(currencies.filter(currency => currency !== baseCurrency))].sort();
  if (!foreign.length) return { baseCurrency, points: [], source: "identity", observedAt: new Date().toISOString() };
  const url = new URL(`${(options.baseUrl ?? "https://api.frankfurter.dev").replace(/\/+$/, "")}/v2/rates`);
  url.search = new URLSearchParams({ base: baseCurrency, quotes: foreign.join(","), from: start, to: end, providers: "ecb" }).toString();
  const response = await getJson<unknown>(url.toString(), {}, options);
  options.signal?.throwIfAborted();
  if (!Array.isArray(response)) throw new Error("Invalid FX response.");
  const keys = new Set<string>();
  const points = response.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid FX row.");
    const row = raw as Record<string, unknown>;
    if (row.base !== baseCurrency || typeof row.quote !== "string" || !foreign.includes(row.quote)
      || typeof row.date !== "string" || !isDailyDate(row.date) || row.date < start || row.date > end
      || typeof row.rate !== "number" || !Number.isFinite(row.rate) || row.rate <= 0 || !Number.isFinite(1 / row.rate)) throw new Error("Invalid FX identity, date or rate.");
    const key = `${row.quote}:${row.date}`;
    if (keys.has(key)) throw new Error("Duplicate FX row.");
    keys.add(key);
    return { currency: row.quote, date: row.date, rate: 1 / row.rate };
  });
  for (const currency of foreign) if (!points.some(point => point.currency === currency)) throw new Error(`No ECB reference rates for ${currency}/${baseCurrency} in this window.`);
  return { baseCurrency, points: points.sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency)), source: "frankfurter-v2/ecb", observedAt: new Date().toISOString() };
}
