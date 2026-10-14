import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

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

const srcRoot = join(process.cwd(), "src");
const rootTests = readdirSync(srcRoot, { withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name));
if (rootTests.length) throw new Error(`Application entry tests must live under src/test/: ${rootTests.map(entry => entry.name).join(", ")}`);

for (const module of readdirSync(srcRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== "test").map(entry => entry.name)) {
  const moduleRoot = join(srcRoot, module);
  const scattered = readdirSync(moduleRoot, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name))
    .map(entry => relative(moduleRoot, join(entry.parentPath, entry.name)).replace(/\\/g, "/"))
    .filter(path => !path.startsWith("test/") && !(module === "source" && path.startsWith("tests/"))
      && !(module === "app" && /^[^/]+\/test\//.test(path)));
  if (scattered.length) throw new Error(`${module.toUpperCase()} tests must live under src/${module}/test/: ${scattered.join(", ")}`);
}

console.log("Test fence verified: all src modules use grouped tests; source/tests and app feature tests retained; manual artifact generators excluded.");
