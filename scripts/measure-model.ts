import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readSettings } from "../src/storage/index.ts";
import { runModelBenchmark } from "../src/runtime/evaluation/model-benchmark.ts";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args: args[0] === "--" ? args.slice(1) : args, strict: true, allowPositionals: false, options: {
    help: { type: "boolean", short: "h" }, samples: { type: "string" }, warmups: { type: "string" },
    "timeout-ms": { type: "string" }, "max-tokens": { type: "string" }, thinking: { type: "string" },
    tools: { type: "string" }, output: { type: "string" },
  } });
  if (values.help) {
    console.log(`Usage: bun run bench:model -- [options]
  --samples 5           Measured requests (1-100)
  --warmups 0           Additional requests excluded from percentiles (0-10)
  --timeout-ms 30000    Deadline per request, including authentication
  --max-tokens 1024     Output cap, limited by the configured model
  --thinking LEVEL     Use the saved level unless overridden; records effective level
  --tools off          off | quant-schema (offers schemas; never executes tools)
  --output FILE        Also save the JSON report; refuses to overwrite

Uses the saved model connection. Sends real model requests and incurs provider usage.
Fresh fixed input each time; no conversation, market access or settings changes.
Ctrl+C cancels and prints completed samples. Null means unmeasured, not zero.
Exit 0: all measured requests succeeded; 1: failure; 130: cancelled.`);
    return;
  }
  if (values.tools !== undefined && values.tools !== "off" && values.tools !== "quant-schema") throw new Error("tools must be off or quant-schema");
  if (values.output && existsSync(values.output)) throw new Error("Output file already exists; choose a new path.");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    const report = await runModelBenchmark(readSettings(), {
      samples: values.samples === undefined ? undefined : Number(values.samples),
      warmups: values.warmups === undefined ? undefined : Number(values.warmups),
      timeoutMs: values["timeout-ms"] === undefined ? undefined : Number(values["timeout-ms"]),
      maxTokens: values["max-tokens"] === undefined ? undefined : Number(values["max-tokens"]),
      thinking: values.thinking, tools: values.tools, signal: controller.signal,
    });
    const json = JSON.stringify(report, null, 2) + "\n";
    console.log(json.trimEnd());
    if (values.output) writeFileSync(values.output, json, { flag: "wx" });
    process.exitCode = report.cancelled ? 130 : report.summary.failed || report.summary.skipped || report.summary.warmupFailed ? 1 : 0;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

if (import.meta.main) {
  try { await main(); }
  catch { console.error("Model benchmark could not run. Check arguments, model configuration and output path; see --help."); process.exitCode = 1; }
}
