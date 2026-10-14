import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseCommand, executeCommand } from "../registry.ts";
import { tokenizeSlashArguments } from "../arguments.ts";
import { commandPreflight } from "../../runtime/workspace/command-preflight.ts";
import { AppRuntime } from "../../app-runtime.ts";
import { loadPanelPortfolio } from "../../storage/index.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";

let root: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "whyj-slash-arguments-")); process.env.OHQUANT_DIR = root;
  writeFileSync(join(root, "settings.json"), "INVALID_SETTINGS_MUST_NOT_BE_READ");
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected slash fixture directory");
  rmSync(root, { recursive: true, force: true });
});

test("quoted option-looking tokens remain literal positional values or explicit flag values", () => {
  const cases: Array<[string, string[], Record<string, string | boolean>]> = [
    ['/portfolio create "--help"', ["create", "--help"], {}],
    ["/portfolio delete '-h'", ["delete", "-h"], {}],
    ['/skill run Alpha "--check"', ["run", "Alpha", "--check"], {}],
    ['/config --pi preview --model "--help" --provider "-h"', [], { pi: "preview", model: "--help", provider: "-h" }],
    ['/doctor --tool search_symbols --keyword "--market" --market A', [], { tool: "search_symbols", keyword: "--market", market: "A" }],
    ['/compact "--help"', ["--help"], {}],
  ];
  for (const [input, positional, flags] of cases) {
    const parsed = parseCommand(input)!;
    expect(parsed.positional).toEqual(positional); expect({ ...parsed.flags }).toEqual(flags);
    expect(commandPreflight(parsed)).toBeUndefined();
  }
  expect(commandPreflight(parseCommand('/clear "--help"')!)?.success).toBe(false);
});

test("literal Windows paths, leading zeros, negative numbers and ordinary apostrophes survive parsing", () => {
  const path = String.raw`C:\Users\Research Lab\.pi` + "\\";
  const parsed = parseCommand(`/config --pi list --from "${path}"`)!;
  expect(parsed.flags.from).toBe(path); expect(parsed.argumentError).toBeUndefined();
  expect(parseCommand('/doctor --tool fixture --symbol 000001 --timeout -1.5')!.flags).toMatchObject({ symbol: "000001", timeout: "-1.5" });
  expect(parseCommand('/compact don\'t change O\'Brien\'s symbols')!.positional).toEqual(["don't", "change", "O'Brien's", "symbols"]);
  expect(parseCommand('/compact "Don\'t change dates"')!.positional).toEqual(["Don't change dates"]);
  expect(tokenizeSlashArguments('"" \'\'')).toEqual({ tokens: [{ value: "", quoted: true }, { value: "", quoted: true }] });
});

test("short and long options share boundaries while quoted option values never become a second option", () => {
  expect(parseCommand('/doctor --phase -h')!.flags).toEqual({ phase: true, h: true });
  expect(commandPreflight(parseCommand('/doctor --phase -h')!)?.success).toBe(true);
  expect(parseCommand('/compact -f -2')!.flags.f).toBe("-2");
  expect(parseCommand('/doctor --tool "--tool"')!.argumentError).toBeUndefined();
  expect(parseCommand('/doctor --phase data --phase tools')!.argumentError).toContain("Duplicate option --phase");
});

const malformed = ['/"', '/""', '/portfolio create "unfinished', "/portfolio delete 'Core", '/clear --help "unfinished', '/exit "unfinished',
  '/config --pi preview --model "gpt"extra', '/doctor --tool "fetch_bars"--market US', '/portfolio create "Core""Growth"'];

test("unclosed quotes and adjoining quoted words fail before handlers and preserve malformed settings", async () => {
  const forbidden = () => { throw new Error("No command effects expected"); };
  for (const input of malformed) {
    const parsed = parseCommand(input)!;
    expect(parsed.argumentError).toMatch(/quoted argument|Missing command name/);
    const result = await executeCommand(parsed, { openConfig: forbidden, openDoctor: forbidden, openPortfolio: forbidden });
    expect(result.success).toBe(false); expect(result.effects).toBeUndefined();
  }
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_MUST_NOT_BE_READ");
});

test("actual portfolio CRUD can address names resembling help flags without triggering help", async () => {
  writeFileSync(join(root, "settings.json"), JSON.stringify(DEFAULT_SETTINGS));
  for (const input of ['/portfolio create "--help"', '/portfolio add "--help" AAPL "-h"']) {
    expect((await executeCommand(parseCommand(input)!)).effects).toEqual([{ type: "portfolioChanged" }]);
  }
  const before = loadPanelPortfolio();
  expect(before.groups[0]!.name).toBe("--help"); expect(before.groups[0]!.symbolCodes).toEqual(["AAPL"]);
  expect(before.symbols.find(symbol => symbol.code === "AAPL")?.name).toBe("-h");
  expect((await executeCommand(parseCommand('/portfolio delete "--help" --help')!)).success).toBe(true);
  expect(loadPanelPortfolio()).toEqual(before);
  expect((await executeCommand(parseCommand('/portfolio delete "--help"')!)).effects).toEqual([{ type: "portfolioChanged" }]);
  expect(loadPanelPortfolio().groups).toHaveLength(0);
});

test("AppRuntime rejects malformed input in the Composer without initialization or activity changes", async () => {
  const effects: string[] = [], statuses: string[] = [];
  const runtime = new AppRuntime({ onMessages: () => effects.push("messages"), onActivity: () => effects.push("activity"),
    onDoctorRequest: () => effects.push("doctor"), onPanel: () => effects.push("market"),
    onComposerStatus: status => { if (status) statuses.push(status.text); },
  }, async () => { throw new Error("No market data"); }, async () => { throw new Error("No quotes"); }, () => { throw new Error("No model"); });
  try {
    for (const input of malformed) expect(await runtime.submit(input)).toBe("continue");
    expect(effects).toEqual([]); expect(statuses).toHaveLength(malformed.length);
  } finally { await runtime.shutdown(); }
});

test.each(['/portfolio create "unfinished', '/clear --help "unfinished', '/config --pi preview --model "gpt"extra'])("one-shot rejects lexical errors before settings: %s", async input => {
  const child = Bun.spawn([process.execPath, "src/index.ts", "--json", "-c", input], { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => child.kill(), 10000);
  try {
    const [out, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit).toBe(1); expect(error).toBe("");
    expect(JSON.parse(out)).toMatchObject({ ok: false, error: { code: "command_failed" } });
    expect(readFileSync(join(root, "settings.json"), "utf8")).toBe("INVALID_SETTINGS_MUST_NOT_BE_READ");
  } finally { clearTimeout(deadline); child.kill(); await child.exited; }
}, 15000);
