import { createLocalAgent as createAgent } from "../../runtime/session.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { type QuantAgentSession } from "../../agent/src/session.ts";
import { resolveConfiguredAuth } from "../../agent/src/model-config.ts";
import { canonicalizeWhyjEnv, readWhyjEnvValue, resolveSettingsPath } from "../../storage/index.ts";
import { DEFAULT_SETTINGS, type OhQuantSettings } from "../../types/config.ts";

type SmokeCase = {
  name: string;
  model: string;
  env: Record<string, string>;
  provider?: string;
  providers?: OhQuantSettings["providers"];
};

type SmokeResult = {
  name: string;
  ok: boolean;
  provider?: string;
  api?: string;
  model?: string;
  baseUrl?: string;
  response?: string;
  error?: string;
};

const ROOT = resolve(import.meta.dir, "../../..");
const PROMPT = "Reply with only ok.";

function loadProjectSettings(): OhQuantSettings {
  const path = resolveSettingsPath();
  if (!existsSync(path)) {
    throw new Error(`Missing settings file: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as OhQuantSettings;
}

export function buildSettingsCase(settings: OhQuantSettings): SmokeCase | null {
  const env = canonicalizeWhyjEnv(settings.env ?? {});
  if (settings.provider) return { name: "current-settings", provider: settings.provider, providers: settings.providers, model: settings.model, env };
  const token = readWhyjEnvValue(env, "apiKey") || readWhyjEnvValue(env, "authToken");
  const baseUrl = readWhyjEnvValue(env, "baseUrl");
  if (!token || !baseUrl || !settings.model) return null;
  return {
    name: "current-settings",
    model: settings.model,
    env: {
      ...env,
      WHYJ_QUANT_API_KEY: token,
      WHYJ_QUANT_AUTH_TOKEN: token,
      WHYJ_QUANT_BASE_URL: baseUrl,
    },
  };
}

function readSmokeEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildVendorCases(): SmokeCase[] {
  const cases: SmokeCase[] = [];

  const glmToken = readSmokeEnv("WHYJ_SMOKE_GLM_AUTH_TOKEN");
  if (glmToken) {
    cases.push({
      name: "glm-anthropic",
      model: readSmokeEnv("WHYJ_SMOKE_GLM_ANTHROPIC_MODEL") || "glm-5.2",
      env: {
        WHYJ_QUANT_API_KEY: glmToken,
        WHYJ_QUANT_AUTH_TOKEN: glmToken,
        WHYJ_QUANT_BASE_URL: readSmokeEnv("WHYJ_SMOKE_GLM_ANTHROPIC_BASE_URL") || "https://open.bigmodel.cn/api/anthropic",
      },
    });
    cases.push({
      name: "glm-openai",
      model: readSmokeEnv("WHYJ_SMOKE_GLM_OPENAI_MODEL") || "glm-5.2",
      env: {
        WHYJ_QUANT_API_KEY: glmToken,
        WHYJ_QUANT_AUTH_TOKEN: glmToken,
        WHYJ_QUANT_BASE_URL: readSmokeEnv("WHYJ_SMOKE_GLM_OPENAI_BASE_URL") || "https://open.bigmodel.cn/api/v1",
      },
    });
  }

  const minimaxToken = readSmokeEnv("WHYJ_SMOKE_MINIMAX_AUTH_TOKEN");
  if (minimaxToken) {
    cases.push({
      name: "minimax-anthropic",
      model: readSmokeEnv("WHYJ_SMOKE_MINIMAX_ANTHROPIC_MODEL") || "MiniMax-M2.7",
      env: {
        WHYJ_QUANT_API_KEY: minimaxToken,
        WHYJ_QUANT_AUTH_TOKEN: minimaxToken,
        WHYJ_QUANT_BASE_URL: readSmokeEnv("WHYJ_SMOKE_MINIMAX_ANTHROPIC_BASE_URL") || "https://api.minimaxi.com/anthropic",
      },
    });
    cases.push({
      name: "minimax-openai",
      model: readSmokeEnv("WHYJ_SMOKE_MINIMAX_OPENAI_MODEL") || "MiniMax-M2.7",
      env: {
        WHYJ_QUANT_API_KEY: minimaxToken,
        WHYJ_QUANT_AUTH_TOKEN: minimaxToken,
        WHYJ_QUANT_BASE_URL: readSmokeEnv("WHYJ_SMOKE_MINIMAX_OPENAI_BASE_URL") || "https://api.minimaxi.com/v1",
      },
    });
  }

  return cases;
}

function extractAssistantText(messages: Array<{ role?: string; content?: unknown }>): string | undefined {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistant) return undefined;
  if (typeof assistant.content === "string") return assistant.content;
  if (!Array.isArray(assistant.content)) return undefined;
  const text = assistant.content
    .filter((part): part is { type?: string; text?: string } => typeof part === "object" && part !== null)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join(" ");
  return text || undefined;
}

export async function runCase(smokeCase: SmokeCase, timeoutMs = 30_000): Promise<SmokeResult> {
  const tempDir = mkdtempSync(join(tmpdir(), "ohq-provider-smoke-"));
  const previousOhquantDir = process.env.OHQUANT_DIR;
  let agent: QuantAgentSession | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const secrets = [readWhyjEnvValue(smokeCase.env, "apiKey"), readWhyjEnvValue(smokeCase.env, "authToken"), ...Object.values(smokeCase.providers ?? {}).map(provider => provider.apiKey)].filter((value): value is string => Boolean(value));
  const safe = (value: string) => secrets.reduce((text, secret) => text.split(secret).join("[redacted]"), value);

  try {
    process.env.OHQUANT_DIR = tempDir;
    writeFileSync(join(tempDir, "settings.json"), JSON.stringify({
      ...DEFAULT_SETTINGS,
      provider: smokeCase.provider,
      providers: smokeCase.providers,
      env: canonicalizeWhyjEnv(smokeCase.env),
      model: smokeCase.model,
      thinkingLevel: "off",
      insightEnabled: false,
      showPortfolioPanel: false,
      skillIntegrations: { codex: false, claude: false },
      permissions: {},
      preferences: {
        defaultMarket: "A",
        defaultBenchmark: "000300.SH",
        defaultCash: 100000,
        defaultFast: 20,
        defaultSlow: 60,
        currentPortfolioFile: "holdings.json",
        source: "llmquant-data",
      },
    }, null, 2), "utf-8");

    agent = createAgent({
      cwd: ROOT,
      sessionsRoot: join(tempDir, "sessions"),
    });

    await agent.waitForIdle();
    const auth = await resolveConfiguredAuth({ ...DEFAULT_SETTINGS, ...smokeCase }, agent.state.model);
    if (auth?.auth.apiKey) secrets.push(auth.auth.apiKey);
    for (const value of Object.values(auth?.auth.headers ?? {})) {
      if (value) secrets.push(value, value.replace(/^Bearer\s+/i, ""));
    }
    await Promise.race([
      agent.prompt(PROMPT),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { agent?.abort(); reject(new Error(`Model smoke timed out after ${timeoutMs}ms`)); }, timeoutMs);
      }),
    ]);
    await agent.waitForIdle();
    const last = [...agent.state.messages].reverse().find(message => message.role === "assistant");
    const response = extractAssistantText(agent.state.messages);
    if (!last || last.stopReason === "error" || last.stopReason === "aborted" || !response?.trim()) {
      throw new Error(last?.errorMessage || "Model returned no assistant text");
    }

    return {
      name: smokeCase.name,
      ok: true,
      provider: agent.state.model.provider,
      api: agent.state.model.api,
      model: agent.state.model.id,
      baseUrl: agent.state.model.baseUrl,
      response: safe(response),
    };
  } catch (error) {
    return {
      name: smokeCase.name,
      ok: false,
      error: safe(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    if (timer) clearTimeout(timer);
    agent?.abort();
    await agent?.waitForIdle().catch(() => {});
    if (previousOhquantDir == null) delete process.env.OHQUANT_DIR;
    else process.env.OHQUANT_DIR = previousOhquantDir;
    if (!resolve(tempDir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected smoke test directory");
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const projectSettings = loadProjectSettings();
  const cases = [
    buildSettingsCase(projectSettings),
    ...buildVendorCases(),
  ].filter((value): value is SmokeCase => value !== null);

  if (cases.length === 0) {
    throw new Error(
      "No runnable smoke cases. Configure .ohquant/settings.json or set WHYJ_SMOKE_GLM_AUTH_TOKEN / WHYJ_SMOKE_MINIMAX_AUTH_TOKEN.",
    );
  }

  const results: SmokeResult[] = [];
  for (const smokeCase of cases) {
    results.push(await runCase(smokeCase));
  }

  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
