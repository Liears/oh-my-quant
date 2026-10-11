import { toolProbeChoices, TOOL_PROBE_PARAMETER_RULES, type ToolProbeChoice } from "./tool-probe-catalog.ts";
import { DATA_MARKETS } from "./data-readiness.ts";
import { AKSHARE_PUBLIC_INDEX_ENDPOINTS } from "../source/index.ts";
import { AKSHARE_INDEX_SIGNATURE_VERSION } from "./akshare-index-signatures.generated.ts";
import type { DataMarket } from "../types/data-readiness.ts";
import type { CommandResult, ParsedCommand } from "../types/commands.ts";

export function isInstalledToolProbeSchemaQuery(parsed: ParsedCommand): boolean {
  return parsed.command === "doctor" && parsed.flags.schema === true && parsed.flags.installed === true;
}

export interface ToolProbeSchemaOptions {
  choices?: ToolProbeChoice[];
  scope?: "static-declarations" | "installed-signatures";
  indexSignatureVersion?: string;
  comparison?: { packagedVersion: string; versionMatches: boolean; matchesPackaged: boolean; changedEndpoints: string[] };
}

/** Explicit market keeps schema discovery independent of saved settings and dependency probes. */
export function toolProbeSchemaResult(flags: ParsedCommand["flags"], positional: string[], options: ToolProbeSchemaOptions = {}): CommandResult {
  const fail = (message: string): CommandResult => ({ success: false, message });
  const { tool, market, provider, endpoint } = flags;
  if (flags.schema !== true || positional.length || Object.keys(flags).some(key => !["schema", "tool", "market", "provider", "endpoint"].includes(key))
    || typeof tool !== "string" || !tool.trim() || !DATA_MARKETS.includes(market as DataMarket)
    || [provider, endpoint].some(value => value !== undefined && (typeof value !== "string" || !value.trim()))) {
    return fail("Use /doctor --tool NAME --market A|US|HK|Fund --schema [--provider NAME] [--endpoint NAME]; no probe parameters.");
  }
  const choices = (options.choices ?? toolProbeChoices(tool, market as DataMarket)).filter(choice => (provider === undefined || provider === choice.provider) && (endpoint === undefined || endpoint === choice.endpoint));
  if (!choices.length) return fail("No declared public data route matches this tool, market and filters. Use /help doctor for usage.");
  const routes = choices.map(choice => ({ ...structuredClone(choice), parameterContract: Object.hasOwn(choice.parameters, "properties") ? "declared-parameters" : "scalar-forwarding" }));
  const scope = options.scope ?? "static-declarations";
  const indexVersion = options.indexSignatureVersion ?? AKSHARE_INDEX_SIGNATURE_VERSION;
  const signatureSources = routes.some(route => route.provider === "akshare" && AKSHARE_PUBLIC_INDEX_ENDPOINTS.includes(route.endpoint as typeof AKSHARE_PUBLIC_INDEX_ENDPOINTS[number]))
    ? { akshareIndex: indexVersion } : undefined;
  const notes = [scope === "static-declarations"
    ? "Static declarations only: no settings, credentials, Python, network or endpoint checks. Provider availability and response semantics remain unchecked."
    : "Installed signatures were read from WhyJ's selected Python and local AKShare functions without market requests, settings or credentials. Endpoint availability and response semantics remain unchecked.",
    ...(signatureSources ? [scope === "static-declarations"
      ? `AKShare index names, types, defaults and descriptions were generated from AKShare ${AKSHARE_INDEX_SIGNATURE_VERSION}; the locally installed package may differ. Regenerate the snapshot after upgrading AKShare.`
      : `AKShare index names, types, defaults and descriptions were inspected from installed AKShare ${indexVersion}; compare the packaged snapshot and actual endpoint responses before research.`] : []),
    ...(routes.some(route => route.parameterContract === "scalar-forwarding")
      ? ["scalar-forwarding accepts scalar API arguments but does not declare endpoint-specific names, required fields or defaults. Consult the installed provider API before probing."] : []),
    ...(routes.some(route => route.endpoint === "index_zh_a_hist_min_em")
      ? ["AKShare index_zh_a_hist_min_em exposes only a limited recent intraday window; a valid period and timestamp shape do not prove that older dates are available."] : []),
    ...(routes.some(route => route.endpoint === "index_zh_a_hist" || route.endpoint === "index_zh_a_hist_min_em")
      ? ["AKShare index date formats validate calendar dates; the probe also rejects start dates after end dates using endpoint defaults for omitted fields."] : []),
    ...(routes.some(route => ["daily-series", "news-search", "ticker-news", "stock_news_em", "ecb-fx"].includes(route.endpoint))
      ? ["Daily, news and FX windows require valid YYYY-MM-DD calendar dates with start on or before end; invalid windows are rejected before dependency or endpoint checks."] : []),
    `Probe values must be nonblank strings (up to ${TOOL_PROBE_PARAMETER_RULES.maxStringLength} characters, no controls), finite numbers or booleans; keys follow the shared rules below. Additional semantic checks may still reject a request.`];
  return { success: true, renderAs: "text", message: [`Endpoint schemas: ${tool} · ${market}`, ...routes.map(route => `${route.provider} / ${route.endpoint} · ${route.parameterContract}`),
    ...(routes.length === 1 ? [JSON.stringify(routes[0]!.parameters, null, 2)] : ["Add --provider and/or --endpoint to display one parameter schema; JSON data includes all matching schemas."]),
    ...(options.comparison ? [`Packaged comparison: ${options.comparison.matchesPackaged ? "same fields" : `${options.comparison.changedEndpoints.length} changed endpoints`} · version ${options.comparison.versionMatches ? "matches" : "differs"}`] : []),
    `Shared parameter rules: ${JSON.stringify(TOOL_PROBE_PARAMETER_RULES)}`, ...notes].join("\n"),
    data: { kind: "tool-probe-schemas", scope, tool, market, routes, parameterRules: { ...TOOL_PROBE_PARAMETER_RULES },
      ...(signatureSources ? { signatureSources } : {}), ...(options.comparison ? { comparison: options.comparison } : {}), notes } };
}
