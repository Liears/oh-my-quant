import type { AccountHistory, AccountPerformanceRequest } from "./types.ts";

function fields(value: object, allowed: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Invalid account history fields.");
}
function identifier(value: string): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= 256; }
function instant(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000; }
function amount(value: number): boolean { return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER; }

export function validateAccountRequest(request: AccountPerformanceRequest): void {
  fields(request, ["accountRef", "currency", "startAt", "endAt"]);
  if (!identifier(request.accountRef) || typeof request.currency !== "string" || !/^[A-Z]{3}$/.test(request.currency)
    || !instant(request.startAt) || !instant(request.endAt) || request.endAt <= request.startAt) throw new Error("Invalid account identity, currency or interval.");
}

export function validateAccountHistory(history: AccountHistory): void {
  fields(history, ["version", "request", "source", "coverage", "equityBasis", "valuations", "externalFlows", "fees"]);
  validateAccountRequest(history.request);
  fields(history.source, ["adapterId", "reference", "observedAt"]);
  fields(history.coverage, ["externalFlows", "fees"]);
  if (history.version !== 1 || history.equityBasis !== "after-fees" || !identifier(history.source.adapterId) || !identifier(history.source.reference)
    || !instant(history.source.observedAt) || history.source.observedAt < history.request.endAt) throw new Error("Account history source or net-of-fees basis is invalid.");
  if (history.coverage.externalFlows !== "complete" || history.coverage.fees !== "complete") throw new Error("Complete external-flow and fee coverage is required; missing records cannot be treated as zero.");
  if (!Array.isArray(history.valuations) || history.valuations.length < 2 || history.valuations.length > 100_000
    || !Array.isArray(history.externalFlows) || history.externalFlows.length > 100_000 || !Array.isArray(history.fees) || history.fees.length > 100_000) throw new Error("Invalid account observation collection.");
  const { startAt, endAt } = history.request, dates = new Set<number>();
  history.valuations.forEach((point, index) => {
    fields(point, ["at", "equityBeforeFlow"]);
    if (!instant(point.at) || point.at < startAt || point.at > endAt || index > 0 && point.at <= history.valuations[index - 1]!.at
      || !amount(point.equityBeforeFlow) || point.equityBeforeFlow < 0 || index < history.valuations.length - 1 && point.equityBeforeFlow === 0) throw new Error("Valuations must be ordered, unique, nonnegative and positive before the final instant.");
    dates.add(point.at);
  });
  if (history.valuations[0]!.at !== startAt || history.valuations.at(-1)!.at !== endAt) throw new Error("Account valuations must cover both exact requested boundaries; no carry-forward or invented opening value.");
  const eventIds = new Set<string>();
  for (const [kind, events] of [["flow", history.externalFlows], ["fee", history.fees]] as const) {
    for (const event of events) {
      fields(event, ["id", "at", "amount"]);
      if (!identifier(event.id) || eventIds.has(event.id) || !instant(event.at) || event.at <= startAt || event.at > endAt
        || !amount(event.amount) || kind === "flow" && (event.amount === 0 || !dates.has(event.at)) || kind === "fee" && event.amount < 0) throw new Error("Account events require unique IDs, valid interval amounts and a valuation at every external flow.");
      eventIds.add(event.id);
    }
  }
}
