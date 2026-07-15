#!/usr/bin/env node
/**
 * WhyJ Quant — Interactive AI-powered quantitative analysis terminal.
 *
 *   bun run src/index.ts                Interactive REPL
 *   bun run src/index.ts -- -c "/help"   One-shot command
 */
import { migrateOldConfig, loadSettings } from "./storage/index.ts";
import { parseCommand, executeCommand } from "./cli/registry.ts";
import { COMMAND_CATALOG } from "./cli/catalog.ts";
import { buildDoctorErrorResult, collectDoctor, formatDoctorFirstSetupText, formatDoctorProgressLine, formatDoctorText } from "./cli/doctor.ts";
import { printBanner } from "./tui/src/banner.ts";

interface CliEnvelope {
  ok: boolean;
  command: string;
  message?: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

// 1. Migrate old config, then load settings
migrateOldConfig();
const settings = loadSettings();

// 2. Inject API keys from settings into process.env for data adapters and tools.
for (const [key, value] of Object.entries(settings.env)) {
  if (value && !process.env[key]) process.env[key] = value;
}

// 3. One-shot or interactive
const args = process.argv.slice(2);
const idxC = args.indexOf("-c");
const idxCmd = args.indexOf("--command");
const json = args.includes("--json");
const cmdArg = idxC >= 0 ? args[idxC + 1] : idxCmd >= 0 ? args[idxCmd + 1] : null;
const doctorPhase = stringFlag(args, "--phase");
const positional = args.filter((arg, index) => {
  if (arg === "--json" || arg === "-c" || arg === "--command" || arg === "--phase") return false;
  if ((args[index - 1] === "-c" || args[index - 1] === "--command")) return false;
  if (args[index - 1] === "--phase") return false;
  return !arg.startsWith("--");
});

if (args.includes("--help") || args.includes("-h")) {
  writeHelp(json);
  process.exit(0);
} else if (positional[0] === "doctor") {
  try {
    const doctor = await collectDoctor(settings, process.env, json
      ? { phases: parseDoctorPhases(doctorPhase) }
      : { phases: parseDoctorPhases(doctorPhase), onState: (state) => console.log(formatDoctorProgressLine(state)) });
    if (json) writeJson({ ok: true, command: "doctor", data: doctor });
    else console.log(`\n${doctor.mode === "first_setup" && doctor.overall === "unconfigured" ? formatDoctorFirstSetupText(doctor) : formatDoctorText(doctor)}`);
    process.exit(doctor.ready ? 0 : 1);
  } catch (error) {
    const doctor = buildDoctorErrorResult(settings, process.env, error, parseDoctorPhases(doctorPhase));
    if (json) writeJson({ ok: false, command: "doctor", data: doctor, error: { code: "doctor_failed", message: doctor.phases.find((phase) => phase.status === "fail")?.error || "Doctor failed" } });
    else console.log(`\n${formatDoctorText(doctor)}`);
    process.exit(1);
  }
} else if (cmdArg) {
  // Fix MSYS2 path mangling: "/config" → "C:/.../git/.../config"
  const fixed = cmdArg.replace(/^[A-Z]:\/[^ ]+\/(\w+)/, "/$1");
  await runOneShot(fixed, json);
} else {
  // Frame-buffer TUI
  const { startApp } = await import("./app.ts");
  await startApp();
}

function parseDoctorPhases(value: string | undefined): ("model" | "tools" | "data")[] | undefined {
  if (!value) return undefined;
  const phases = value
    .split(/[,\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is "model" | "tools" | "data" => part === "model" || part === "tools" || part === "data");
  return phases.length > 0 ? phases : undefined;
}

function stringFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function runOneShot(input: string, json: boolean) {
  const parsed = parseCommand(input);
  if (!parsed) {
    writeFailure("not_slash_command", `Not a slash command: ${input}`, json, "command");
    process.exit(1);
  }
  const result = await executeCommand(parsed);
  if (json) {
    const envelope: CliEnvelope = result.success
      ? { ok: true, command: parsed.command, message: result.message, data: result.data }
      : { ok: false, command: parsed.command, error: { code: "command_failed", message: result.message } };
    writeJson(envelope);
  } else if (result.success) {
    console.log(result.message);
  } else {
    console.error(`✗ ${result.message}`);
  }
  process.exit(result.success ? 0 : 1);
}

function writeHelp(json: boolean) {
  const slashCommands = COMMAND_CATALOG.map((command) => command.name);
  const help = {
    name: "whyj",
    description: "WhyJ Quant interactive AI-powered quantitative analysis terminal",
    commands: [
      { command: "whyj", description: "Start the interactive frame-buffer TUI" },
      { command: "whyj --json doctor", description: "Check config, auth sources, and runtime readiness" },
      { command: "whyj -c \"/help\"", description: "Run one slash command and exit" },
      { command: "whyj --json -c \"/portfolio\"", description: "Run one slash command and emit a stable JSON envelope" },
    ],
    slashCommands,
    slashCommandDetails: COMMAND_CATALOG,
  };
  if (json) writeJson({ ok: true, command: "help", data: help });
  else console.log([
    "WhyJ Quant CLI",
    "",
    "Usage:",
    "  whyj",
    "  whyj --json doctor",
    "  whyj -c \"/help\"",
    "  whyj --json -c \"/portfolio\"",
    "",
    "Slash commands:",
    ...help.slashCommandDetails.map((command) => `  ${command.name.padEnd(12)} ${command.desc}`),
  ].join("\n"));
}

function writeFailure(code: string, message: string, json: boolean, command: string) {
  if (json) writeJson({ ok: false, command, error: { code, message } });
  else console.error(`✗ ${message}`);
}

function writeJson(value: CliEnvelope) {
  console.log(JSON.stringify(value, null, 2));
}
