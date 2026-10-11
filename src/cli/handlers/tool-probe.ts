import { defaultToolProbeRequest, formatToolProbe, probeToolEndpoint, toolProbeChoices } from "../../runtime/tool-probe.ts";
import { DATA_MARKETS } from "../../runtime/data-readiness.ts";
import { toolProbeSchemaResult } from "../../runtime/tool-probe-schema.ts";
import { installedAkshareIndexSchemaResult } from "../../runtime/installed-akshare-index-schema.ts";
import type { OhQuantSettings } from "../../types/config.ts";
import type { DataMarket } from "../../types/data-readiness.ts";
import type { CommandResult } from "../types.ts";

/** Endpoint arguments use their API names; symbol/date strings preserve leading zeros. */
export async function toolProbeDoctor(settings: OhQuantSettings, flags: Record<string, string | number | boolean>, signal?: AbortSignal): Promise<CommandResult> {
  if (flags.installed === true && flags.schema === true) return installedAkshareIndexSchemaResult(flags, [], { signal });
  if (flags.schema !== undefined) return toolProbeSchemaResult(flags, []);
  const market = (flags.market ?? settings.preferences.defaultMarket) as DataMarket;
  if (typeof flags.tool !== "string" || !DATA_MARKETS.includes(market) || flags.phase !== undefined)
    return { success: false, message: "Use /doctor --tool NAME --market A|US|HK|Fund [--provider NAME] [--endpoint NAME] plus endpoint arguments; omit --phase." };
  const request = defaultToolProbeRequest(settings, flags.tool, market);
  if (!request) return { success: false, message: "No public data probe for this tool and market. Inspect Tool capabilities for supported routes." };
  const choice = toolProbeChoices(flags.tool, market).find(choice => choice.provider === (flags.provider ?? request.provider)
    && (flags.endpoint === undefined || choice.endpoint === flags.endpoint));
  if (!choice) return { success: false, message: "The selected provider/endpoint is not declared by this tool for this market." };
  request.provider = choice.provider; request.endpoint = choice.endpoint;
  const properties = ({ ...choice.parameters } as { properties?: Record<string, { type?: string }> }).properties;
  const args = Object.entries(flags).filter(([key]) => !["tool", "market", "provider", "endpoint"].includes(key));
  request.params = Object.fromEntries(args.map(([key, value]) => [key,
    (properties?.[key]?.type === "number" || properties?.[key]?.type === "integer") && typeof value === "string" && value.trim() ? Number(value) : value]));
  const result = await probeToolEndpoint(settings, request, { signal });
  return { success: result.status === "ready", message: formatToolProbe(result), data: result, renderAs: "text" };
}
