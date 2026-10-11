import type { PriceAdjustment } from "../types/data.ts";

export function isPriceAdjustment(value: unknown): value is PriceAdjustment {
  return value === "provider-unspecified" || value === "forward-adjusted" || value === "unadjusted"
    || value === "unit-nav" || value === "index-level";
}

/** Calculations use close; adjustment labels do not certify provider publication or total return. */
export function priceAdjustmentNote(adjustment: PriceAdjustment): string {
  const notes: Record<PriceAdjustment, string> = {
    "provider-unspecified": "OHLC adjustment basis unverified; corporate-action and dividend treatment unknown. The use of close or absence of adjClose does not identify an unadjusted or forward-adjusted basis.",
    "forward-adjusted": "Forward-adjusted OHLC requested; historical levels may change between fetches. Provider adjustment is not independently calibrated.",
    unadjusted: "Unadjusted OHLC requested; splits and distributions may distort close-to-close returns; no corporate-action reconciliation.",
    "unit-nav": "Unit NAV used as OHLC; cash distributions are excluded from close-to-close returns.",
    "index-level": "Published index levels used as OHLC; index dividend and constituent methodology unverified.",
  };
  return `Price adjustment: ${adjustment}; calculations use close, not adjClose. ${notes[adjustment]}`;
}
