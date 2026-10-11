import { runAgentLoop as upstreamRunAgentLoop } from "@earendil-works/pi-agent-core";
import type { SystemMessage } from "@earendil-works/pi-ai";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, StreamFn } from "../session-runtime/types.ts";

const PROMPT_SECTION = "whyj.runtime";

// Pi 1.x replays prompt sections and tool declarations from the transcript.
// A named section replaces the previous runtime prompt after a resource change.
function promptUpdate(context: AgentContext): SystemMessage[] {
  let previous: string | null | undefined;
  for (const message of context.messages) {
    if (message.role === "system" && Object.hasOwn(message.sections ?? {}, PROMPT_SECTION)) {
      previous = message.sections![PROMPT_SECTION];
    }
  }
  if ((previous ?? "") === context.systemPrompt) return [];
  return [{ role: "system", content: "", sections: { [PROMPT_SECTION]: context.systemPrompt }, timestamp: Date.now() }];
}

export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: (event: AgentEvent) => Promise<void> | void,
  signal: AbortSignal | undefined,
  streamFn: StreamFn,
): Promise<AgentMessage[]> {
  const adapted: AgentLoopConfig = {
    ...config,
    finishTurn: async (turn, signal) => {
      const decision = await config.finishTurn?.(turn, signal);
      return await config.shouldStopAfterTurn?.(turn) ? { action: "end" } : decision;
    },
    prepareNextTurn: async (turn) => {
      const update = await config.prepareNextTurn?.(turn);
      if (!update) return update;
      return { ...update, messages: [...promptUpdate(update.context ?? turn.context), ...(update.messages ?? [])] };
    },
  };
  // Custom WhyJ roles are converted at the provider boundary. Keep the single
  // structural cast here; upstream awaits the sink before tool preflight.
  const run = upstreamRunAgentLoop as unknown as typeof runAgentLoop;
  return run([...promptUpdate(context), ...prompts], context, adapted, emit, signal, streamFn);
}
