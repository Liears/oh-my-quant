import { expect, it } from "bun:test";
import type { PriceAdjustment } from "../../types/data.ts";
import type { ResearchOperation, ResearchState } from "../../research/state.ts";
import { auditCurrentNewsAnswer } from "../evidence/news-answer-evidence.ts";

function operation(request: string, id: string, adjustment: PriceAdjustment): ResearchOperation {
  const parameters = { symbol: "AAPL", market: "US", start: "2026-09-01", end: "2026-09-10" };
  const documents = [1, 2].map(index => ({ articleId: `${id}-${index}`, requestedUrl: `https://example.test/${id}/${index}`,
    status: "available", contentHash: "a".repeat(64), paragraphs: [{ id: "p1", text: "Publisher claim." }, { id: "p2", text: "Further observation." }] }));
  const citations = documents.map(document => ({ id: `N-${document.articleId}`, articleId: document.articleId,
    requestedUrl: document.requestedUrl, status: document.status, contentHash: document.contentHash, paragraphIds: ["p1", "p2"] }));
  return { callId: id, callEntryId: `call-${id}`, resultEntryId: `result-${id}`, requestEntryId: request,
    tool: "research_news", parameters, status: "unverified", reason: "Publisher claims unverified", references: [],
    recordedScope: { ...parameters, documents, citations,
      price: { status: "available", dataset: { version: 1, kind: "daily-bars", symbol: "AAPL", market: "US",
        requested: { start: parameters.start, end: parameters.end }, adjustment } } } };
}

function state(operations: ResearchOperation[]): ResearchState {
  return { version: 1, leafId: "answer", requests: [{ entryId: "current", text: "Research news" }], operations,
    reports: [], availableTools: ["research_news"], unresolved: [],
    exclusions: { unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 }, task: null, taskErrors: [] };
}

const unsupported: ReturnType<typeof auditCurrentNewsAnswer> = { status: "audited", violations: ["unsupported-news-price-adjustment"] };
const unavailable: ReturnType<typeof auditCurrentNewsAnswer> = { status: "unavailable", violations: [] };

it("binds the current request's news result, without borrowing an older known adjustment", () => {
  const research = state([operation("old", "old", "unadjusted"), operation("current", "new", "provider-unspecified")]);
  expect(auditCurrentNewsAnswer(research, "收盘价非复权价。[N-new-1/p1]")).toEqual(unsupported);
  expect(auditCurrentNewsAnswer(research, "收盘价非复权价。[N-old-1/p1]")).toEqual(unavailable);
  expect(auditCurrentNewsAnswer(research, "复权口径未知。[N-new-1/p1]")).toEqual({ status: "audited", violations: [] });
  research.operations[1]!.recordedScope!.price = { status: "available", dataset: {
    ...((research.operations[1]!.recordedScope!.price as { dataset: object }).dataset), adjustment: "unadjusted" } };
  expect(auditCurrentNewsAnswer(research, "收盘价非复权价。[N-new-1/p1]")).toEqual({ status: "audited", violations: [] });
});

it("only recovers an older scope through explicit unique snapshot citation keys", () => {
  const research = state([operation("original", "snapshot", "provider-unspecified")]);
  expect(auditCurrentNewsAnswer(research, "收盘价非复权价。[N-snapshot-1/p1] [N-snapshot-2/p2]")).toEqual(unsupported);
  expect(auditCurrentNewsAnswer(research, "收盘价非复权价。")).toEqual({ status: "not-news", violations: [] });
  expect(auditCurrentNewsAnswer(research, "收盘价非复权价。[N-unknown/p1]")).toEqual(unavailable);
  research.operations.push(structuredClone(research.operations[0]!));
  expect(auditCurrentNewsAnswer(research, "收盘价非复权价。[N-snapshot-1/p1]")).toEqual(unavailable);
  expect(auditCurrentNewsAnswer(state([]), "Price basis: unadjusted.")).toEqual({ status: "not-news", violations: [] });
});

it("does not choose one basis across different scopes, and does not mask a failed latest retry", () => {
  const first = operation("current", "first", "unadjusted"), retry = operation("current", "retry", "provider-unspecified");
  expect(auditCurrentNewsAnswer(state([first, retry]), "价格是未复权价。")).toEqual(unsupported);
  retry.status = "failed";
  expect(auditCurrentNewsAnswer(state([first, retry]), "价格是未复权价。")).toEqual(unavailable);
  retry.status = "unverified";
  retry.parameters.symbol = "MSFT";
  expect(auditCurrentNewsAnswer(state([first, retry]), "价格是未复权价。[N-first-1/p1]")).toEqual(unavailable);
});

it("rejects scope, dataset or adjustment mismatches instead of treating them as known unadjusted prices", () => {
  for (const mutate of [
    (value: ResearchOperation) => { value.recordedScope!.symbol = "MSFT"; },
    (value: ResearchOperation) => { value.recordedScope!.end = "2026-09-11"; },
    (value: ResearchOperation) => { value.resultEntryId = null; },
    (value: ResearchOperation) => { value.recordedScope!.price = { status: "invented" }; },
    (value: ResearchOperation) => { value.recordedScope!.price = { status: "available", dataset: { kind: "daily-bars", adjustment: "unadjusted" } }; },
    (value: ResearchOperation) => {
      const price = value.recordedScope!.price as { dataset: Record<string, unknown> };
      price.dataset.adjustment = "invented";
    },
    (value: ResearchOperation) => {
      const price = value.recordedScope!.price as { dataset: Record<string, unknown> };
      price.dataset.market = "HK";
    },
    (value: ResearchOperation) => {
      const price = value.recordedScope!.price as { dataset: Record<string, unknown> };
      price.dataset.requested = { start: "2026-08-01", end: "2026-09-10" };
    },
  ]) {
    const value = operation("current", "snapshot", "unadjusted");
    mutate(value);
    expect(auditCurrentNewsAnswer(state([value]), "收盘价非复权价。")).toEqual(unavailable);
  }
});

it("missing price evidence cannot support an affirmative basis and does not override explicit uncertainty", () => {
  const value = operation("current", "snapshot", "unadjusted");
  value.recordedScope!.price = { status: "unavailable", dataset: null };
  expect(auditCurrentNewsAnswer(state([value]), "We used unadjusted closes.")).toEqual(unsupported);
  expect(auditCurrentNewsAnswer(state([value]), "Do not assume unadjusted closes.")).toEqual({ status: "audited", violations: [] });
});

it("uses production news symbol normalization for US, bare A-share and four-digit HK calls", () => {
  for (const [symbol, market, normalized] of [["aapl", "US", "AAPL"], ["600519", "A", "600519.SH"], ["0700.HK", "HK", "00700.HK"]]) {
    const value = operation("current", "snapshot", "unadjusted");
    value.parameters.symbol = symbol;
    value.parameters.market = market;
    value.recordedScope!.symbol = normalized;
    value.recordedScope!.market = market;
    const price = value.recordedScope!.price as { dataset: Record<string, unknown> };
    price.dataset.symbol = normalized;
    price.dataset.market = market;
    expect(auditCurrentNewsAnswer(state([value]), "价格是未复权价。")).toEqual({ status: "audited", violations: [] });
  }
});
