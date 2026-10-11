import { isDeepStrictEqual } from "node:util";
import { runPython, AKSHARE_PUBLIC_INDEX_ENDPOINTS, type AksharePublicIndexEndpoint } from "../source/index.ts";
import { AKSHARE_INDEX_SIGNATURES, AKSHARE_INDEX_SIGNATURE_VERSION } from "./akshare-index-signatures.generated.ts";
import { akshareIndexParametersFromSignature, type AkshareIndexEndpointSignature, type AkshareIndexSignatureParameter } from "./akshare-index-parameters.ts";
import { toolProbeChoices, TOOL_PROBE_PARAMETER_RULES } from "./tool-probe-catalog.ts";
import { toolProbeSchemaResult } from "./tool-probe-schema.ts";
import type { DataMarket } from "../types/data-readiness.ts";
import type { CommandResult, ParsedCommand } from "../types/commands.ts";

const INSPECT_SCRIPT = String.raw`
import inspect, json, re, sys
try:
    import akshare as ak
except ImportError:
    print(json.dumps({"status": "missing-package"}))
    sys.exit(0)

names = json.loads(sys.argv[1])
def parameter_description(docstring, name):
    prefix = ":param " + name + ":"
    lines = docstring.splitlines()
    for index, line in enumerate(lines):
        if not line.startswith(prefix):
            continue
        parts = [line[len(prefix):].strip()]
        for following in lines[index + 1:]:
            if re.match(r"^\s*:[a-zA-Z][a-zA-Z0-9_]*(?:\s|:)", following):
                break
            if following.strip():
                parts.append(following.strip())
        return " ".join(" ".join(parts).split())[:512]
    return ""

signatures = {}
for endpoint in names:
    fn = getattr(ak, endpoint, None)
    if not callable(fn):
        print(json.dumps({"status": "missing-endpoint", "endpoint": endpoint}))
        sys.exit(0)
    fields = {}
    for param in inspect.signature(fn).parameters.values():
        if param.kind not in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY):
            print(json.dumps({"status": "unsupported-parameter", "endpoint": endpoint}))
            sys.exit(0)
        annotation, default = param.annotation, param.default
        if annotation is str or annotation == "str" or isinstance(default, str):
            kind = "string"
        elif annotation is bool or annotation == "bool" or isinstance(default, bool):
            kind = "boolean"
        elif annotation is int or annotation == "int" or type(default) is int:
            kind = "integer"
        elif annotation is float or annotation == "float" or type(default) is float:
            kind = "number"
        else:
            print(json.dumps({"status": "unsupported-parameter", "endpoint": endpoint}))
            sys.exit(0)
        spec = {"type": kind, "required": default is inspect.Parameter.empty}
        if default is not inspect.Parameter.empty and default is not None:
            spec["default"] = default
        description = parameter_description(inspect.getdoc(fn) or "", param.name)
        if description:
            spec["description"] = description
        fields[param.name] = spec
    signatures[endpoint] = {"parameters": fields}
print(json.dumps({"status": "ready", "version": str(getattr(ak, "__version__", "unknown")), "signatures": signatures}, ensure_ascii=False))
`;

export interface InstalledAkshareIndexSignatures {
  version: string;
  signatures: Record<string, AkshareIndexEndpointSignature>;
}
export type AkshareIndexInspector = (endpoints: string[], signal?: AbortSignal) => Promise<InstalledAkshareIndexSignatures>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Imports local Python code only; every requested name is checked against the public whitelist. */
export const inspectInstalledAkshareIndexSignatures: AkshareIndexInspector = async (endpoints, signal) => {
  if (!endpoints.length || endpoints.some(endpoint => !AKSHARE_PUBLIC_INDEX_ENDPOINTS.includes(endpoint as AksharePublicIndexEndpoint)))
    throw new Error("unsupported-endpoint");
  const { stdout } = await runPython(INSPECT_SCRIPT, [JSON.stringify(endpoints)], { signal, timeoutMs: 15_000 });
  const payload: unknown = JSON.parse(stdout.trim());
  if (!isRecord(payload) || payload.status !== "ready") {
    if (isRecord(payload) && payload.status === "missing-package") throw new Error("missing-package");
    if (isRecord(payload) && payload.status === "missing-endpoint") throw new Error("missing-endpoint");
    throw new Error("unsupported-signature");
  }
  if (typeof payload.version !== "string" || !payload.version.trim() || !isRecord(payload.signatures))
    throw new Error("invalid-signature-response");
  const responseSignatures = payload.signatures;
  if (Object.keys(responseSignatures).length !== endpoints.length || endpoints.some(endpoint => !Object.hasOwn(responseSignatures, endpoint)))
    throw new Error("invalid-signature-response");
  const signatures: Record<string, AkshareIndexEndpointSignature> = {};
  for (const endpoint of endpoints) {
    const value = responseSignatures[endpoint];
    if (!isRecord(value) || !isRecord(value.parameters) || Object.keys(value.parameters).length > TOOL_PROBE_PARAMETER_RULES.maxProperties)
      throw new Error("invalid-signature-response");
    const parameters: Record<string, AkshareIndexSignatureParameter> = {};
    for (const [name, input] of Object.entries(value.parameters)) {
      if (!new RegExp(TOOL_PROBE_PARAMETER_RULES.keyPattern, "i").test(name) || !isRecord(input)
        || !["string", "integer", "number", "boolean"].includes(String(input.type)) || typeof input.required !== "boolean"
        || input.description !== undefined && (typeof input.description !== "string" || input.description.length > 512)
        || input.default !== undefined && (typeof input.default !== (input.type === "string" ? "string" : input.type === "boolean" ? "boolean" : "number")
          || typeof input.default === "number" && !Number.isFinite(input.default))) throw new Error("invalid-signature-response");
      parameters[name] = { type: input.type as AkshareIndexSignatureParameter["type"], required: input.required,
        ...(input.default !== undefined ? { default: input.default as string | number | boolean } : {}),
        ...(typeof input.description === "string" ? { description: input.description } : {}) };
    }
    signatures[endpoint] = { parameters };
  }
  return { version: payload.version, signatures };
};

/** Explicitly reads installed signatures while leaving ordinary --schema offline and synchronous. */
export async function installedAkshareIndexSchemaResult(flags: ParsedCommand["flags"], positional: string[], options: {
  signal?: AbortSignal;
  inspect?: AkshareIndexInspector;
} = {}): Promise<CommandResult> {
  if (flags.installed !== true) return { success: false, message: "Use --schema --installed together." };
  const { installed: _installed, ...staticFlags } = flags;
  const declaration = toolProbeSchemaResult(staticFlags, positional);
  if (!declaration.success) return declaration;
  const { tool, market, provider, endpoint } = staticFlags;
  const choices = toolProbeChoices(tool as string, market as DataMarket).filter(choice => (provider === undefined || choice.provider === provider)
    && (endpoint === undefined || choice.endpoint === endpoint));
  if (choices.some(choice => choice.provider !== "akshare" || !AKSHARE_PUBLIC_INDEX_ENDPOINTS.includes(choice.endpoint as AksharePublicIndexEndpoint)))
    return { success: false, message: "--installed applies only to AKShare index routes; add --provider akshare and/or --endpoint." };
  if (options.signal?.aborted) return { success: false, message: "Installed schema check cancelled." };
  let installed: InstalledAkshareIndexSignatures;
  try { installed = await (options.inspect ?? inspectInstalledAkshareIndexSignatures)([...new Set(choices.map(choice => choice.endpoint))], options.signal); }
  catch (error) {
    if (options.signal?.aborted) return { success: false, message: "Installed schema check cancelled." };
    const cause = error instanceof Error ? error.message : "";
    return { success: false, message: cause === "missing-package" ? "AKShare is not installed in WhyJ's selected Python. Run /doctor --phase tools."
      : cause === "missing-endpoint" ? "The installed AKShare package lacks a declared index endpoint. Review its version and regenerate signatures."
        : "Could not inspect installed AKShare index signatures. Run /doctor --phase tools and retry." };
  }
  if (options.signal?.aborted) return { success: false, message: "Installed schema check cancelled." };
  const changedEndpoints = choices.filter(choice => !isDeepStrictEqual(installed.signatures[choice.endpoint],
    AKSHARE_INDEX_SIGNATURES[choice.endpoint as AksharePublicIndexEndpoint])).map(choice => choice.endpoint);
  const liveChoices = choices.map(choice => ({ ...choice, parameters: akshareIndexParametersFromSignature(choice.endpoint, installed.signatures[choice.endpoint]!) }));
  return toolProbeSchemaResult(staticFlags, positional, { choices: liveChoices, scope: "installed-signatures", indexSignatureVersion: installed.version,
    comparison: { packagedVersion: AKSHARE_INDEX_SIGNATURE_VERSION, versionMatches: installed.version === AKSHARE_INDEX_SIGNATURE_VERSION,
      matchesPackaged: changedEndpoints.length === 0, changedEndpoints } });
}
