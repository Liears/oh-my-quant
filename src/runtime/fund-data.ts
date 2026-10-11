import { fetchAkshareFundNav, fetchAkshareFundPurchase } from "../source/index.ts";
import { normalizeFundNav, normalizeFundSymbol } from "../market/fund-nav.ts";
import { archiveFundNav } from "../storage/index.ts";
import type { FundFeeObservation } from "../types/fund-data.ts";
import type { AkshareAttempt } from "../source/src/akshare-types.ts";

/** Fetch public inputs and freeze their observations. No reads from account state or current caches. */
export async function loadFundDcaData(symbol: string, observeFee: boolean, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const canonical = normalizeFundSymbol(symbol), code = canonical.slice(0, 6);
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const purchaseRequest = observeFee ? fetchAkshareFundPurchase(code, requestSignal).then(data => {
    if (normalizeFundSymbol(data.symbol) !== canonical || (data.purchase["基金代码"] !== undefined && String(data.purchase["基金代码"]).padStart(6, "0") !== code)) throw new Error("Fund fee identity mismatch.");
    const raw = data.purchase["手续费"];
    const number = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d+(?:\.\d+)?\s*%?\s*$/.test(raw) ? Number(raw.replace("%", "").trim()) : Number.NaN;
    const rate = Number.isFinite(number) && number >= 0 && number < 100 ? number / 100 : null;
    return { fee: { source: "fund_purchase_em" as const, fetchedAt: new Date().toISOString(), rate }, purchase: data.purchase, attempts: data.attempts };
  }).catch(error => {
    requestSignal.throwIfAborted();
    return { fee: { source: "fund_purchase_em" as const, fetchedAt: new Date().toISOString(), rate: null }, purchase: {},
      attempts: [{ endpoint: "fund_purchase_em", status: "error" as const, error: error instanceof Error ? error.message : String(error) }] };
  }) : Promise.resolve({ fee: null as FundFeeObservation | null, purchase: {}, attempts: [] as AkshareAttempt[] });
  try {
    const [navData, purchaseData] = await Promise.all([fetchAkshareFundNav(code, requestSignal).then(data => ({ ...data, observedAt: new Date().toISOString() })), purchaseRequest]);
    requestSignal.throwIfAborted();
    if (normalizeFundSymbol(navData.symbol) !== canonical) throw new Error("Fund NAV identity mismatch.");
    const nav = normalizeFundNav(canonical, navData.nav);
    const dataset = await archiveFundNav(canonical, nav, "fund_open_fund_info_em", navData.observedAt, purchaseData.fee, requestSignal);
    requestSignal.throwIfAborted();
    return { symbol: canonical, nav, dataset, fee: purchaseData.fee, purchase: purchaseData.purchase, attempts: [...navData.attempts, ...purchaseData.attempts] };
  } catch (error) {
    controller.abort(error);
    throw error;
  }
}
