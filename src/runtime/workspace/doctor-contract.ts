export function describeEndpointMode(baseUrl: string): string {
  const url = baseUrl.toLowerCase();
  if (url.includes("anthropic") || url.includes("claude")) return "Anthropic Messages";
  if (url.includes("openai") || url.includes("chat/completions") || url.endsWith("/v1")) return "OpenAI Compatible";
  if (url.includes("deepseek")) return "DeepSeek API";
  if (url.includes("localhost") || url.includes("127.0.0.1")) return "Local";
  if (url.includes("openrouter")) return "OpenRouter";
  return "Custom";
}

export function describeModelProtocol(api: string): string {
  const labels: Record<string, string> = {
    "anthropic-messages": "Anthropic Messages", "openai-completions": "OpenAI Compatible",
    "openai-responses": "OpenAI Responses", "google-generative-ai": "Google Gemini",
  };
  return labels[api] ?? api;
}
