import { closeSync, existsSync, fsyncSync, openSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { readAccountHistoryFile } from "./account-history.ts";
import { resolveOhquantDir } from "../storage/src/dirs.ts";
import { renderAuthorizedAnnualReport } from "../runtime/research/private-annual-reports.ts";
import { verifyAnnualResearch } from "../research/annual.ts";
import type { AnnualReportRequest } from "../types/annual-report.ts";

const REQUIRED = ["--comparison", "--year", "--cutoff", "--history-file", "--output"] as const;
const USAGE = "Use whyj private-annual --comparison ID --year YYYY --cutoff YYYY-MM-DD --history-file PATH --output NEW.html [--decision ID].";

/** Explicit terminal export; no Agent context, app report storage, provider discovery, or implicit account read. */
export async function runPrivateAnnualFileCommand(args: readonly string[], signal: AbortSignal) {
  signal.throwIfAborted();
  const values: Record<string, string> = Object.create(null);
  const decisions: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if ((!REQUIRED.includes(key as typeof REQUIRED[number]) && key !== "--decision") || !value || value.startsWith("--")) throw new Error(USAGE);
    if (key === "--decision") decisions.push(value);
    else {
      if (Object.hasOwn(values, key!)) throw new Error(USAGE);
      values[key!] = value;
    }
  }
  if (REQUIRED.some(key => !values[key])) throw new Error(USAGE);
  const year = Number(values["--year"]);
  if (!Number.isInteger(year)) throw new Error(USAGE);
  const request: AnnualReportRequest = { comparisonId: values["--comparison"]!, year, valuationCutoff: values["--cutoff"]!,
    ...(decisions.length ? { decisionIds: decisions } : {}) };

  // Fail on invalid public research before opening the explicitly selected private history.
  verifyAnnualResearch(request);

  const appRoot = canonicalAppRoot();
  const historyPath = canonicalHistoryPath(values["--history-file"]!, appRoot);
  const output = canonicalExportPath(values["--output"]!, appRoot);
  if (existsSync(output)) throw new Error("Private export already exists; choose a new output path.");
  const history = readAccountHistoryFile(historyPath);
  const adapter = { id: history.source.adapterId, accountRef: history.request.accountRef,
    async readHistory() { return structuredClone(history); } };
  const report = await renderAuthorizedAnnualReport(request, adapter, history.request, signal);
  signal.throwIfAborted();
  let file: number | undefined, committed = false;
  try {
    file = openSync(output, "wx", 0o600);
    writeFileSync(file, report.html);
    fsyncSync(file);
    committed = true;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Private export already exists; choose a new output path.");
    throw new Error("Could not write the selected private HTML output.");
  } finally {
    if (file !== undefined) {
      try { closeSync(file); } catch { committed = false; }
      if (!committed) try { unlinkSync(output); } catch { /* Best effort after a failed exclusive write. */ }
    }
  }
  return { output, visibility: "private-export" as const, verification: report.verification, accountMethod: report.accountMethod };
}

function canonicalAppRoot(): string {
  const path = resolve(resolveOhquantDir());
  return existsSync(path) ? realpathSync(path) : path;
}

function within(path: string, root: string): boolean {
  const target = path.toLowerCase(), base = root.toLowerCase();
  return target === base || target.startsWith(base + sep);
}

function canonicalHistoryPath(path: string, appRoot: string): string {
  let real: string;
  try { real = realpathSync(resolve(path)); }
  catch { throw new Error("Could not read the selected account history file."); }
  if (within(real, appRoot)) throw new Error("Private account history cannot be read from the app state directory.");
  return real;
}

function canonicalExportPath(path: string, appRoot: string): string {
  let parent: string;
  try { parent = realpathSync(dirname(resolve(path))); }
  catch { throw new Error("Private export parent directory must already exist."); }
  const output = join(parent, basename(path));
  if (within(output, appRoot)) throw new Error("Private account HTML cannot be exported into the app state directory.");
  if (!output.toLowerCase().endsWith(".html")) throw new Error("Private export path must end in .html.");
  return output;
}
