import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveSkillsDir } from "./dirs.ts";
import { withFileLock } from "./atomic-file.ts";
import { invalidStorageFile, readDurableJson, writeDurableJson } from "./durable-json.ts";

/** Missing entries preserve existing installations; an empty array explicitly loads none. */
export function readSkillSelection(root = resolveSkillsDir()): Record<string, string[]> {
  const path = join(root, ".selection.json");
  const { value } = readDurableJson(path);
  if (value && Object.values(value).some(names => !Array.isArray(names) || names.some(name => typeof name !== "string"))) {
    throw invalidStorageFile(path);
  }
  return (value ?? {}) as Record<string, string[]>;
}

export function updateSkillSelection(update: (selection: Record<string, string[]>) => void, root = resolveSkillsDir()): void {
  mkdirSync(root, { recursive: true });
  const path = join(root, ".selection.json");
  withFileLock(path, () => {
    const selection = readSkillSelection(root);
    update(selection);
    writeDurableJson(path, selection);
  });
}
