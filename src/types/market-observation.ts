/** Public quote attribution, not private position state or a real-time price guarantee. */
export interface QuoteObservation {
  symbol: string;
  source: string;
  sourceLabel: string;
  asOfDate: string | null;
  fetchedAt: string;
  state: "available" | "outside-window" | "unavailable";
  fallback: boolean;
}
