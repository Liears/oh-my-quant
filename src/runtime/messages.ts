import type { UIMessage } from "../tui/src/types.ts";

export function shouldRenderCommandResultAsMessage(text: string): boolean {
  return text.includes("\n") || text.length > 120;
}

export function toUiMessage(message: unknown): UIMessage | null {
  const role = (message as { role?: string }).role;
  const text = extractAgentMessageText(message);
  if (role === "user" || role === "displayUser") return { role: "user", text };
  if (role === "assistant") {
    const content = (message as { content?: unknown }).content;
    const assistantText = Array.isArray(content)
      ? extractAssistantText({ content })
      : text;
    return { role: "assistant", text: assistantText };
  }
  return null;
}

export function extractAgentMessageText(message: unknown): string {
  const displayText = extractMessageDisplayText(message);
  if (displayText) return displayText;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: string; text?: string; thinking?: string } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" || part.type === "thinking")
    .map((part) => part.text ?? part.thinking ?? "")
    .join("\n");
}

export function extractAssistantText(message: { content: unknown[] }): string {
  return (message.content as Array<{ type?: string; text?: string }>)
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!)
    .join("");
}

export function extractDisplayText(message: unknown): string {
  return extractAgentMessageText(message);
}

export function extractTextFromResult(result: unknown): string {
  if (!result) return "";
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    return (r.content as Array<{ text?: string }>)
      .filter((part) => part.text)
      .map((part) => part.text!)
      .join("\n");
  }
  if (typeof r.text === "string") return r.text;
  return typeof result === "string" ? result : "";
}

export function extractToolError(result: unknown): string {
  if (!result || typeof result !== "object") return "Tool execution failed";
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    const first = (r.content as Array<Record<string, unknown>>)[0];
    return String(first?.text ?? "Tool execution failed");
  }
  return "Tool execution failed";
}

function extractMessageDisplayText(message: unknown): string | undefined {
  const displayText = (message as { role?: string; displayText?: unknown }).role === "displayUser"
    ? (message as { displayText?: unknown }).displayText
    : undefined;
  return typeof displayText === "string" ? displayText : undefined;
}
