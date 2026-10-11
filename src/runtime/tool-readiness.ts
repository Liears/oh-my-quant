import { listBuiltinToolCapabilities } from "../tools/registry.ts";
import type { OhQuantSettings } from "../types/config.ts";
import type { ToolCapabilityManifest, ToolReadiness, ToolReadinessEvidence, ToolRouteReadiness } from "../types/tool-capabilities.ts";

export { listBuiltinToolCapabilities } from "../tools/registry.ts";

/** Pure projection: inspecting the registry does not send network requests or execute tools. */
export function inspectToolReadiness(settings: OhQuantSettings, evidence: ToolReadinessEvidence,
  processEnv: Record<string, string | undefined> = process.env, manifest = listBuiltinToolCapabilities()): ToolReadiness[] {
  const env = { ...processEnv, ...settings.env };
  return manifest.map(tool => {
    const routes: ToolRouteReadiness[] = tool.requirements.routes.map(route => {
      const result = (status: ToolRouteReadiness["status"], reason: string, action: string): ToolRouteReadiness => ({ provider: route.provider, status, reason, action });
      if (!tool.enabled) return result("blocked", "Tool disabled", "Enable this tool before use.");
      if (!route.markets.includes(evidence.market)) return result("blocked", `Not supported for ${evidence.market}`, `Choose market ${route.markets.join(" / ")}.`);
      const engine = tool.requirements.engine;
      if (engine && !env[engine.configurationKey]?.trim()) return result("blocked", `Missing ${engine.configurationKey}`, "Configure the pinned Python environment, then call alpha_engine_status.");
      if (route.credential && !env[route.credential]?.trim()) return result("blocked", `Missing ${route.credential}`, "Configure this provider's credential in Data connection.");
      const python = evidence.python ?? (evidence.data?.source === "akshare" ? evidence.data.dependency : undefined);
      if (route.dependencies.length && python?.status !== "ready") {
        return python ? result("blocked", python.status, python.status === "missing-python" ? "Install Python 3, then retry Tools checks." : "Install akshare in WhyJ's Python environment, then retry Tools checks.")
          : result("unverified", "Python / akshare not checked", "Run Doctor Tools checks.");
      }
      if (engine) return result("unverified", `${engine.name} ${engine.version} import/version not checked here`, "Call alpha_engine_status; price endpoint checks establish only the separate data dependency.");
      if (route.provider === "local") return result("local", "No market provider required; tool not executed", tool.requirements.limitations);
      const data = evidence.data;
      if (tool.requirements.capability === "daily-bars" && data && data.source === route.provider && data.market === evidence.market) {
        return data.status === "ready" ? result("sample-verified", `${data.symbol} · ${data.rowCount} rows · ${data.start} to ${data.end}`, "Only this input sample was checked; validate each actual tool request.")
          : data.status === "cancelled" ? result("unverified", "Data sample cancelled", "Retry the data check.")
            : result("blocked", `Data sample: ${data.status}`, data.action);
      }
      return result("unverified", "Endpoint permission / response not checked", route.permission);
    });
    let status: ToolReadiness["status"] = routes.some(route => route.status === "sample-verified") ? "sample-verified"
      : routes.some(route => route.status === "local") ? "local"
        : routes.some(route => route.status === "unverified") ? "unverified" : "blocked";
    if (tool.requirements.capability === "news-research") {
      const available = (news: boolean) => tool.requirements.routes.some((route, index) =>
        Boolean(route.endpoints?.some(endpoint => endpoint === "news-search" || endpoint === "ticker-news" || endpoint === "stock_news_em")) === news && routes[index]?.status !== "blocked");
      if (!available(true) || !available(false)) status = "blocked";
    }
    const data = evidence.data;
    return { name: tool.name, label: tool.label, capability: tool.requirements.capability, status, routes, limitations: tool.requirements.limitations,
      ...(status === "sample-verified" && data ? { sample: { source: data.source, market: data.market, symbol: data.symbol, start: data.start, end: data.end,
        rowCount: data.rowCount, asOfDate: data.asOfDate, observedAt: data.observedAt } } : {}) };
  });
}

export function toolReadinessSummary(entries: readonly ToolReadiness[]): string {
  return `${entries.length} tools · ${entries.filter(entry => entry.status === "blocked").length} blocked · ${entries.filter(entry => entry.status === "sample-verified").length} sample inputs verified · endpoint permissions remain scoped`;
}

export function capabilityInputSummary(tool: ToolCapabilityManifest): string {
  const required = Array.isArray(tool.parameters.required) ? tool.parameters.required.filter((key): key is string => typeof key === "string") : [];
  return required.length ? `Required inputs: ${required.join(", ")}` : "No required inputs; inspect optional parameters before use.";
}
