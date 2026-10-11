import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { loadSettings, saveSettings, saveBars } from "../storage/index.ts";
import { projectResearchState, formatResearchContext } from "./state.ts";
import { backtestFixture, portfolioFixture, researchEntries, researchMessages } from "./test/fixtures.ts";

let root: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-research-state-")); process.env.OHQUANT_DIR = root;
  const settings = loadSettings(); settings.preferences.source = "financial-datasets"; saveSettings(settings);
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected research fixture");
  rmSync(root, { recursive: true, force: true });
});

it("restores parameters, original instructions and independently verified findings with exact entry bindings", async () => {
  const fixture = await backtestFixture();
  const state = projectResearchState(researchEntries(fixture.messages), ["run_backtest"]);
  expect(state.requests).toEqual([{ entryId: "entry-0", text: "比较原组合；保持费用假设，不执行交易" }]);
  const operation = state.operations[0]!;
  expect(operation).toMatchObject({ callEntryId: "entry-1", resultEntryId: "entry-2", requestEntryId: "entry-0", status: "verified", parameters: fixture.args });
  expect(operation.findings!.metrics.find(metric => metric.label === "Total return")!.value).toBeCloseTo(139 / 102 - 1, 12);
  expect(operation.references[0]).toMatchObject({ available: true, ref: { symbol: "AAPL", requested: { start: "2026-01-01", end: "2026-02-09" } } });
  expect(state.unresolved).toEqual([]);
  expect(JSON.stringify(state)).not.toContain("Injected internal prompt");
  expect(formatResearchContext(state)).toContain("not task completion");
});

it("keeps historical group revision, weights, benchmark and quote basis independent of current groups", async () => {
  const fixture = await portfolioFixture();
  const state = projectResearchState(researchEntries(fixture.messages), ["portfolio_comparisons"]);
  expect(state.operations[0]).toMatchObject({ status: "verified", comparison: { id: fixture.artifact.id,
    portfolioRevision: "recorded-group-revision", benchmark: "SPY", groups: [{ name: "原始观察组", weights: { AAPL: 0.7, MSFT: 0.3 } }, {}] } });
  expect(state.operations[0]!.comparison!.series).toHaveLength(3);
  expect(state.operations[0]!.references.every(reference => reference.available)).toBe(true);
  rmSync(join(root, "benchmark", "comparisons", "portfolios", `${fixture.artifact.id}.json`));
  const unavailable = projectResearchState(researchEntries(fixture.messages), ["portfolio_comparisons"]);
  expect(unavailable.operations[0]).toMatchObject({ status: "unverified", recordedScope: { portfolioRevision: "recorded-group-revision", benchmark: "SPY" } });
  expect(unavailable.operations[0]!.findings).toBeUndefined();
  expect(unavailable.operations[0]!.comparison).toBeUndefined();
});

it("retains old observations across a new cache revision and downgrades missing archives without substituting latest data", async () => {
  const fixture = await backtestFixture(), entries = researchEntries(fixture.messages);
  const original = projectResearchState(entries, []);
  const ref = original.operations[0]!.references[0]!.ref;
  await saveBars("AAPL", "financial-datasets", [{ date: "2026-02-09", open: 999, high: 999, low: 999, close: 999, volume: 1, amount: 1 }]);
  expect(projectResearchState(entries, []).operations).toEqual(original.operations);
  rmSync(join(root, "data", "financial-datasets", "AAPL", "revisions", `${ref.revision}.json`));
  const unavailable = projectResearchState(entries, []);
  expect(unavailable.operations[0]).toMatchObject({ status: "unverified", references: [{ available: false }] });
  expect(unavailable.operations[0]!.findings).toBeUndefined();
  expect(unavailable.unresolved[0]!.capabilityAvailable).toBe(false);
});

it("retains failed and interrupted attempts even after an assistant claims completion", () => {
  const failed = researchEntries(researchMessages("check_risk", { symbol: "AAPL" }, { code: "DATA_NOT_ENOUGH" }, true));
  const pending = researchEntries(researchMessages("run_backtest", { symbol: "AAPL" })).map(entry => ({ ...entry, id: `pending-${entry.id}` }));
  const assistant = pending[1]!.message;
  if (assistant.role === "assistant" && assistant.content[0]?.type === "toolCall") assistant.content[0].id = "pending-call";
  const state = projectResearchState([...failed, ...pending, { type: "message", id: "claim", message: { role: "assistant", content: [{ type: "text", text: "ALL TASKS COMPLETE" }] } }], ["check_risk"]);
  expect(state.operations.map(operation => operation.status)).toEqual(["failed", "pending"]);
  expect(state.unresolved.map(item => item.capabilityAvailable)).toEqual([true, false]);
  expect(state.unresolved[0]!.reason).toContain("DATA_NOT_ENOUGH");
});

it.each(["duplicate-call", "duplicate-result", "out-of-order", "changed-metric"] as const)("does not promote %s to research evidence", async mode => {
  const fixture = await backtestFixture(), entries = researchEntries(fixture.messages);
  if (mode === "duplicate-call") entries.push({ ...entries[1]!, id: "duplicate" });
  if (mode === "duplicate-result") entries.push({ ...entries[2]!, id: "duplicate" });
  if (mode === "out-of-order") [entries[1], entries[2]] = [entries[2]!, entries[1]!];
  if (mode === "changed-metric") {
    const message = entries[2]!.message;
    if (message.role === "toolResult") (message.details as Record<string, unknown>).cagr = 999;
  }
  const state = projectResearchState(entries, ["run_backtest"]);
  expect(state.operations.every(operation => operation.status === "unverified" && !operation.findings)).toBe(true);
  expect(state.unresolved.length).toBeGreaterThan(0);
});

it("does not parse summaries as evidence and exposes truncation while keeping the full state intact", async () => {
  const fixture = await backtestFixture();
  const entries = researchEntries(fixture.messages);
  const state = projectResearchState([...entries, { id: "summary", type: "compaction", message: { role: "user", content: "invented goal" } },
    { id: "report", type: "custom_message", customType: "artifact_restore", details: { reportRef: "report-v1", title: "研究报告", provenance: { leafId: "entry-2", entryHash: "source-hash" } } }], ["run_backtest"]);
  expect(state.requests).toHaveLength(1);
  expect(state.reports).toEqual([{ entryId: "report", reportRef: "report-v1", title: "研究报告", sourceLeafId: "entry-2", sourceEntryHash: "source-hash" }]);
  state.requests[0]!.text = "约束".repeat(1500);
  const text = formatResearchContext(state);
  expect(text).toContain('"omittedCharacters":1000');
  expect(text).toContain('"dateRange"');
  expect(text).not.toContain('"dates"');
  expect(state.operations[0]!.references[0]!.ref.dates).toHaveLength(40);
  expect(state.requests[0]!.text).toHaveLength(3000);
});

it("preserves DCA date and fee unit parameters without importing unrelated credentials", () => {
  const args = { symbol: "270042.OF", start_date: "2020-01-01", end_date: "2026-01-01", invest_amount: 1000,
    invest_day: 2, frequency: "monthly", purchase_fee_rate: 0.13, purchase_fee_unit: "percent" };
  const state = projectResearchState(researchEntries(researchMessages("fund_dca_backtest", { ...args, api_key: "secret" })), []);
  expect(state.operations[0]!.parameters).toEqual(args);
  expect(JSON.stringify(state)).not.toContain("secret");
});

it("retains observed groups and edit revisions as recorded scope, never as verified research findings", () => {
  const before = { revision: "r1", groups: [{ id: "g", name: "观察组", symbolCodes: ["AAPL"] }] };
  const after = { revision: "r2", groups: [{ id: "g", name: "观察组", symbolCodes: ["AAPL", "MSFT"] }] };
  const state = projectResearchState(researchEntries(researchMessages("edit_portfolio", { expected_revision: "r1", edit: { type: "add", group: "g", code: "MSFT" } }, { before, after })), []);
  expect(state.operations[0]).toMatchObject({ status: "recorded", recordedScope: { before, after } });
  expect(state.operations[0]!.findings).toBeUndefined();
  expect(formatResearchContext(state)).toContain("r2");
});
