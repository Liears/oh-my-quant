import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "public");
const output = path.join(root, "dist");
const allowed = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "favicon.svg",
  "fonts",
]);
const files = await readdir(source);
for (const file of allowed) {
  if (!files.includes(file)) throw new Error(`Missing public asset: ${file}`);
}
for (const file of files) {
  if (!allowed.has(file)) throw new Error(`Unreviewed public asset: ${file}`);
}
if (
  path.dirname(output) !== path.resolve(root) ||
  path.basename(output) !== "dist"
) {
  throw new Error(`Unexpected output directory: ${output}`);
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files)
  await cp(path.join(source, file), path.join(output, file), {
    recursive: true,
  });
console.log(
  `Built ${files.length} public entries → site/dist. No application data included.`,
);
