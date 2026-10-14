import { describe, expect, it } from "bun:test";
import {
  orderCandidates,
  parseSourcePriority,
  runAllSources,
  runFirstSource,
  type SourceCandidate,
} from "../../shared/source-runner.ts";

function candidate<T>(id: string, value: T | Error, isHit: (value: T) => boolean): SourceCandidate<T> {
  return {
    id,
    provider: id,
    endpoint: `${id}_endpoint`,
    fetch: async () => {
      if (value instanceof Error) throw value;
      return value;
    },
    isHit,
  };
}

describe("source priority runner", () => {
  it("records the actual resolved endpoint and row count without mutating the candidate", async () => {
    const actual = { ...candidate("fund", [1, 2], rows => rows.length > 0), endpointFor: () => "literal_nav" };
    const first = await runFirstSource("270042", undefined, [actual]);
    const all = await runAllSources("270042", undefined, [actual]);
    expect(first.candidate?.endpoint).toBe("literal_nav");
    expect(first.attempts[0]).toMatchObject({ endpoint: "literal_nav", rows: 2 });
    expect(all.values[0]?.candidate.endpoint).toBe("literal_nav");
    expect(all.attempts[0]).toMatchObject({ endpoint: "literal_nav", rows: 2 });
    expect(actual.endpoint).toBe("fund_endpoint");
  });
  it("normalizes Chinese and comma-separated source priority tokens", () => {
    expect(parseSourcePriority("雪球, 东方财富 > fund_fee_em 同花顺")).toEqual(["xq", "eastmoney", "fund_fee_em", "ths"]);
  });

  it("orders candidates by id, provider, or endpoint while preserving the rest", () => {
    const candidates = [
      candidate("eastmoney", {}, () => true),
      candidate("xq", {}, () => true),
      { ...candidate("ths", {}, () => true), endpoint: "fund_info_ths" },
    ];

    expect(orderCandidates(candidates, "fund_info_ths,雪球").map((item) => item.id)).toEqual(["ths", "xq", "eastmoney"]);
  });

  it("returns the first hit and records empty/error attempts", async () => {
    const result = await runFirstSource("270042", undefined, [
      candidate<Array<{ code: string }>>("empty", [], (rows) => rows.length > 0),
      candidate<Array<{ code: string }>>("bad", new Error("network failed"), () => true),
      candidate<Array<{ code: string }>>("ok", [{ code: "270042" }], (rows) => rows.length > 0),
    ]);

    expect(result.candidate?.id).toBe("ok");
    expect(result.value).toEqual([{ code: "270042" }]);
    expect(result.attempts).toEqual([
      { id: "empty", provider: "empty", endpoint: "empty_endpoint", status: "empty", rows: 0 },
      { id: "bad", provider: "bad", endpoint: "bad_endpoint", status: "error", error: "network failed" },
      { id: "ok", provider: "ok", endpoint: "ok_endpoint", status: "ok", rows: 1 },
    ]);
  });

  it("collects all successful hits", async () => {
    const result = await runAllSources("270042", "second", [
      candidate<Record<string, unknown>>("first", { ok: "first" }, (row) => Object.keys(row).length > 0),
      candidate<Record<string, unknown>>("second", { ok: true }, (row) => Object.keys(row).length > 0),
      candidate<Record<string, unknown>>("empty", {}, (row) => Object.keys(row).length > 0),
    ]);

    expect(result.values.map((entry) => entry.candidate.id)).toEqual(["second", "first"]);
    expect(result.attempts.map((attempt) => `${attempt.id}:${attempt.status}:${attempt.rows ?? "-"}`)).toEqual([
      "second:ok:1",
      "first:ok:1",
      "empty:empty:0",
    ]);
  });
});
