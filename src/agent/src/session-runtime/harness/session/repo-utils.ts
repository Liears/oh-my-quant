import {
	type FileError,
	type Result,
	SessionError,
	type SessionMetadata,
	type SessionStorage,
	type SessionTreeEntry,
} from "../types.ts";
import { Session } from "./session.ts";
import { uuidv7 } from "./uuid.ts";

export function createSessionId(): string {
	return uuidv7();
}

export function createTimestamp(): string {
	return new Date().toISOString();
}

export function toSession<TMetadata extends SessionMetadata>(storage: SessionStorage<TMetadata>): Session<TMetadata> {
	return new Session(storage);
}

export function getFileSystemResultOrThrow<TValue>(result: Result<TValue, FileError>, message: string): TValue {
	if (!result.ok) {
		const code = result.error.code === "not_found" ? "not_found" : "storage";
		throw new SessionError(code, `${message}: ${result.error.message}`, result.error);
	}
	return result.value;
}

export async function getEntriesToFork(
	storage: SessionStorage,
	options: { entryId?: string; position?: "before" | "at" },
): Promise<SessionTreeEntry[]> {
	if (!options.entryId) return storage.getEntries();
	const target = await storage.getEntry(options.entryId);
	if (!target) {
		throw new SessionError("invalid_fork_target", `Entry ${options.entryId} not found`);
	}
	let effectiveLeafId: string | null;
	if ((options.position ?? "before") === "at") {
		effectiveLeafId = target.id;
	} else {
		if (target.type !== "message" || target.message.role !== "user") {
			throw new SessionError("invalid_fork_target", `Entry ${options.entryId} is not a user message`);
		}
		effectiveLeafId = target.parentId;
	}
	const entries = await storage.getEntries();
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	const required = new Set<string>();
	const pending = effectiveLeafId === null ? [] : [effectiveLeafId];
	while (pending.length) {
		const id = pending.pop()!;
		if (required.has(id)) continue;
		const entry = byId.get(id);
		if (!entry) throw new SessionError("invalid_fork_target", `Referenced entry ${id} not found`);
		required.add(id);
		if (entry.parentId !== null) pending.push(entry.parentId);
		if ((entry.type === "label" || entry.type === "leaf") && entry.targetId !== null) pending.push(entry.targetId);
	}
	// Keep referenced annotations and their ancestors in transcript order. The selected
	// leaf stays last; unrelated branches remain outside its model-visible parent chain.
	return entries.filter(entry => required.has(entry.id));
}
