/** Minimal real Pi/WhyJ concurrent model check; artifact contains no credential or response text. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { inspectPiImport } from "../src/runtime/models/pi-config-import.ts";
import { loadSettings } from "../src/storage/index.ts";
import manifest from "../package.json";

const PROVIDER = "deepseek", MODEL = "deepseek-v4-flash", PROMPT = "Reply with only ok.";
const { values } = parseArgs({ args: process.argv.slice(2), options: { output: { type: "string" } }, allowPositionals: false });
const output = values.output ? resolve(values.output) : resolve(import.meta.dir, "../output/pi-dual-cli-live.json");
if (existsSync(output)) throw new Error("Output already exists; choose a new artifact path.");

function piNodeEntry() {
  const paths = (process.env.PATH ?? process.env.Path ?? "").split(delimiter);
  const wrapper = paths.map(path => join(path, process.platform === "win32" ? "pi.ps1" : "pi"))
    .find(path => existsSync(path));
  if (!wrapper) throw new Error("Installed Pi CLI not found in PATH.");
  const base = dirname(wrapper), entry = join(base, "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js");
  const packagePath = join(base, "node_modules", "@mariozechner", "pi-coding-agent", "package.json");
  if (!existsSync(entry) || !existsSync(packagePath)) throw new Error("Installed Pi entry is unavailable.");
  return { node: existsSync(join(base, "node.exe")) ? join(base, "node.exe") : "node",
    entry, version: (JSON.parse(readFileSync(packagePath, "utf8")) as { version: string }).version };
}
async function runNode(node: string, entry: string, args: string[], env: Record<string, string | undefined>) {
  const began = performance.now();
  const child = Bun.spawn([node, entry, ...args], { env, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr, elapsedMs: Math.round((performance.now() - began) * 1000) / 1000 };
}

const pi = piNodeEntry(), whyjEntry = resolve(import.meta.dir, "../dist/index.js");
if (!existsSync(whyjEntry)) throw new Error("Build WhyJ first: bun run build.");
const root = mkdtempSync(join(tmpdir(), "whyj-pi-dual-cli-"));
const previous = process.env.OHQUANT_DIR;
const startedAt = new Date().toISOString();
let result: Record<string, unknown> = {};
try {
  process.env.OHQUANT_DIR = root;
  const preview = inspectPiImport({ provider: PROVIDER, model: MODEL });
  if (preview.credential !== "auth.json key snapshot") throw new Error("Expected a Pi API-key snapshot.");
  const applied = inspectPiImport({ provider: PROVIDER, model: MODEL }, preview.review);
  if (!applied.applied) throw new Error("Pi connection was not applied to the isolated directory.");
  const settings = loadSettings();
  if (settings.provider !== PROVIDER || settings.model !== MODEL || !settings.providers?.[PROVIDER]?.apiKey)
    throw new Error("Imported connection is not active or lacks a key.");
  const env = { ...process.env, WHYJ_DOCTOR_SKIP_NETWORK: "0" };
  const [piRun, whyjRun] = await Promise.all([
    runNode(pi.node, pi.entry, ["--print", "--mode", "text", "--no-session", "--no-extensions", "--no-skills",
      "--no-tools", "--system-prompt", PROMPT, "--provider", PROVIDER, "--model", MODEL, PROMPT],
      { ...env, PI_CODING_AGENT_DIR: join(homedir(), ".pi", "agent"), PI_TELEMETRY: "0" }),
    runNode(pi.node, whyjEntry, ["--json", "doctor", "--phase", "model"], { ...env, OHQUANT_DIR: root }),
  ]);
  let doctor: { data?: { requestedPhases?: string[]; phases?: Array<{ phase: string; status: string; warnings?: string[] }> }; error?: { code?: string } } | undefined;
  try { doctor = JSON.parse(whyjRun.stdout) as typeof doctor; } catch { /* Only a categorical parse failure is recorded. */ }
  const modelPhase = doctor?.data?.phases?.find(phase => phase.phase === "model");
  result = { import: "pass", pi: { exitCode: piRun.code, elapsedMs: piRun.elapsedMs,
      assistantTextPresent: Boolean(piRun.stdout.trim()), replyIsOk: piRun.stdout.trim().toLowerCase() === "ok",
      stdoutBytes: Buffer.byteLength(piRun.stdout), stderrBytes: Buffer.byteLength(piRun.stderr) },
    whyj: { exitCode: whyjRun.code, elapsedMs: whyjRun.elapsedMs, jsonParsed: Boolean(doctor),
      requestedPhases: doctor?.data?.requestedPhases ?? [], modelStatus: modelPhase?.status ?? "missing",
      warnings: modelPhase?.warnings?.length ?? 0, errorCode: doctor?.error?.code ?? null,
      stdoutBytes: Buffer.byteLength(whyjRun.stdout), stderrBytes: Buffer.byteLength(whyjRun.stderr) } };
} catch (error) {
  result = { import: "fail", failureCategory: error instanceof Error ? error.name : "unknown" };
} finally {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  const absoluteRoot = resolve(root), absoluteTemp = resolve(tmpdir());
  if (!absoluteRoot.startsWith(absoluteTemp + sep)) throw new Error("Unexpected Pi dual CLI directory.");
  rmSync(absoluteRoot, { recursive: true, force: true });
}

const codeFiles = ["src/runtime/models/pi-config-import.ts", "src/agent/src/pi-config-import.ts", "src/cli/doctor.ts", "src/index.ts", "scripts/check-pi-dual-cli.ts"];
const artifact = { version: 1, checkedAt: new Date().toISOString(), startedAt, platform: process.platform,
  whyjVersion: manifest.version, bundledPiCore: manifest.dependencies["@earendil-works/pi-agent-core"],
  installedPiVersion: pi.version, provider: PROVIDER, model: MODEL,
  scope: "Isolated WhyJ Pi API-key import followed by concurrent minimal installed Pi print-mode and built WhyJ model-only Doctor requests. No tools, market data, account orders or persistent Pi session.",
  limitations: "The installed Pi CLI and bundled Pi libraries are different versions. This checks one API-key/model at one moment; no OAuth refresh, alternate provider permissions, terminal visuals or repeated availability distribution. Raw credentials, model responses and provider diagnostics are excluded.",
  codeFiles: codeFiles.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve(import.meta.dir, "..", path))).digest("hex") })), result };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ output, result }) + "\n");
const piResult = result.pi as { exitCode?: number; replyIsOk?: boolean } | undefined;
const whyjResult = result.whyj as { modelStatus?: string } | undefined;
if (result.import !== "pass" || piResult?.exitCode !== 0 || !piResult.replyIsOk || whyjResult?.modelStatus !== "pass") process.exitCode = 1;
