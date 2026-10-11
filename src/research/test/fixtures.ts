import { saveBars, savePortfolioComparison } from "../../storage/index.ts";
import { runBacktestTool } from "../../tools/quant-tools.ts";
import { comparePortfolios } from "../../quant/portfolio-comparison.ts";
import { comparisonFixture } from "../../quant/fixtures/portfolio-comparison.ts";
import type { AgentMessage } from "../../agent/src/session-runtime/index.ts";
import type { JsonObject, JsonValue } from "@earendil-works/pi-ai";

function jsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Research fixture values must be JSON serializable.");
  return JSON.parse(serialized) as JsonValue;
}

function jsonObject(value: Record<string, unknown>): JsonObject {
  const result = jsonValue(value);
  if (result === null || Array.isArray(result) || typeof result !== "object") throw new Error("Research fixture arguments must be a JSON object.");
  return result as JsonObject;
}

export function researchMessages(name: string, args: Record<string, unknown>, details?: unknown, isError = false): AgentMessage[] {
  const messages: AgentMessage[] = [
    { role: "displayUser", content: [{ type: "text", text: "Injected internal prompt" }], displayText: "比较原组合；保持费用假设，不执行交易", timestamp: 0 },
    { role: "assistant", content: [{ type: "toolCall", id: "research-call", name, arguments: jsonObject(args) }], api: "openai-completions", provider: "custom", model: "research-fixture",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 1 },
  ];
  if (details !== undefined) messages.push({ role: "toolResult", toolCallId: "research-call", toolName: name, details: jsonValue(details),
    content: [{ type: "text", text: isError ? "DATA_NOT_ENOUGH: no matching dates" : "Persisted fixture result" }], isError, timestamp: 2 });
  return messages;
}

export function researchEntries(messages: AgentMessage[]) {
  return messages.map((message, index) => ({ type: "message", id: `entry-${index}`, message }));
}

export async function backtestFixture() {
  const bars = Array.from({ length: 40 }, (_, index) => ({ date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    open: 100 + index, high: 100 + index, low: 100 + index, close: 100 + index, volume: 10, amount: 1000 }));
  await saveBars("AAPL", "financial-datasets", bars);
  const args = { symbol: "AAPL", fast: 1, slow: 2, cash: 1000, commission: 0, start: "2026-01-01", end: "2026-02-09" };
  const result = await runBacktestTool.execute("research-call", args);
  return { args, result, messages: researchMessages("run_backtest", args, result.details) };
}

export async function portfolioFixture() {
  const input = comparisonFixture();
  input.groups[0].name = "原始观察组";
  input.groups[0].weights = { AAPL: 0.7, MSFT: 0.3 };
  input.portfolioRevision = "recorded-group-revision";
  input.request = { groups: [input.groups[0].id, input.groups[1].id], start: input.start, end: input.end, benchmark: input.benchmark,
    baseCurrency: input.baseCurrency, currencies: Object.fromEntries(input.prices.map(price => [price.symbol, price.currency])),
    weighting: input.weighting, missingMembers: input.missingMembers, weights: [input.groups[0].weights, null] };
  for (const price of input.prices) {
    const ref = await saveBars(price.symbol, "financial-datasets", price.points.map(point => ({ date: point.date, open: point.price,
      high: point.price, low: point.price, close: point.price, volume: 1, amount: 1 })), input.start, input.end);
    price.dataset = ref!; price.source = ref!.source; price.observedAt = ref!.snapshotAt;
  }
  const artifact = savePortfolioComparison(comparePortfolios(input));
  return { artifact, messages: researchMessages("portfolio_comparisons", { id: artifact.id }, artifact) };
}
