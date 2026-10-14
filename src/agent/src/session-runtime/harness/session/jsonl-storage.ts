import type { SessionFilePort, SessionFileSnapshot } from "../../../../../types/session-file.ts";
import type { JsonlSessionMetadata, SessionStorage, SessionTreeEntry } from "../types.ts";
import { SessionError } from "../types.ts";
import { headerToSessionMetadata, leafIdAfterEntry, parseJsonlSession, validateEntryLinks } from "./jsonl-format.ts";
import type { SessionHeader } from "./jsonl-format.ts";
import { uuidv7 } from "./uuid.ts";

export class JsonlSessionStorage implements SessionStorage<JsonlSessionMetadata> {
	private readonly file: SessionFilePort;
	private readonly filePath: string;
	private readonly metadata: JsonlSessionMetadata;
	private snapshot: SessionFileSnapshot;
	private entries: SessionTreeEntry[];
	private byId: Map<string, SessionTreeEntry>;
	private labelsById = new Map<string, string>();
	private currentLeafId: string | null;
	private writes: Promise<void> = Promise.resolve();

	private constructor(file: SessionFilePort, filePath: string, snapshot: SessionFileSnapshot) {
		const loaded = parseJsonlSession(snapshot.text, filePath);
		this.file = file;
		this.filePath = filePath;
		this.metadata = headerToSessionMetadata(loaded.header, filePath);
		this.snapshot = snapshot;
		this.entries = loaded.entries;
		this.byId = new Map(this.entries.map(entry => [entry.id, entry]));
		this.currentLeafId = loaded.leafId;
		for (const entry of this.entries) this.updateLabel(entry);
	}

	static async open(file: SessionFilePort, filePath: string): Promise<JsonlSessionStorage> {
		return new JsonlSessionStorage(file, filePath, await file.read(filePath));
	}

	static async create(file: SessionFilePort, filePath: string, options: {
		cwd: string;
		sessionId: string;
		parentSessionPath?: string;
		entries?: SessionTreeEntry[];
	}): Promise<JsonlSessionStorage> {
		const header: SessionHeader = {
			type: "session", version: 3, id: options.sessionId, timestamp: new Date().toISOString(),
			cwd: options.cwd, parentSession: options.parentSessionPath,
		};
		const text = [header, ...(options.entries ?? [])].map(entry => JSON.stringify(entry)).join("\n") + "\n";
		const storage = new JsonlSessionStorage(file, filePath, { text, revision: "" });
		storage.snapshot.revision = await file.commit(filePath, null, text);
		return storage;
	}

	async getMetadata(): Promise<JsonlSessionMetadata> { return { ...this.metadata }; }
	async getLeafId(): Promise<string | null> { return this.currentLeafId; }
	async createEntryId(): Promise<string> { return uuidv7(); }

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const result = this.writes.then(operation);
		this.writes = result.catch(() => {});
		return result;
	}

	setLeafId(leafId: string | null, signal?: AbortSignal): Promise<void> {
		return this.enqueue(() => this.commitEntries([{
			type: "leaf", id: uuidv7(), parentId: this.currentLeafId,
			timestamp: new Date().toISOString(), targetId: leafId,
		}], signal));
	}

	appendEntry(entry: SessionTreeEntry, signal?: AbortSignal): Promise<void> {
		return this.appendEntries([entry], signal);
	}

	async appendEntries(entries: SessionTreeEntry[], signal?: AbortSignal): Promise<void> {
		// Snapshot caller-owned payloads before yielding; memory mirrors the committed JSON values.
		const copy = JSON.parse(JSON.stringify(entries)) as SessionTreeEntry[];
		return this.enqueue(() => this.commitEntries(copy, signal));
	}

	private async commitEntries(entries: SessionTreeEntry[], signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
		if (entries.length === 0) return;
		const added = new Set<string>();
		const seen = { has: (id: string) => this.byId.has(id) || added.has(id) };
		let leaf = this.currentLeafId;
		for (const [index, entry] of entries.entries()) {
			validateEntryLinks(entry, seen, this.filePath, this.entries.length + index + 2);
			if (entry.parentId !== leaf) throw new SessionError("invalid_entry", "Session leaf changed before this write. Retry from the current branch.");
			added.add(entry.id);
			leaf = leafIdAfterEntry(entry);
		}
		const separator = this.snapshot.text.endsWith("\n") ? "" : "\n";
		const text = this.snapshot.text + separator + entries.map(entry => JSON.stringify(entry)).join("\n") + "\n";
		const revision = await this.file.commit(this.filePath, this.snapshot.revision, text, signal);
		this.snapshot = { text, revision };
		for (const entry of entries) {
			this.entries.push(entry);
			this.byId.set(entry.id, entry);
			this.updateLabel(entry);
		}
		this.currentLeafId = leaf;
	}

	private updateLabel(entry: SessionTreeEntry): void {
		if (entry.type !== "label") return;
		const label = entry.label?.trim();
		if (label) this.labelsById.set(entry.targetId, label);
		else this.labelsById.delete(entry.targetId);
	}

	async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
		return structuredClone(this.byId.get(id));
	}

	async findEntries<TType extends SessionTreeEntry["type"]>(type: TType): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
		return structuredClone(this.entries.filter((entry): entry is Extract<SessionTreeEntry, { type: TType }> => entry.type === type));
	}

	async getLabel(id: string): Promise<string | undefined> { return this.labelsById.get(id); }

	async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
		if (leafId === null) return [];
		const path: SessionTreeEntry[] = [];
		let current = this.byId.get(leafId);
		if (!current) throw new SessionError("not_found", `Entry ${leafId} not found`);
		while (current) {
			path.push(current);
			current = current.parentId === null ? undefined : this.byId.get(current.parentId);
		}
		return structuredClone(path.reverse());
	}

	async getEntries(): Promise<SessionTreeEntry[]> { return structuredClone(this.entries); }
}
