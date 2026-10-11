import { Type, type TSchema } from "typebox";
import type { AksharePublicIndexEndpoint } from "../source/index.ts";
import { AKSHARE_INDEX_SIGNATURES } from "./akshare-index-signatures.generated.ts";
import { akshareIndexStringConstraints } from "./akshare-index-semantics.ts";

export interface AkshareIndexSignatureParameter {
  type: "string" | "number" | "integer" | "boolean";
  required: boolean;
  default?: string | number | boolean;
  description?: string;
}
export interface AkshareIndexEndpointSignature {
  parameters: Record<string, AkshareIndexSignatureParameter>;
}
const schemas = new Map<string, TSchema>();

/** Converts either the packaged snapshot or a local installed signature to one probe schema. */
export function akshareIndexParametersFromSignature(endpoint: string, signature: AkshareIndexEndpointSignature): TSchema {
  const fields: Record<string, TSchema> = {};
  for (const [name, parameter] of Object.entries(signature.parameters)) {
    const options = { ...(parameter.description ? { description: parameter.description } : {}),
      ...(parameter.default !== undefined ? { default: parameter.default } : {}) };
    const field = parameter.type === "string" ? Type.String({ ...options, ...akshareIndexStringConstraints(endpoint, name, parameter) })
      : parameter.type === "integer" ? Type.Integer(options)
        : parameter.type === "number" ? Type.Number(options) : Type.Boolean(options);
    fields[name] = parameter.required ? field : Type.Optional(field);
  }
  return Type.Object(fields, { additionalProperties: false });
}

/** Offline schema generated from the same public endpoint whitelist used by the adapter. */
export function akshareIndexEndpointParameters(endpoint: string): TSchema | undefined {
  if (!Object.hasOwn(AKSHARE_INDEX_SIGNATURES, endpoint)) return undefined;
  const cached = schemas.get(endpoint);
  if (cached) return cached;
  const signature = AKSHARE_INDEX_SIGNATURES[endpoint as AksharePublicIndexEndpoint] as AkshareIndexEndpointSignature;
  const schema = akshareIndexParametersFromSignature(endpoint, signature);
  schemas.set(endpoint, schema);
  return schema;
}
