import { createLocalAgent as createAgent } from "../../runtime/session.ts";
import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { generateArtifact } from "../src/generator.ts";
import { loadReportSession, verifyReportSession } from "../src/report-input.ts";
import { artifactReference, listArtifactVersions, loadArtifact, saveArtifact, saveBars } from "../../storage/index.ts";
import { generateCurrentSessionArtifact, listRestorableArtifactReports, restoreArtifactReport } from "../../runtime/research/artifact-reports.ts";
import { type QuantAgentSession } from "../../agent/src/session.ts";
import type { Bar, DatasetRef } from "../../types/data.ts";

let root: string;
let previous: string | undefined;
let agent: QuantAgentSession | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "ohq-report-recovery-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(async () => {
  agent?.abort();
  await agent?.waitForIdle();
  agent = undefined;
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected report recovery test directory");
  rmSync(root, { recursive: true, force: true });
});

const bars = (close: number): Bar[] => ["2026-01-02", "2026-01-05", "2026-01-06"].map((date, index) => ({ date, open: close + index, close: close + index, high: close + index, low: close + index, volume: 100, amount: 1000 }));
function entry(id: string, parentId: string | null, role: string, text: string, dataset?: DatasetRef) {
  return { type: "message", id, parentId, timestamp: "2026-01-07T00:00:00.000Z", message: {
    role, content: [{ type: "text", text }], timestamp: 0,
    ...(role === "assistant" ? { model: "deepseek-v4-pro", provider: "deepseek", api: "openai-completions", stopReason: "stop" } : {}),
    ...(dataset ? { toolName: "fetch_bars", toolCallId: id, details: { dataset } } : {}),
  } };
}
function session(entries: object[]): string {
  const encoded = `--${process.cwd().replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const dir = join(root, "sessions", encoded);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "research-session.jsonl");
  writeFileSync(path, [JSON.stringify({ type: "session", version: 3, id: "research-session", cwd: process.cwd(), timestamp: "2026-01-01T00:00:00.000Z" }), ...entries.map(item => JSON.stringify(item))].join("\n") + "\n");
  return path;
}

it("renders separate charts from exact archived observations after market corrections", async () => {
  const aapl = (await saveBars("AAPL", "financial-datasets", bars(100)))!;
  const msft = (await saveBars("MSFT", "financial-datasets", bars(200)))!;
  const path = session([entry("u", null, "user", "Research AAPL and MSFT"), entry("a", "u", "toolResult", "Fetched", aapl), entry("m", "a", "toolResult", "Fetched", msft)]);
  await saveBars("AAPL", "financial-datasets", bars(900));
  const report = generateArtifact({ sessionPath: path, leafId: "m" })!;
  expect(report.provenance.datasets.map(item => item.verified)).toEqual([true, true]);
  expect(report.html.match(/data-dataset-hash=/g)).toHaveLength(2);
  expect(report.html).not.toContain("NO PRICE SERIES");
  const charts = [...report.html.matchAll(/var tfData=(.*?);var bm=/g)].map(match => JSON.parse(match[1]!));
  expect(charts).toHaveLength(2);
  expect(Object.values(charts[0]!)[0]).toMatchObject({ ohlc: [[100, 100, 100, 100], [101, 101, 101, 101], [102, 102, 102, 102]] });
  expect(Object.values(charts[1]!)[0]).toMatchObject({ ohlc: [[200, 200, 200, 200], [201, 201, 201, 201], [202, 202, 202, 202]] });
});

it("shows unavailable evidence when an old dataset disappears without substituting current prices", async () => {
  const ref = (await saveBars("AAPL", "financial-datasets", bars(100)))!;
  const path = session([entry("u", null, "user", "Research"), entry("t", "u", "toolResult", "Fetched", ref)]);
  await saveBars("AAPL", "financial-datasets", bars(900));
  rmSync(join(root, "data", ref.source, ref.symbol, "revisions", `${ref.revision}.json`));
  const report = generateArtifact({ sessionPath: path, leafId: "t" })!;
  expect(report.provenance.datasets[0]!.verified).toBe(false);
  expect(report.html).toContain("Referenced data unavailable");
  expect(report.html).not.toContain("var tfData=");
});

it("selects only the requested branch and rejects truncated or cyclic report inputs", () => {
  const path = session([entry("u", null, "user", "Original question"), entry("a", "u", "assistant", "Selected answer"), entry("b", "u", "assistant", "Unrelated branch answer")]);
  const report = generateArtifact({ sessionPath: path, leafId: "a" })!;
  expect(report.html).toContain("Selected answer");
  expect(report.html).not.toContain("Unrelated branch answer");
  expect(report.provenance.entryIds).toEqual(["u", "a"]);
  expect(verifyReportSession(path, report.provenance)).toBe(true);
  appendFileSync(path, '{"type":"message"');
  expect(generateArtifact({ sessionPath: path })).toBeNull();
  expect(verifyReportSession(path, report.provenance)).toBe(false);
  session([entry("cycle", "cycle", "user", "Invalid cycle")]);
  expect(generateArtifact({ sessionPath: path, leafId: "cycle" })).toBeNull();
});

it("restores the selected report and real session branch after later research without rewriting HTML", async () => {
  const path = session([entry("u", null, "user", "Original question"), entry("a", "u", "assistant", "Original answer")]);
  agent = createAgent({ cwd: process.cwd(), sessionsRoot: join(root, "sessions") });
  await agent.resumeSession("research-session");
  const openFile = mock((_path: string) => {});
  expect((await generateCurrentSessionArtifact({ agentSession: agent, openFile })).success).toBe(true);
  const old = listArtifactVersions("research-session")[0]!;
  const oldHtml = loadArtifact(artifactReference(old));
  await agent.appendContextNote("later_research", "LATER RESEARCH ONLY");
  expect((await generateCurrentSessionArtifact({ agentSession: agent, openFile })).success).toBe(true);
  expect(listRestorableArtifactReports()).toHaveLength(2);
  const latest = listArtifactVersions("research-session")[0]!;
  expect(latest.revision).not.toBe(old.revision);
  const restored = await restoreArtifactReport(artifactReference(old), { agentSession: agent, openFile });
  expect(restored.success).toBe(true);
  expect(JSON.stringify(agent.state.messages)).toContain("Original answer");
  expect(JSON.stringify(agent.state.messages)).not.toContain("LATER RESEARCH ONLY");
  expect(loadArtifact(artifactReference(old))).toBe(oldHtml);
  expect(listArtifactVersions("research-session")[0]!.revision).toBe(latest.revision);
  expect(readFileSync(openFile.mock.calls.at(-1)![0], "utf8")).toBe(oldHtml!);
  expect(verifyReportSession(path, old.provenance!)).toBe(true);
});

it("rejects ambiguous entry ids and a report leaf that does not match its recorded branch", async () => {
  const path = session([entry("u", null, "user", "Question"), entry("a", "u", "assistant", "Original answer"), entry("b", "u", "assistant", "Other branch")]);
  const original = loadReportSession(path, "a")!.provenance;
  const changed = { ...original, leafId: "b" };
  expect(verifyReportSession(path, changed)).toBe(false);
  agent = createAgent({ cwd: process.cwd(), sessionsRoot: join(root, "sessions") });
  await agent.appendContextNote("current", "Preserve this session");
  const before = (await agent.getSessionMetadata())!.id;
  const sourceBefore = readFileSync(path, "utf8");
  await expect(agent.resumeSession("research-session", { report: changed })).rejects.toThrow("Report source");
  expect((await agent.getSessionMetadata())!.id).toBe(before);
  expect(readFileSync(path, "utf8")).toBe(sourceBefore);
  appendFileSync(path, JSON.stringify(entry("a", "u", "assistant", "Conflicting identity")) + "\n");
  expect(loadReportSession(path, "a")).toBeNull();
  expect(verifyReportSession(path, original)).toBe(false);
  session([entry("", null, "user", "Missing identity")]);
  expect(loadReportSession(path)).toBeNull();
});

it("preserves the active session when the requested report's original entries were altered", async () => {
  const path = session([entry("u", null, "user", "Original"), entry("a", "u", "assistant", "Original answer")]);
  const report = generateArtifact({ sessionPath: path, leafId: "a" })!;
  const saved = saveArtifact("research-session", report.html, { provenance: report.provenance });
  agent = createAgent({ cwd: process.cwd(), sessionsRoot: join(root, "sessions") });
  await agent.appendContextNote("current", "KEEP CURRENT SESSION");
  const before = await agent.getSessionMetadata();
  writeFileSync(path, readFileSync(path, "utf8").replace("Original answer", "Changed answer"));
  const openFile = mock(() => {});
  expect((await restoreArtifactReport(artifactReference(saved), { agentSession: agent, openFile })).success).toBe(false);
  expect((await agent.getSessionMetadata())!.id).toBe(before!.id);
  expect(JSON.stringify(agent.state.messages)).toContain("KEEP CURRENT SESSION");
  expect(openFile).not.toHaveBeenCalled();
  await expect(agent.resumeSession("research-session", { report: report.provenance })).rejects.toThrow("source entries changed");
  expect((await agent.getSessionMetadata())!.id).toBe(before!.id);
});
