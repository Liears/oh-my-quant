import { parseArgs } from "node:util";
import { recheckMacroBundle } from "../macro-bundle.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { record: { type: "string" } }, allowPositionals: false });
if (!values.record) throw new Error("Pass --record PATH for a captured public macro verification record.");
const result = recheckMacroBundle(values.record);
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
if (!result.passed) process.exitCode = 1;
