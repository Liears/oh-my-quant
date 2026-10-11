import { SessionImpl } from "../../src/session-runtime/index.ts";
import type { JsonlSessionMetadata, SessionStorage, SessionTreeEntry } from "../../src/session-runtime/harness/types.ts";
import type { QuantAgentDependencies } from "../../src/session-contracts.ts";

/** Independent in-memory port fixture. It never delegates to JSONL or filesystem storage. */
export function memorySessionRepo(): QuantAgentDependencies["sessions"] {
  let nextSession = 0, nextEntry = 0;
  const sessions = new Map<string, SessionStorage<JsonlSessionMetadata>>();
  return {
    async create({ cwd }) {
      const id = `memory-${++nextSession}`;
      const metadata = { id, cwd, path: `memory://${id}`, createdAt: new Date().toISOString() };
      let entries: SessionTreeEntry[] = [], leaf: string | null = null;
      const storage: SessionStorage<JsonlSessionMetadata> = {
        async getMetadata() { return structuredClone(metadata); },
        async getLeafId() { return leaf; },
        async setLeafId(targetId, signal) {
          await storage.appendEntry({ type: "leaf", id: await storage.createEntryId(), parentId: leaf, targetId, timestamp: new Date().toISOString() }, signal);
        },
        async createEntryId() { return `entry-${++nextEntry}`; },
        async appendEntry(entry, signal) { await storage.appendEntries([entry], signal); },
        async appendEntries(batch, signal) {
          signal?.throwIfAborted();
          const next = structuredClone(entries);
          let nextLeaf = leaf;
          for (const entry of structuredClone(batch)) {
            if (next.some(item => item.id === entry.id)) throw new Error("Duplicate memory entry");
            if (entry.parentId !== null && !next.some(item => item.id === entry.parentId)) throw new Error("Missing memory parent");
            if (entry.type === "leaf" && entry.targetId !== null && !next.some(item => item.id === entry.targetId)) throw new Error("Missing memory target");
            next.push(entry); nextLeaf = entry.type === "leaf" ? entry.targetId : entry.id;
          }
          signal?.throwIfAborted(); entries = next; leaf = nextLeaf;
        },
        async getEntry(entryId) { return structuredClone(entries.find(entry => entry.id === entryId)); },
        async findEntries<T extends SessionTreeEntry["type"]>(type: T) {
          return structuredClone(entries.filter((entry): entry is Extract<SessionTreeEntry, { type: T }> => entry.type === type));
        },
        async getLabel(entryId) {
          const entry = entries.findLast(item => item.type === "label" && item.targetId === entryId);
          return entry?.type === "label" ? entry.label : undefined;
        },
        async getEntries() { return structuredClone(entries); },
        async getPathToRoot(entryId) {
          const branch: SessionTreeEntry[] = [], visited = new Set<string>();
          while (entryId !== null) {
            if (visited.has(entryId)) throw new Error("Cyclic memory branch");
            visited.add(entryId);
            const entry = entries.find(item => item.id === entryId);
            if (!entry) throw new Error("Missing memory branch entry");
            branch.unshift(entry); entryId = entry.parentId;
          }
          return structuredClone(branch);
        },
      };
      sessions.set(id, storage);
      return new SessionImpl(storage);
    },
    async open(metadata) {
      const storage = sessions.get(metadata.id);
      if (!storage) throw new Error("Missing memory session");
      return new SessionImpl(storage);
    },
    async list(options = {}) {
      return (await Promise.all([...sessions.values()].map(storage => storage.getMetadata()))).filter(metadata => !options.cwd || metadata.cwd === options.cwd);
    },
  };
}
