import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import stripJsonComments from "strip-json-comments";

/** Explicit import only. Never writes to Pi's credential store or exposes raw parser errors. */
export function readPiConfigSnapshot(directory: string) {
  const texts: Array<string | null> = [];
  const values: unknown[] = [];
  for (const name of ["models.json", "auth.json", "settings.json"]) {
    let text: string;
    try { text = readFileSync(resolve(directory, name), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { texts.push(null); values.push({}); continue; }
      throw new Error(`Cannot read Pi ${name}; no settings changed.`);
    }
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error(`Pi ${name} exceeds the import size limit.`);
    try {
      const json = text.replace(/^\uFEFF/, "");
      const value: unknown = JSON.parse(name === "models.json" ? stripJsonComments(json, { trailingCommas: true }) : json);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      texts.push(text); values.push(value);
    } catch { throw new Error(`Invalid Pi ${name}; repair its JSON before importing.`); }
  }
  if (texts.every(text => text === null)) throw new Error("No Pi configuration files found in the selected directory.");
  return { models: values[0], auth: values[1], settings: values[2],
    revision: createHash("sha256").update(JSON.stringify([resolve(directory), ...texts])).digest("hex") };
}
