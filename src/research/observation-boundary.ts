import { validateDateRange } from "../market/bars.ts";
import { validateObservationCutoff } from "../market/observation-cutoff.ts";
import { normalizeSymbol } from "../market/symbols.ts";
import type { ResearchDataset } from "./types.ts";
import { record } from "./references.ts";

/** Verify that a computed result used the one app archive named by its original tool call. */
export function verifyAppArchiveBoundary(args: Record<string, unknown>, saved: Record<string, unknown>,
  roles: Record<string, number>, datasets: ResearchDataset[]): string {
  if (typeof args.symbol !== "string" || typeof args.market !== "string" || typeof args.start !== "string"
    || typeof args.end !== "string" || typeof args.observed_before !== "string")
    throw new Error("Missing archived analysis scope");
  validateDateRange(args.start, args.end);
  const cutoff = validateObservationCutoff(args.observed_before);
  const index = roles.input, primary = index === undefined ? undefined : datasets[index];
  if (!primary || !("bars" in primary) || primary.ref.symbol !== normalizeSymbol(args.symbol, args.market as "A" | "US" | "HK")
    || primary.ref.market !== args.market || primary.ref.requested.start !== args.start || primary.ref.requested.end !== args.end)
    throw new Error("Archived analysis dataset scope mismatch");
  const observedAt = validateObservationCutoff(primary.ref.snapshotAt);
  const boundary = record(saved.historicalBoundary), request = record(saved.archiveRequest);
  if (observedAt > cutoff || saved.observationAt !== primary.ref.snapshotAt
    || saved.historicalAvailability !== "app-archive-observed-before"
    || boundary?.observedBefore !== args.observed_before || boundary.evidence !== "app-archive"
    || request?.symbol !== args.symbol || request.market !== args.market || request.start !== args.start || request.end !== args.end
    || request.observedBefore !== args.observed_before || request.source !== (args.source ?? "configured source"))
    throw new Error("Archived analysis observation boundary mismatch");
  return `App archive observed ${primary.ref.snapshotAt} by UTC cutoff ${args.observed_before}; provider publication and complete trading days unverified.`;
}
