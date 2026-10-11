import { expect, it } from "bun:test";
import { stream as streamAnthropicMessages } from "@earendil-works/pi-ai/api/anthropic-messages";
import type { Model } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";

it("preserves the literal [1m] suffix in the Anthropic request payload", async () => {
  let captured: Record<string, unknown> | undefined;
  const model = {
    id: "glm-5.2[1m]",
    name: "glm-5.2[1m]",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  } satisfies Model<"anthropic-messages">;

  const stream = streamAnthropicMessages(model, normalizeContext({
    systemPrompt: "",
    messages: [],
    tools: [],
  }), {
    apiKey: "test-key",
    onPayload: (payload) => {
      captured = payload as Record<string, unknown>;
      throw new Error("stop before network");
    },
  });

  for await (const _event of stream) {
    // Drain the provider stream so its async request builder completes.
  }

  expect(captured?.model).toBe("glm-5.2[1m]");
});
