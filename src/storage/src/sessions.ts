import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveSessionsDir } from "./dirs.ts";

interface StoredJsonlSessionMetadata {
  id: string;
  createdAt: string;
  cwd: string;
  path: string;
  parentSessionPath?: string;
}

interface StoredUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
}

type StoredAgentMessage = Record<string, unknown> & {
  role?: string;
  content?: unknown;
  provider?: string;
  model?: string;
  usage?: StoredUsage;
  stopReason?: string;
  summary?: string;
  command?: string;
  output?: string;
};

type StoredSessionTreeEntry = Record<string, unknown> & {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  targetId?: string | null;
  message?: StoredAgentMessage;
  provider?: string;
  modelId?: string;
  summary?: string;
  firstKeptEntryId?: string;
  fromId?: string;
  content?: unknown;
  display?: boolean;
  customType?: string;
};

export interface StoredSessionContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number | null;
}

export interface StoredSessionEntryCount {
  messages: number;
  compactions: number;
  branches: number;
}

export interface StoredSessionSummary extends StoredJsonlSessionMetadata {
  format: "jsonl" | "markdown";
  updatedAt: string;
  preview: string;
  messageCount: number;
  contextUsage?: StoredSessionContextUsage;
  entryCount?: StoredSessionEntryCount;
  sessionName?: string;
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>;
}

type SessionScope = "cwd" | "all";
type SessionSort = "created" | "updated";

function getSessionsDir(): string {
  return resolveSessionsDir();
}

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function normalizePreview(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
}

function extractMessagePreview(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return normalizePreview(content);
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((part): part is { type?: unknown; text?: unknown } => !!part && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ");
  return text ? normalizePreview(text) : undefined;
}

function pushRecentMessage(
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>,
  role: string,
  text: string | undefined,
): void {
  if ((role !== "user" && role !== "assistant") || !text) return;
  recentMessages.push({ role, text });
  if (recentMessages.length > 4) recentMessages.shift();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function leafIdAfterEntry(entry: StoredSessionTreeEntry): string | null {
  return entry.type === "leaf" ? entry.targetId ?? null : entry.id;
}

function normalizeSessionEntry(parsed: Record<string, unknown>): StoredSessionTreeEntry | null {
  if (typeof parsed.type !== "string" || typeof parsed.id !== "string" || !parsed.id || typeof parsed.timestamp !== "string" || !parsed.timestamp) {
    return null;
  }
  const entry = { ...parsed } as Record<string, unknown>;
  if (entry.parentId !== null && typeof entry.parentId !== "string") {
    return null;
  }
  if (entry.type === "leaf" && entry.targetId !== null && typeof entry.targetId !== "string") {
    return null;
  }
  return entry as StoredSessionTreeEntry;
}

function buildCurrentBranch(entries: StoredSessionTreeEntry[], leafId: string | null): StoredSessionTreeEntry[] {
  if (leafId === null) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: StoredSessionTreeEntry[] = [];
  let current = byId.get(leafId);
  while (current) {
    path.push(current);
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  return path.reverse();
}

function normalizeModelLookupId(modelId: string): string {
  return modelId.replace(/\[\d+m\]$/u, "");
}

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "deepseek:deepseek-v4-flash": 1_000_000,
  "deepseek:deepseek-v4-pro": 1_000_000,
  "openrouter:openai/gpt-5.5": 1_050_000,
};

function inferContextProviderCandidates(provider: string, modelId: string): string[] {
  const lookupId = normalizeModelLookupId(modelId);
  const candidates = [provider];
  if (provider === "anthropic" && lookupId.startsWith("deepseek-")) candidates.push("deepseek");
  if (lookupId.startsWith("openai/")) candidates.push("openrouter");
  if (lookupId.startsWith("deepseek-")) candidates.push("deepseek");
  if (lookupId.startsWith("gpt-") || lookupId.startsWith("o")) candidates.push("openai", "openrouter");
  if (lookupId.startsWith("claude-")) candidates.push("anthropic");
  return [...new Set(candidates)];
}

function inferContextWindow(model: { provider: string; modelId: string } | null): number {
  if (!model) return 200_000;
  const lookupId = normalizeModelLookupId(model.modelId);
  for (const provider of inferContextProviderCandidates(model.provider, lookupId)) {
    const exact = MODEL_CONTEXT_WINDOWS[`${provider}:${lookupId}`];
    if (exact) return exact;
    const prefix = Object.entries(MODEL_CONTEXT_WINDOWS)
      .find(([key]) => key.startsWith(`${provider}:`) && lookupId.startsWith(key.slice(provider.length + 1)));
    if (prefix) return prefix[1];
  }
  if (model.provider === "zai" || model.provider === "minimax" || model.provider === "minimax-cn") return 128_000;
  return 200_000;
}

function buildStoredSessionContext(entries: StoredSessionTreeEntry[], leafId: string | null): {
  messages: StoredAgentMessage[];
  model: { provider: string; modelId: string } | null;
} {
  const branch = buildCurrentBranch(entries, leafId);
  let model: { provider: string; modelId: string } | null = null;
  let compaction: StoredSessionTreeEntry | null = null;

  for (const entry of branch) {
    if (entry.type === "model_change" && typeof entry.provider === "string" && typeof entry.modelId === "string") {
      model = { provider: entry.provider, modelId: entry.modelId };
    } else if (entry.type === "message" && entry.message?.role === "assistant") {
      const provider = entry.message.provider;
      const modelId = entry.message.model;
      if (typeof provider === "string" && typeof modelId === "string") {
        model = { provider, modelId };
      }
    } else if (entry.type === "compaction") {
      compaction = entry;
    }
  }

  const messages: StoredAgentMessage[] = [];
  const appendMessage = (entry: StoredSessionTreeEntry) => {
    if (entry.type === "message" && isRecord(entry.message)) {
      messages.push(entry.message);
    } else if (entry.type === "custom_message" && entry.display !== false) {
      messages.push({ role: "custom", content: entry.content ?? "" });
    } else if (entry.type === "branch_summary" && typeof entry.summary === "string") {
      messages.push({ role: "branchSummary", summary: entry.summary });
    }
  };

  if (compaction) {
    messages.push({ role: "compactionSummary", summary: compaction.summary ?? "" });
    const compactionIndex = branch.findIndex((entry) => entry.type === "compaction" && entry.id === compaction!.id);
    let foundFirstKept = false;
    for (let i = 0; i < compactionIndex; i++) {
      const entry = branch[i]!;
      if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
      if (foundFirstKept) appendMessage(entry);
    }
    for (let i = compactionIndex + 1; i < branch.length; i++) {
      appendMessage(branch[i]!);
    }
  } else {
    for (const entry of branch) appendMessage(entry);
  }

  return { messages, model };
}

function buildContextUsage(entries: StoredSessionTreeEntry[], leafId: string | null): StoredSessionContextUsage {
  const context = buildStoredSessionContext(entries, leafId);
  const estimatedTokens = estimateStoredContextTokens(context.messages);
  const tokens = Number.isFinite(estimatedTokens) ? estimatedTokens : 0;
  const contextWindow = inferContextWindow(context.model);
  return {
    tokens,
    contextWindow,
    percent: contextWindow > 0 ? tokens / contextWindow * 100 : null,
  };
}

function estimateStoredContextTokens(messages: StoredAgentMessage[]): number {
  const usageInfo = findLastAssistantUsage(messages);
  if (!usageInfo) return messages.reduce((sum, message) => sum + estimateStoredMessageTokens(message), 0);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateStoredMessageTokens(messages[i]!);
  }
  return usageInfo.tokens + trailingTokens;
}

function findLastAssistantUsage(messages: StoredAgentMessage[]): { tokens: number; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant" || message.stopReason === "aborted" || message.stopReason === "error") continue;
    const usage = message.usage;
    if (!usage) continue;
    const tokens = usage.totalTokens
      || (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    if (tokens > 0) return { tokens, index: i };
  }
  return null;
}

function estimateStoredMessageTokens(message: StoredAgentMessage): number {
  let chars = 0;
  switch (message.role) {
    case "user":
    case "displayUser":
    case "toolResult":
    case "custom":
      chars = estimateContentChars(message.content);
      break;
    case "assistant":
      chars = estimateAssistantContentChars(message.content);
      break;
    case "bashExecution":
      chars = String(message.command ?? "").length + String(message.output ?? "").length;
      break;
    case "branchSummary":
    case "compactionSummary":
      chars = String(message.summary ?? "").length;
      break;
    default:
      chars = estimateContentChars(message.content ?? message.summary ?? "");
  }
  return Math.ceil(chars / 4);
}

function estimateContentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, block) => {
    if (!isRecord(block)) return sum;
    if (block.type === "text" && typeof block.text === "string") return sum + block.text.length;
    if (block.type === "image") return sum + 4_800;
    return sum;
  }, 0);
}

function estimateAssistantContentChars(content: unknown): number {
  if (!Array.isArray(content)) return estimateContentChars(content);
  return content.reduce((sum, block) => {
    if (!isRecord(block)) return sum;
    if (block.type === "text" && typeof block.text === "string") return sum + block.text.length;
    if (block.type === "thinking" && typeof block.thinking === "string") return sum + block.thinking.length;
    if (block.type === "toolCall") return sum + String(block.name ?? "").length + safeJsonStringify(block.arguments).length;
    return sum;
  }, 0);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function parseSessionFile(filePath: string): StoredSessionSummary | null {
  try {
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(filePath));
    const lines = raw.split(/\r?\n/).filter(line => line.trim());
    if (lines.length === 0) return null;

    const header = JSON.parse(lines[0]!) as Record<string, unknown>;
    if (header.type !== "session" || header.version !== 3) return null;
    if (typeof header.id !== "string" || !header.id || typeof header.timestamp !== "string" || !header.timestamp || typeof header.cwd !== "string" || !header.cwd) {
      return null;
    }

    let updatedAt = header.timestamp;
    let preview = "";
    let sessionName: string | undefined;
    let messageCount = 0;
    const recentMessages: StoredSessionSummary["recentMessages"] = [];
    const entries: StoredSessionTreeEntry[] = [];
    const seen = new Set<string>();
    let leafId: string | null = null;

    for (const line of lines.slice(1)) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
      if (!isRecord(parsed)) return null;
      const entry = normalizeSessionEntry(parsed);
      if (!entry || seen.has(entry.id)) return null;
      if (entry.parentId !== null && !seen.has(entry.parentId)) return null;
      if ((entry.type === "leaf" || entry.type === "label") && entry.targetId !== null && (typeof entry.targetId !== "string" || !seen.has(entry.targetId))) return null;
      seen.add(entry.id);
      entries.push(entry);
      leafId = leafIdAfterEntry(entry);
      if (typeof parsed.timestamp === "string") updatedAt = parsed.timestamp;
      if (parsed.type === "session_info" && typeof parsed.name === "string" && parsed.name.trim()) {
        sessionName = parsed.name.trim();
      }
      if (parsed.type === "message") {
        messageCount += 1;
        const message = parsed.message;
        const role = typeof message === "object" && message && typeof (message as { role?: unknown }).role === "string"
          ? (message as { role: string }).role
          : "";
        if (role === "user" || role === "assistant") {
          const text = extractMessagePreview(message);
          if (!preview) preview = text || preview;
          pushRecentMessage(recentMessages, role, text);
        }
      }
    }

    return {
      format: "jsonl",
      id: header.id,
      createdAt: header.timestamp,
      updatedAt,
      cwd: header.cwd,
      path: filePath,
      parentSessionPath: typeof header.parentSession === "string" ? header.parentSession : undefined,
      preview: preview || sessionName || "Untitled session",
      contextUsage: buildContextUsage(entries, leafId),
      entryCount: {
        messages: messageCount,
        compactions: entries.filter((entry) => entry.type === "compaction").length,
        branches: entries.filter((entry) => entry.type === "branch_summary").length,
      },
      sessionName,
      messageCount,
      recentMessages,
    };
  } catch {
    return null;
  }
}

function parseLegacyMarkdownSession(filePath: string, cwd: string): StoredSessionSummary | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const stat = statSync(filePath);
    const lines = raw.split(/\r?\n/);
    const title = lines.find((line) => line.startsWith("# Session "))?.replace(/^#\s+/, "").trim();
    const blocks: Array<{ role: "user" | "assistant"; text: string }> = [];
    let role: "user" | "assistant" | null = null;
    let buf: string[] = [];

    const flush = () => {
      if (!role) return;
      const text = normalizePreview(buf.join(" "));
      if (text) blocks.push({ role, text });
      role = null;
      buf = [];
    };

    for (const line of lines) {
      const user = /^##\s+.+\s+·\s+User\s*$/.test(line);
      const assistant = /^##\s+.+\s+·\s+Assistant\s*$/.test(line);
      if (user || assistant) {
        flush();
        role = user ? "user" : "assistant";
        continue;
      }
      if (!role) continue;
      if (line.startsWith("<details") || line.startsWith("</details") || line.startsWith("<summary")) continue;
      if (line.startsWith("<!--") || line.startsWith("> ")) continue;
      if (line.startsWith("- Tool:") || line.startsWith("  Arguments:")) continue;
      if (line.startsWith("#")) continue;
      buf.push(line);
    }
    flush();

    const updatedAt = stat.mtime.toISOString();
    const createdAt = stat.birthtimeMs > 0 ? stat.birthtime.toISOString() : updatedAt;
    const id = basename(filePath, ".md");
    return {
      format: "markdown",
      id,
      createdAt,
      updatedAt,
      cwd,
      path: filePath,
      preview: blocks[0]?.text || title || "Legacy transcript",
      sessionName: title,
      messageCount: blocks.length,
      recentMessages: blocks.slice(-4),
    };
  } catch {
    return null;
  }
}

function readSessionDirs(scope: SessionScope, cwd: string): string[] {
  const sessionsDir = getSessionsDir();
  if (scope === "cwd") {
    return [join(sessionsDir, encodeCwd(cwd))];
  }
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(sessionsDir, entry.name));
}

function readLegacyMarkdownSessions(scope: SessionScope, cwd: string): StoredSessionSummary[] {
  const sessionsDir = getSessionsDir();
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .flatMap((entry) => {
      const dir = join(sessionsDir, entry.name);
      return readdirSync(dir, { withFileTypes: true })
        .filter((file) => file.isFile() && file.name.endsWith(".md"))
        .map((file) => parseLegacyMarkdownSession(join(dir, file.name), cwd))
        .filter((session): session is StoredSessionSummary => session !== null);
    })
    .filter((session) => scope === "all" || session.cwd === cwd);
}

export function listStoredSessions(options?: {
  cwd?: string;
  limit?: number;
  scope?: SessionScope;
  sort?: SessionSort;
}): StoredSessionSummary[] {
  const cwd = options?.cwd ?? process.cwd();
  const limit = options?.limit ?? 20;
  const scope = options?.scope ?? "cwd";
  const sort = options?.sort ?? "updated";

  const sessions = [
    ...readSessionDirs(scope, cwd)
    .flatMap((dir) => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => parseSessionFile(join(dir, entry.name)))
        .filter((entry): entry is StoredSessionSummary => entry !== null);
    }),
    ...readLegacyMarkdownSessions(scope, cwd),
  ]
    .sort((a, b) => {
      const left = new Date(sort === "updated" ? a.updatedAt : a.createdAt).getTime();
      const right = new Date(sort === "updated" ? b.updatedAt : b.createdAt).getTime();
      return right - left;
    });

  return sessions.slice(0, limit);
}
