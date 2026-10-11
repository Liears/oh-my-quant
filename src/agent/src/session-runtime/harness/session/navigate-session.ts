import { collectEntriesForBranchSummary, generateBranchSummary } from "../compaction/branch-summarization.ts";
import { isUserLikeRole } from "../messages.ts";
import { AgentHarnessError, type NavigateTreeResult, type SessionBeforeTreeEvent, type SessionBeforeTreeResult, type SessionTreeEvent } from "../types.ts";
import type { SessionOperationContext } from "./operation-context.ts";

export async function navigateSession(
  context: SessionOperationContext,
  before: (event: SessionBeforeTreeEvent) => Promise<SessionBeforeTreeResult | undefined>,
  emit: (event: SessionTreeEvent) => Promise<void>,
  targetId: string, options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
): Promise<NavigateTreeResult> {
  const { signal } = context;
  const oldLeafId = await context.session.getLeafId();
  if (oldLeafId === targetId) return { cancelled: false };
  const targetEntry = await context.session.getEntry(targetId);
  if (!targetEntry) throw new AgentHarnessError("invalid_argument", `Entry ${targetId} not found`);
  const { entries, commonAncestorId } = await collectEntriesForBranchSummary(context.session, oldLeafId, targetId);
  const preparation = {
    targetId,
    oldLeafId,
    commonAncestorId,
    entriesToSummarize: entries,
    userWantsSummary: options?.summarize ?? false,
    customInstructions: options?.customInstructions,
    replaceInstructions: options?.replaceInstructions,
    label: options?.label,
  };
  const hookResult = await before({ type: "session_before_tree", preparation, signal });
  if (signal.aborted || hookResult?.cancel) return { cancelled: true };
  let summaryEntry: NavigateTreeResult["summaryEntry"];
  let summaryText: string | undefined = hookResult?.summary?.summary;
  let summaryDetails: unknown = hookResult?.summary?.details;
  if (!summaryText && options?.summarize && entries.length > 0) {
    const model = context.model;
    if (!model) throw new AgentHarnessError("invalid_state", "No model set for branch summary");
    const auth = await context.getApiKeyAndHeaders?.(model, signal);
    if (!auth) throw new AgentHarnessError("auth", "No auth available for branch summary");
    const branchSummary = await generateBranchSummary(entries, {
      model: auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model,
      env: auth.env,
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal,
      customInstructions: hookResult?.customInstructions ?? options?.customInstructions,
      replaceInstructions: hookResult?.replaceInstructions ?? options?.replaceInstructions,
    });
    if (!branchSummary.ok) {
      if (branchSummary.error.code === "aborted") return { cancelled: true };
      throw new AgentHarnessError("branch_summary", branchSummary.error.message, branchSummary.error);
    }
    summaryText = branchSummary.value.summary;
    summaryDetails = {
      readFiles: branchSummary.value.readFiles,
      modifiedFiles: branchSummary.value.modifiedFiles,
    };
  }
  let editorText: string | undefined;
  let newLeafId: string | null;
  if (targetEntry.type === "message" && isUserLikeRole(targetEntry.message.role)) {
    newLeafId = targetEntry.parentId;
    const content = (targetEntry.message as { content: string | Array<{ readonly type: string; readonly text?: string }> }).content;
    editorText =
      typeof content === "string"
        ? content
        : content
            .filter((c): c is { readonly type: "text"; readonly text: string } => c.type === "text")
            .map((c) => c.text)
            .join("");
  } else if (targetEntry.type === "custom_message") {
    newLeafId = targetEntry.parentId;
    editorText =
      typeof targetEntry.content === "string"
        ? targetEntry.content
        : targetEntry.content
            .filter((c): c is { readonly type: "text"; readonly text: string } => c.type === "text")
            .map((c) => c.text)
            .join("");
  } else {
    newLeafId = targetId;
  }
  if (signal.aborted) return { cancelled: true };
  let summaryId: string | undefined;
  try {
    summaryId = await context.session.moveTo(
      newLeafId,
      summaryText
        ? { summary: summaryText, details: summaryDetails, fromHook: hookResult?.summary !== undefined }
        : undefined,
      signal,
    );
  } catch (error) {
    if (signal.aborted) return { cancelled: true };
    throw error;
  }
  if (summaryId) {
    const entry = await context.session.getEntry(summaryId);
    if (entry?.type === "branch_summary") summaryEntry = entry;
  }
  await emit({
    type: "session_tree",
    newLeafId: await context.session.getLeafId(),
    oldLeafId,
    summaryEntry,
    fromHook: hookResult?.summary !== undefined,
  });
  return { cancelled: false, editorText, summaryEntry };
}
