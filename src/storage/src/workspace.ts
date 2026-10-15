import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson, withFileLock } from "./atomic-file.ts";
import { resolveOhquantDir } from "./dirs.ts";
import type { WorkspaceRun } from "../../types/workspace.ts";

export function workspaceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function createWorkspaceStore(
  root = join(resolveOhquantDir(), "research", "workspace"),
) {
  function path(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid research ID.");
    return join(root, `${id}.json`);
  }
  function load(id: string): WorkspaceRun {
    const envelope = JSON.parse(readFileSync(path(id), "utf8")) as {
      run: WorkspaceRun;
      hash: string;
    };
    if (
      envelope.run?.version !== 1 ||
      envelope.run.id !== id ||
      envelope.run.status !== "complete" ||
      !envelope.run.saved ||
      !envelope.run.answer ||
      workspaceHash(envelope.run) !== envelope.hash
    ) {
      throw new Error("Research integrity check failed; original preserved.");
    }
    return envelope.run;
  }
  return {
    load,
    save(run: WorkspaceRun): WorkspaceRun {
      if (run.status !== "complete" || !run.answer)
        throw new Error("Only completed research can be saved.");
      mkdirSync(root, { recursive: true });
      const file = path(run.id);
      const snapshot = structuredClone({ ...run, saved: true });
      return withFileLock(file, () => {
        if (existsSync(file)) {
          const existing = load(run.id);
          if (workspaceHash(existing) !== workspaceHash(snapshot))
            throw new Error("Research version is immutable.");
          return existing;
        }
        atomicWriteJson(file, { run: snapshot, hash: workspaceHash(snapshot) });
        return snapshot;
      });
    },
    list(): WorkspaceRun[] {
      if (!existsSync(root)) return [];
      // A corrupt saved version is surfaced, never silently overwritten or hidden.
      return readdirSync(root)
        .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
        .map((name) => load(name.slice(0, -5)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}
