import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../../types.ts";
import { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage } from "../messages.ts";
import type {
	ActiveToolsChangeEntry,
	BranchSummaryEntry,
	CompactionEntry,
	CustomEntry,
	CustomMessageEntry,
	LabelEntry,
	MessageEntry,
	PendingSessionWrite,
	ModelChangeEntry,
	SessionContext,
	SessionInfoEntry,
	SessionMetadata,
	SessionStorage,
	SessionTreeEntry,
	ThinkingLevelChangeEntry,
} from "../types.ts";
import { SessionError } from "../types.ts";

export function buildSessionContext(pathEntries: SessionTreeEntry[]): SessionContext {
	let thinkingLevel: string | null = null;
	let model: { provider: string; modelId: string } | null = null;
	let activeToolNames: string[] | null = null;
	let compaction: CompactionEntry | null = null;

	for (const entry of pathEntries) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		} else if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
		} else if (entry.type === "message" && entry.message.role === "assistant") {
			model = { provider: entry.message.provider, modelId: entry.message.model };
		} else if (entry.type === "active_tools_change") {
			activeToolNames = [...entry.activeToolNames];
		} else if (entry.type === "compaction") {
			compaction = entry;
		}
	}

	const messages: AgentMessage[] = [];
	const appendMessage = (entry: SessionTreeEntry) => {
		if (entry.type === "message") {
			messages.push(entry.message as AgentMessage);
		} else if (entry.type === "custom_message") {
			messages.push(
				createCustomMessage(
					entry.customType,
					entry.content as string | (TextContent | ImageContent)[],
					entry.display,
					entry.details,
					entry.timestamp,
				),
			);
		} else if (entry.type === "branch_summary" && entry.summary) {
			messages.push(createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp));
		}
	};

	if (compaction) {
		messages.push(createCompactionSummaryMessage(compaction.summary, compaction.tokensBefore, compaction.timestamp));
		const compactionIdx = pathEntries.findIndex((e) => e.type === "compaction" && e.id === compaction.id);
		let foundFirstKept = false;
		for (let i = 0; i < compactionIdx; i++) {
			const entry = pathEntries[i]!;
			if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
			if (foundFirstKept) appendMessage(entry);
		}
		for (let i = compactionIdx + 1; i < pathEntries.length; i++) {
			appendMessage(pathEntries[i]!);
		}
	} else {
		for (const entry of pathEntries) {
			appendMessage(entry);
		}
	}

	return { messages, thinkingLevel, model, activeToolNames };
}

export class Session<TMetadata extends SessionMetadata = SessionMetadata> {
	private storage: SessionStorage<TMetadata>;
	private writes: Promise<void> = Promise.resolve();

	constructor(storage: SessionStorage<TMetadata>) {
		this.storage = storage;
	}

	getMetadata(): Promise<TMetadata> {
		return this.storage.getMetadata();
	}

	getStorage(): SessionStorage<TMetadata> {
		return this.storage;
	}

	getLeafId(): Promise<string | null> {
		return this.storage.getLeafId();
	}

	getEntry(id: string): Promise<SessionTreeEntry | undefined> {
		return this.storage.getEntry(id);
	}

	getEntries(): Promise<SessionTreeEntry[]> {
		return this.storage.getEntries();
	}

	async getBranch(fromId?: string): Promise<SessionTreeEntry[]> {
		const leafId = fromId ?? (await this.storage.getLeafId());
		return this.storage.getPathToRoot(leafId);
	}

	async buildContext(): Promise<SessionContext> {
		return buildSessionContext(await this.getBranch());
	}

	getLabel(id: string): Promise<string | undefined> {
		return this.storage.getLabel(id);
	}

	async getSessionName(): Promise<string | undefined> {
		const entries = await this.storage.findEntries("session_info");
		return entries[entries.length - 1]?.name?.trim() || undefined;
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.writes.then(operation);
		this.writes = result.then(() => {}, () => {});
		return result;
	}

	private appendTypedEntry(payload: PendingSessionWrite, signal?: AbortSignal): Promise<string> {
		const copy = structuredClone(payload);
		return this.enqueue(async () => {
			signal?.throwIfAborted();
			const entry = {
				...copy, id: await this.storage.createEntryId(), parentId: await this.storage.getLeafId(),
				timestamp: new Date().toISOString(),
			};
			await this.storage.appendEntry(entry, signal);
			return entry.id;
		});
	}

	async appendMessage(message: AgentMessage): Promise<string> {
		return this.appendTypedEntry({
			type: "message",
			message,
		} satisfies Omit<MessageEntry, "id" | "parentId" | "timestamp">);
	}

	async appendThinkingLevelChange(thinkingLevel: string): Promise<string> {
		return this.appendTypedEntry({
			type: "thinking_level_change",
			thinkingLevel,
		} satisfies Omit<ThinkingLevelChangeEntry, "id" | "parentId" | "timestamp">);
	}

	async appendModelChange(provider: string, modelId: string): Promise<string> {
		return this.appendTypedEntry({
			type: "model_change",
			provider,
			modelId,
		} satisfies Omit<ModelChangeEntry, "id" | "parentId" | "timestamp">);
	}

	async appendActiveToolsChange(activeToolNames: string[]): Promise<string> {
		return this.appendTypedEntry({
			type: "active_tools_change",
			activeToolNames: [...activeToolNames],
		} satisfies Omit<ActiveToolsChangeEntry, "id" | "parentId" | "timestamp">);
	}

	async appendCompaction<T = unknown>(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
		details?: T,
		fromHook?: boolean,
		signal?: AbortSignal,
	): Promise<string> {
		return this.appendTypedEntry({
			type: "compaction",
			summary,
			firstKeptEntryId,
			tokensBefore,
			details,
			fromHook,
		} satisfies Omit<CompactionEntry<T>, "id" | "parentId" | "timestamp">, signal);
	}

	async appendCustomEntry(customType: string, data?: unknown): Promise<string> {
		return this.appendTypedEntry({
			type: "custom",
			customType,
			data,
		} satisfies Omit<CustomEntry, "id" | "parentId" | "timestamp">);
	}

	async appendCustomMessageEntry<T = unknown>(
		customType: string,
		content: string | (TextContent | ImageContent)[],
		display: boolean,
		details?: T,
	): Promise<string> {
		return this.appendTypedEntry({
			type: "custom_message",
			customType,
			content,
			display,
			details,
		} satisfies Omit<CustomMessageEntry<T>, "id" | "parentId" | "timestamp">);
	}

	async appendLabel(targetId: string, label: string | undefined): Promise<string> {
		if (!(await this.storage.getEntry(targetId))) {
			throw new SessionError("not_found", `Entry ${targetId} not found`);
		}
		return this.appendTypedEntry({
			type: "label",
			targetId,
			label,
		} satisfies Omit<LabelEntry, "id" | "parentId" | "timestamp">);
	}

	async appendSessionName(name: string): Promise<string> {
		return this.appendTypedEntry({
			type: "session_info",
			name: name.trim(),
		} satisfies Omit<SessionInfoEntry, "id" | "parentId" | "timestamp">);
	}

	moveTo(
		entryId: string | null,
		summary?: { summary: string; details?: unknown; fromHook?: boolean },
		signal?: AbortSignal,
	): Promise<string | undefined> {
		const copy = structuredClone(summary);
		return this.enqueue(async () => {
			signal?.throwIfAborted();
			if (entryId !== null && !(await this.storage.getEntry(entryId))) {
				throw new SessionError("not_found", `Entry ${entryId} not found`);
			}
			const entries: SessionTreeEntry[] = [{
				type: "leaf", id: await this.storage.createEntryId(), parentId: await this.storage.getLeafId(),
				timestamp: new Date().toISOString(), targetId: entryId,
			}];
			let summaryId: string | undefined;
			if (copy) {
				summaryId = await this.storage.createEntryId();
				entries.push({
					...copy, type: "branch_summary", id: summaryId, parentId: entryId,
					timestamp: new Date().toISOString(), fromId: entryId ?? "root",
				} satisfies BranchSummaryEntry);
			}
			await this.storage.appendEntries(entries, signal);
			return summaryId;
		});
	}
}
