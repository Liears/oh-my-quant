import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { accountHistoryFixture } from "../../performance/test/fixture.ts";
import { annualComparisonFixture } from "../../research/test/annual-fixture.ts";
import { listAnnualReports } from "../../runtime/research/annual-reports.ts";

let stateRoot: string, exportRoot: string, previous: string | undefined;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  stateRoot = mkdtempSync(join(tmpdir(), "whyj-private-annual-state-"));
  exportRoot = mkdtempSync(join(tmpdir(), "whyj-private-annual-export-"));
  process.env.OHQUANT_DIR = stateRoot;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  for (const path of [stateRoot, exportRoot]) {
    if (!resolve(path).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected private annual test directory");
    rmSync(path, { recursive: true, force: true });
  }
});

async function files() {
  const comparison = (await annualComparisonFixture()).save();
  const history = accountHistoryFixture();
  const endAt = Date.parse("2025-12-31T23:59:59.999Z");
  history.request.endAt = endAt;
  history.request.accountRef = "PRIVATE_ACCOUNT_SENTINEL_8937";
  history.valuations.at(-1)!.at = endAt;
  history.source.observedAt = endAt + 1000;
  const input = join(exportRoot, "history.json"), output = join(exportRoot, "private-annual.html");
  writeFileSync(input, JSON.stringify(history));
  return { comparison, history, input, output };
}

function run(args: string[]) {
  return Bun.spawnSync({ cmd: [process.execPath, "src/index.ts", "--json", "private-annual", ...args], cwd: process.cwd(),
    env: { ...process.env, OHQUANT_DIR: stateRoot }, stdout: "pipe", stderr: "pipe", timeout: 10_000 });
}

function args(comparisonId: string, input: string, output: string) {
  return ["--comparison", comparisonId, "--year", "2025", "--cutoff", "2025-12-31", "--history-file", input, "--output", output];
}

test("explicit CLI file history renders private annual HTML without account values in the JSON envelope or app reports", async () => {
  const { comparison, history, input, output } = await files();
  writeFileSync(join(stateRoot, "settings.json"), "{"); // Private entry must not depend on model/data settings.
  const result = run(args(comparison.id, input, output));
  expect(result.exitCode).toBe(0);
  const stdout = decode(result.stdout), envelope = JSON.parse(stdout);
  expect(envelope).toMatchObject({ ok: true, command: "private-annual", data: { output, visibility: "private-export" } });
  expect(stdout).not.toContain(history.request.accountRef);
  expect(stdout).not.toContain("openingEquity");
  const html = readFileSync(output, "utf8");
  expect(html).toContain(history.request.accountRef);
  expect(html).toContain("data-account-performance");
  expect(listAnnualReports().items).toHaveLength(0);
  expect(existsSync(join(stateRoot, "reports", "annual"))).toBe(false);
}, 15_000);

test("incomplete or wrong-interval history fails before export and keeps an existing output untouched", async () => {
  const { comparison, history, input, output } = await files();
  history.coverage.externalFlows = "incomplete";
  writeFileSync(input, JSON.stringify(history));
  const incomplete = run(args(comparison.id, input, output));
  expect(incomplete.exitCode).toBe(1);
  expect(existsSync(output)).toBe(false);
  history.coverage.externalFlows = "complete";
  history.request.endAt -= 86_400_000;
  history.valuations.at(-1)!.at = history.request.endAt;
  writeFileSync(input, JSON.stringify(history));
  const wrong = run(args(comparison.id, input, output));
  expect(wrong.exitCode).toBe(1);
  expect(existsSync(output)).toBe(false);
  history.request.endAt += 86_400_000;
  history.valuations.at(-1)!.at = history.request.endAt;
  writeFileSync(input, JSON.stringify(history));
  writeFileSync(output, "existing private report");
  const existing = run(args(comparison.id, input, output));
  expect(existing.exitCode).toBe(1);
  expect(readFileSync(output, "utf8")).toBe("existing private report");
  expect(decode(existing.stdout)).not.toContain(history.request.accountRef);
}, 35_000);

test("private history and export paths inside the app state are rejected without touching them", async () => {
  const { comparison, input, output } = await files();
  const forbiddenOutput = join(stateRoot, "private-annual.html");
  expect(run(args(comparison.id, input, forbiddenOutput)).exitCode).toBe(1);
  expect(existsSync(forbiddenOutput)).toBe(false);
  expect(run(args(comparison.id, join(stateRoot, "portfolio", "history.json"), output)).exitCode).toBe(1);
  expect(existsSync(output)).toBe(false);
}, 25_000);

test("malformed normalized history and an unrelated selected decision never create a private export", async () => {
  const { comparison, history, input, output } = await files();
  writeFileSync(input, "{" + history.request.accountRef);
  const malformed = run(args(comparison.id, input, output));
  expect(malformed.exitCode).toBe(1);
  expect(decode(malformed.stdout)).not.toContain(history.request.accountRef);
  expect(existsSync(output)).toBe(false);
  writeFileSync(input, JSON.stringify(history));
  const selected = run([...args(comparison.id, input, output), "--decision", "unrelated-decision"]);
  expect(selected.exitCode).toBe(1);
  expect(existsSync(output)).toBe(false);
}, 25_000);

test("an invalid public comparison fails before opening a selected private history file", async () => {
  const missingHistory = join(exportRoot, "missing-history.json"), output = join(exportRoot, "private-annual.html");
  const result = run(args("invalid-comparison-id", missingHistory, output));
  expect(result.exitCode).toBe(1);
  const envelope = JSON.parse(decode(result.stdout));
  expect(envelope.error.message).not.toContain("account history file");
  expect(existsSync(output)).toBe(false);
}, 15_000);
