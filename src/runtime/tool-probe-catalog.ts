import { Type, type TSchema } from "typebox";
import { Set as setFormat } from "typebox/format";
import { Check } from "typebox/value";
import { isDailyDate } from "../market/bars.ts";
import { listBuiltinToolCapabilities } from "../tools/registry.ts";
import { akshareFundEndpointParameters } from "../tools/akshare-fund-endpoint-tools.ts";
import { akshareIndexEndpointParameters } from "./akshare-index-parameters.ts";
import type { DataMarket } from "../types/data-readiness.ts";
import type { ToolProvider } from "../types/tool-capabilities.ts";
import type { ToolProbeRequest } from "../types/tool-probe.ts";

export interface ToolProbeChoice { provider: ToolProvider; endpoint: string; parameters: TSchema }
const text = () => Type.String({ minLength: 1 });
const DAILY_DATE_FORMAT = "whyj-daily-date";
setFormat(DAILY_DATE_FORMAT, isDailyDate);
const day = () => Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", format: DAILY_DATE_FORMAT, description: "Valid YYYY-MM-DD calendar date" });
const DAILY_PARAMS = Type.Object({ symbol: text(), start: day(), end: day() }, { additionalProperties: false });
const FX_PARAMS = Type.Object({ base: Type.String({ pattern: "^[A-Z]{3}$" }), quote: Type.String({ pattern: "^[A-Z]{3}$" }), start: day(), end: day() }, { additionalProperties: false });

/** Static declarations shared by execution, parameter editors and offline discovery. */
export function toolProbeChoices(toolName: string, market: DataMarket): ToolProbeChoice[] {
  const tool = listBuiltinToolCapabilities().find(item => item.name === toolName && item.enabled);
  if (!tool) return [];
  return tool.requirements.routes.filter(route => route.markets.includes(market) && route.provider !== "local").flatMap(route => {
    if (tool.requirements.capability === "daily-bars" || route.endpoints?.includes("daily-series")) return [{ provider: route.provider, endpoint: "daily-series", parameters: DAILY_PARAMS }];
    if (route.provider === "yahoo" || route.endpoints?.includes("stock_news_em")) return (route.endpoints ?? []).map(endpoint => ({ provider: route.provider, endpoint, parameters: DAILY_PARAMS }));
    if (route.provider === "frankfurter") return [{ provider: route.provider, endpoint: "ecb-fx", parameters: FX_PARAMS }];
    if (route.provider === "sina") return [{ provider: route.provider, endpoint: "index-quotes", parameters: Type.Object({ symbol: text() }, { additionalProperties: false }) }];
    return (route.endpoints ?? []).map(endpoint => {
      const parameters = route.provider === "tushare" ? Type.Object({ keyword: text() }, { additionalProperties: false })
        : route.provider === "akshare" ? akshareIndexEndpointParameters(endpoint) ?? akshareFundEndpointParameters(endpoint) : undefined;
      if (!parameters) throw new Error(`Missing endpoint parameter declaration: ${route.provider} / ${endpoint}`);
      return { provider: route.provider, endpoint, parameters };
    });
  });
}

export const TOOL_PROBE_PARAMETER_RULES = Object.freeze({ maxProperties: 30, keyPattern: "^[a-z][a-z0-9_]*$",
  forbiddenKeyPattern: "token|secret|password|credential|api_key|url", keyPatternFlags: "i",
  maxStringLength: 512, forbiddenStringPattern: "[\\x00-\\x1f\\x7f]", nonBlankStrings: true, finiteNumbers: true });

export function validToolProbeParameters(schema: TSchema, params: ToolProbeRequest["params"]): boolean {
  const rules = TOOL_PROBE_PARAMETER_RULES;
  return !!params && typeof params === "object" && !Array.isArray(params) && Object.keys(params).length <= rules.maxProperties
    && Object.entries(params).every(([key, value]) => new RegExp(rules.keyPattern, rules.keyPatternFlags).test(key) && !new RegExp(rules.forbiddenKeyPattern, rules.keyPatternFlags).test(key)
      && (typeof value === "string" ? value.trim().length > 0 && value.length <= rules.maxStringLength && !new RegExp(rules.forbiddenStringPattern).test(value)
        : typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))) && Check(schema, params);
}
