import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { artifactReference, loadArtifact, loadSettings, saveArtifact, saveBars, saveSettings } from "../../storage/index.ts";
import { computeFactorTool, checkRiskTool, runBacktestTool, scoreBenchmarkTool } from "../../tools/quant-tools.ts";
import { buildResearchReport } from "../../research/input.ts";
import { loadReportSession } from "../src/report-input.ts";
import { generateArtifact } from "../src/generator.ts";
import { renderShareReport } from "../src/research-renderer.ts";
import type { Bar } from "../../types/data.ts";
import type { RawEntry } from "../src/types.ts";

let root: string;
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "ohq-report-share-"));
  process.env.OHQUANT_DIR = root;
  const settings = loadSettings();
  settings.preferences.source = "financial-datasets";
  saveSettings(settings);
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected report share fixture");
  rmSync(root, { recursive: true, force: true });
});

const PRIVATE = "PRIVATE_SENTINEL_6d4e8a";
function bars(offset = 0, from?: Date, count = 400): Bar[] {
  const first = from ?? new Date();
  if (!from) first.setUTCDate(first.getUTCDate() - count);
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + offset + i * 0.12 + Math.sin(i / 5) * 4;
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + i);
    return { date: date.toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 100 + i, amount: 1000 };
  });
}

function transcript(messages: Array<Record<string, unknown>>): { path: string; entries: RawEntry[] } {
  const path = join(root, "private-research.jsonl");
  const entries = messages.map((message, i) => ({ type: "message", id: `entry-${i}`, parentId: i === 0 ? null : `entry-${i - 1}`, timestamp: "2026-06-30T00:00:00.000Z", message })) as RawEntry[];
  writeFileSync(path, [JSON.stringify({ type: "session", version: 3, id: PRIVATE, cwd: root, timestamp: "2026-06-30T00:00:00.000Z" }), ...entries.map(entry => JSON.stringify(entry))].join("\n") + "\n");
  return { path, entries };
}

function paired(name: string, args: Record<string, unknown>, result: { content: unknown; details?: unknown }, id = "call-1"): Array<Record<string, unknown>> {
  return [
    { role: "user", content: `My private holdings: 9876543.21; ${PRIVATE}; C:\\Users\\private\\account.json`, timestamp: 1 },
    { role: "assistant", model: "private-model", provider: "private-provider", content: [{ type: "thinking", thinking: PRIVATE }, { type: "toolCall", id, name, arguments: { ...args, api_key: PRIVATE } }], timestamp: 2 },
    { role: "toolResult", toolName: name, toolCallId: id, content: result.content, details: { ...(result.details as object), private: PRIVATE, authorization: PRIVATE }, timestamp: 3 },
    { role: "assistant", content: [{ type: "text", text: `CAGR 999.99%\n\nPrivate recommendation ${PRIVATE}` }], timestamp: 4 },
  ];
}

function sharedHtml(html: string): string {
  const value = html.match(/<script type="application\/json" id="share-document">([\s\S]*?)<\/script>/)?.[1];
  if (!value) throw new Error("Missing public copy");
  return JSON.parse(value) as string;
}

it("binds real factor, risk, backtest and benchmark tool results to their archived inputs", async () => {
  await saveBars("AAPL", "financial-datasets", bars());
  await saveBars("MSFT", "financial-datasets", bars(20));
  const factorArgs = { symbol: "AAPL", factor: "momentum" as const, period: 20 };
  const riskArgs = { symbol: "AAPL" };
  const backtestArgs = { symbol: "AAPL", fast: 2, slow: 5, cash: 9876543.21 };
  const benchmarkArgs = { ...backtestArgs, benchmark_symbol: "MSFT", label: PRIVATE };
  const cases = [
    { tool: computeFactorTool, args: factorArgs, result: await computeFactorTool.execute("call-1", factorArgs), kind: "factor" },
    { tool: checkRiskTool, args: riskArgs, result: await checkRiskTool.execute("call-1", riskArgs), kind: "risk" },
    { tool: runBacktestTool, args: backtestArgs, result: await runBacktestTool.execute("call-1", backtestArgs), kind: "backtest" },
    { tool: scoreBenchmarkTool, args: benchmarkArgs, result: await scoreBenchmarkTool.execute("call-1", benchmarkArgs), kind: "benchmark" },
  ] as const;
  for (const { tool, args, kind, result } of cases) {
    const { path } = transcript(paired(tool.name, args, result));
    const research = buildResearchReport(loadReportSession(path)!);
    expect(research.analyses.map(analysis => analysis.kind)).toEqual([kind]);
    expect(research.exclusions).toEqual({ unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 });
    if (kind === "backtest" || kind === "benchmark") expect(research.analyses[0]!.curve!.values[0]).toBe(1);
    const generated = generateArtifact({ sessionPath: path, title: PRIVATE })!;
    expect(generated.html).toContain(PRIVATE);
    const shared = sharedHtml(generated.html);
    expect(shared).toContain("RECOMPUTED · MATCHED SAVED RESULT");
    expect(shared).not.toContain(PRIVATE);
    expect(shared).not.toContain("9876543.21");
    expect(shared).not.toContain(root);
    expect(shared).not.toContain("999.99%");
    expect(shared).not.toMatch(/<script|<iframe|\son\w+=|src=|url\(/i);
    expect(shared).toContain("default-src 'none'");
  }
});

it("rejects ambiguous duplicate tool calls and duplicate results before binding any metrics", async () => {
  await saveBars("AAPL", "financial-datasets", bars());
  const args = { symbol: "AAPL", fast: 2, slow: 5 };
  const result = await runBacktestTool.execute("call-1", args);
  for (const duplicate of ["call", "result"] as const) {
    const messages = paired(runBacktestTool.name, args, result);
    messages.push(structuredClone(messages[duplicate === "call" ? 1 : 2]!));
    const { path } = transcript(messages);
    const report = buildResearchReport(loadReportSession(path)!);
    expect(report.analyses).toEqual([]);
    expect(report.exclusions.unverifiedResults).toBeGreaterThan(0);
  }
});

it("renders a manually checkable unit curve and calendar CAGR for an explicit research window", async () => {
  const input = bars(0, new Date(Date.UTC(2026, 0, 1)), 14).map((bar, i) => ({ ...bar, open: 100 + i, high: 100 + i, low: 100 + i, close: 100 + i }));
  await saveBars("AAPL", "financial-datasets", input);
  const args = { symbol: "AAPL", fast: 1, slow: 2, cash: 9876543.21, commission: 0, start: "2026-01-01", end: "2026-01-14" };
  const result = await runBacktestTool.execute("call-1", args);
  const { path } = transcript(paired(runBacktestTool.name, args, result));
  const report = buildResearchReport(loadReportSession(path)!);
  expect(report.exclusions).toEqual({ unavailableInputs: 0, unverifiedResults: 0, unsupportedResults: 0 });
  const analysis = report.analyses[0]!;
  // SMA(1,2) first turns on at 101, buys next close 102, holds to 113.
  expect(analysis.curve!.values.slice(0, 3)).toEqual([1, 1, 1]);
  expect(analysis.curve!.values.at(-1)).toBeCloseTo(113 / 102, 12);
  expect(analysis.metrics.find(item => item.label === "Total return")!.value).toBeCloseTo(113 / 102 - 1, 12);
  expect(analysis.metrics.find(item => item.label === "CAGR")!.value).toBeCloseTo((113 / 102) ** (365.25 / 13) - 1, 10);
  const shared = renderShareReport(report)!;
  expect(shared).toContain("+10.78%");
  expect(shared).not.toContain("9876543.21");
});

it("omits altered saved results, mismatched calls and unarchived calculations", async () => {
  await saveBars("AAPL", "financial-datasets", bars());
  const args = { symbol: "AAPL", fast: 2, slow: 5 };
  const result = await runBacktestTool.execute("call-1", args);
  for (const change of ["metric", "ledger", "parameters", "identity", "missing-call", "start", "end", "saved-symbol", "saved-source", "saved-start"] as const) {
    const messages = paired(runBacktestTool.name, args, structuredClone(result));
    const details = messages[2]!.details as Record<string, unknown>;
    if (change === "metric") details.cagr = 10;
    if (change === "ledger") (details.ledger as { equity: number[] }).equity[10] = 999;
    if (change === "parameters") ((messages[1]!.content as Array<{ arguments: Record<string, unknown> }>)[1]!).arguments.fast = 3;
    if (change === "identity") ((messages[1]!.content as Array<{ arguments: Record<string, unknown> }>)[1]!).arguments.symbol = "MSFT";
    if (change === "missing-call") messages[2]!.toolCallId = "unknown";
    if (change === "start" || change === "end") ((messages[1]!.content as Array<{ arguments: Record<string, unknown> }>)[1]!).arguments[change] = "2026-03-01";
    if (change === "saved-symbol") details.symbol = "MSFT";
    if (change === "saved-source") details.source = "tushare";
    if (change === "saved-start") details.start = "2026-03-01";
    const { path } = transcript(messages);
    const research = buildResearchReport(loadReportSession(path)!);
    expect(research.analyses).toHaveLength(0);
    expect(research.exclusions.unverifiedResults).toBe(1);
    expect(renderShareReport(research)).not.toContain("RECOMPUTED · MATCHED SAVED RESULT");
  }
  const { path } = transcript(paired("fund_dca_backtest", { symbol: "000001" }, { content: [], details: { dcaSummary: { profit: 999999 } } }));
  const report = buildResearchReport(loadReportSession(path)!);
  expect(report.exclusions.unsupportedResults).toBe(1);
  expect(renderShareReport(report)).toBeUndefined();
});

it("keeps the saved public copy stable across corrections, session edits and archive removal", async () => {
  const original = await saveBars("AAPL", "financial-datasets", bars());
  const args = { symbol: "AAPL", fast: 2, slow: 5 };
  const result = await runBacktestTool.execute("call-1", args);
  const { path } = transcript(paired(runBacktestTool.name, args, result));
  const generated = generateArtifact({ sessionPath: path })!;
  const publicCopy = sharedHtml(generated.html);
  const saved = saveArtifact(generated.sessionId, generated.html, { title: generated.title, messageCount: generated.messageCount, provenance: generated.provenance });
  await saveBars("AAPL", "financial-datasets", bars(1000));
  expect(sharedHtml(generateArtifact({ sessionPath: path })!.html)).toBe(publicCopy);
  rmSync(join(root, "data", "financial-datasets", "AAPL", "revisions", `${original!.revision}.json`));
  const unavailable = generateArtifact({ sessionPath: path })!;
  expect(unavailable.html).not.toContain('id="share-document"');
  writeFileSync(path, "broken original session");
  expect(sharedHtml(loadArtifact(artifactReference(saved))!)).toBe(publicCopy);
});

it("filters hostile metadata before it reaches HTML, including fields inside script payloads", async () => {
  const ref = (await saveBars("AAPL", "financial-datasets", bars()))!;
  for (const change of [
    { source: `financial-datasets</script>${PRIVATE}` },
    { symbol: `${PRIVATE}</script>` },
    { revision: PRIVATE },
    { snapshotAt: PRIVATE },
    { requested: { start: PRIVATE, end: null } },
  ]) {
    const { path } = transcript(paired("fetch_bars", { symbol: "AAPL" }, { content: [], details: { dataset: { ...ref, ...change } } }));
    const input = loadReportSession(path)!;
    const report = buildResearchReport(input, () => bars());
    expect(report.datasets).toEqual([]);
    expect(renderShareReport(report)).toBeUndefined();
  }
  const { path } = transcript(paired("fetch_bars", { symbol: "AAPL" }, { content: [], details: { dataset: { ...ref, secret: PRIVATE, html: "</script>" }, datasets: { [PRIVATE]: ref } } }));
  const generated = generateArtifact({ sessionPath: path })!;
  const shared = sharedHtml(generated.html);
  expect(shared).toContain("AAPL");
  expect(shared).not.toContain(PRIVATE);
  expect(shared).not.toContain("</script>");
  expect(readFileSync(path, "utf8")).toContain(PRIVATE);
});
