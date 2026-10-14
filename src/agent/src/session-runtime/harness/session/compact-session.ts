import { compact, DEFAULT_COMPACTION_SETTINGS, prepareCompaction } from "../compaction/compaction.ts";
import { AgentHarnessError, type CompactResult, type SessionBeforeCompactEvent, type SessionBeforeCompactResult, type SessionCompactEvent } from "../types.ts";
import type { SessionOperationContext } from "./operation-context.ts";

export async function compactSession(
  context: SessionOperationContext,
  before: (event: SessionBeforeCompactEvent) => Promise<SessionBeforeCompactResult | undefined>,
  emit: (event: SessionCompactEvent) => Promise<void>,
  customInstructions?: string,
): Promise<CompactResult> {
  const { signal } = context;
  const model = context.model;
  if (!model) throw new AgentHarnessError("invalid_state", "No model set for compaction");
  const auth = await context.getApiKeyAndHeaders?.(model, signal);
  if (!auth) throw new AgentHarnessError("auth", "No auth available for compaction");
  const branchEntries = await context.session.getBranch();
  const preparationResult = prepareCompaction(branchEntries, DEFAULT_COMPACTION_SETTINGS);
  if (!preparationResult.ok) throw preparationResult.error;
  const preparation = preparationResult.value;
  if (!preparation) throw new AgentHarnessError("compaction", "Nothing to compact");
  const hookResult = await before({
    type: "session_before_compact",
    preparation,
    branchEntries,
    customInstructions,
    signal,
  });
  signal.throwIfAborted();
  if (hookResult?.cancel) throw new AgentHarnessError("compaction", "Compaction cancelled");
  const provided = hookResult?.compaction;
  const compactResult = provided
    ? { ok: true as const, value: provided }
    : await compact(
        preparation,
        auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model,
        auth.apiKey,
        auth.headers,
        customInstructions,
        signal,
        context.thinkingLevel,
        auth.env,
      );
  if (!compactResult.ok) throw compactResult.error;
  signal.throwIfAborted();
  const result = compactResult.value;
  const entryId = await context.session.appendCompaction(
    result.summary,
    result.firstKeptEntryId,
    result.tokensBefore,
    result.details,
    provided !== undefined,
    signal,
  );
  const entry = await context.session.getEntry(entryId);
  if (entry?.type === "compaction") {
    await emit({ type: "session_compact", compactionEntry: entry, fromHook: provided !== undefined });
  }
  return result;
}
