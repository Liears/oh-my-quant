import { parseArgs } from "node:util";
import { recheckBreadthBundle } from "../src/skill/breadth-bundle.ts";

const { values } = parseArgs({ args: process.argv.slice(2), options: { record: { type: "string" } }, allowPositionals: false });
if (!values.record) throw new Error("Pass --record PATH for an existing breadth verification record.");
const result = recheckBreadthBundle(values.record);
process.stdout.write(JSON.stringify(result) + "\n");
if (!result.passed) process.exitCode = 1;
