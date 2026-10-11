import type { BarsFetchResult } from "../../source/index.ts";
import { priceAdjustmentNote } from "../../market/price-adjustment.ts";

/** Price date and application-observation time are separate evidence, not interchangeable as-of dates. */
export function dataTimeEvidence(result: Pick<BarsFetchResult, "asOfDate" | "dataset" | "adjustment" | "observationAt" | "historicalBoundary">) {
  const priceAdjustment = result.dataset?.adjustment ?? result.adjustment ?? "provider-unspecified";
  return {
    priceAdjustment,
    priceAdjustmentNote: priceAdjustmentNote(priceAdjustment),
    latestBarDate: result.asOfDate,
    observationAt: result.observationAt ?? result.dataset?.snapshotAt ?? null,
    historicalAvailability: result.historicalBoundary?.evidence === "app-archive"
      ? "app-archive-observed-before" as const : result.dataset ? "observed-at-fetch" as const : "unverified" as const,
  };
}
