import { readFileSync } from "node:fs";
import { join } from "node:path";

const configPath = join(process.cwd(), "bunfig.toml");
const config = readFileSync(configPath, "utf-8");
const required = [
  "[test]",
  'root = "src"',
  '"**/gen-*.test.ts"',
];

const missing = required.filter((entry) => !config.includes(entry));
if (missing.length > 0) {
  throw new Error(`Test fence is incomplete in bunfig.toml: ${missing.join(", ")}`);
}

console.log("Test fence verified: project tests only; manual artifact generators excluded.");
