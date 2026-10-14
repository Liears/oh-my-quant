import { expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { recheckBreadthBundle } from "../breadth-bundle.ts";

function fixture(root: string) {
  const path = join(root, "breadth.json"), bundle = `${path}.bundle`;
  mkdirSync(bundle);
  const date = "2026-09-14", keys = ["breadth_level_trend", "ma_crossover", "cycle_position",
    "bearish_signal", "historical_percentile", "divergence"];
  const weights = [0.25, 0.2, 0.2, 0.15, 0.1, 0.1];
  const report = { metadata: { total_rows: 1, data_freshness: { latest_date: date, is_fresh: true, days_old: 2 } },
    components: Object.fromEntries(keys.map(key => [key, { score: 50, data_available: true, date }])),
    composite: { composite_score: 50, zone: "Neutral", data_quality: { available_count: 6, total_components: 6 },
      strongest_health: { component: keys[0] }, weakest_health: { component: keys[0] },
      component_scores: Object.fromEntries(keys.map((key, index) => [key,
        { score: 50, data_available: true, weight: weights[index], effective_weight: weights[index] }])) },
    trend_summary: { entries: [{ data_date: date, composite_score: 50 }] } };
  const files = { "detail.csv": `Date,Value\n${date},1\n`, "summary.csv": "Metric,Value\nA,1\n",
    "report.json": JSON.stringify(report), "report.md": `**50/100** Neutral ${date}`,
    "history.json": JSON.stringify([{ data_date: date, composite_score: 50 }]) };
  const hash = (name: keyof typeof files) => createHash("sha256").update(files[name]).digest("hex");
  for (const [name, body] of Object.entries(files)) writeFileSync(join(bundle, name), body);
  const record = { input: { detail: { archive: "breadth.json.bundle/detail.csv", sha256: hash("detail.csv"), bytes: Buffer.byteLength(files["detail.csv"]), rows: 1 },
    summary: { archive: "breadth.json.bundle/summary.csv", sha256: hash("summary.csv"), bytes: Buffer.byteLength(files["summary.csv"]), rows: 1 }, latestDate: date },
    output: { reportArchive: "breadth.json.bundle/report.json", reportSha256: hash("report.json"), markdownArchive: "breadth.json.bundle/report.md",
      markdownSha256: hash("report.md"), historyArchive: "breadth.json.bundle/history.json", historySha256: hash("history.json"), score: 50, zone: "Neutral" },
    scriptReport: report };
  writeFileSync(path, JSON.stringify(record));
  return { path, bundle, record };
}

it("rechecks preserved breadth inputs, output bytes and independent score without network", () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-breadth-bundle-test-"));
  try {
    const { path, bundle } = fixture(root);
    expect(recheckBreadthBundle(path)).toEqual({ passed: true, violations: [] });
    writeFileSync(join(bundle, "detail.csv"), readFileSync(join(bundle, "detail.csv"), "utf8").replace(",1\n", ",2\n"));
    expect(recheckBreadthBundle(path)).toMatchObject({ passed: false, violations: expect.arrayContaining(["detail-hash-or-size"]) });
  } finally {
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-breadth-bundle-test-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects archive paths that resolve outside the selected bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-breadth-bundle-test-"));
  try {
    const { path, record } = fixture(root);
    writeFileSync(join(root, "outside.csv"), "Date,Value\n2026-09-14,1\n");
    record.input.detail.archive = "outside.csv";
    writeFileSync(path, JSON.stringify(record));
    expect(() => recheckBreadthBundle(path)).toThrow("leaves the verification bundle");
  } finally {
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-breadth-bundle-test-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
