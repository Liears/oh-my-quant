/** Provider-owned OAuth payload; extra fields include account IDs or provider endpoints. */
export interface ModelOAuthCredential {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}

export function validateModelOAuthCredential(value: unknown): ModelOAuthCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid model OAuth credential.");
  const row = value as Record<string, unknown>;
  if (row.type !== "oauth" || typeof row.access !== "string" || !row.access || typeof row.refresh !== "string" || !row.refresh
    || /[\x00-\x1f\x7f]/.test(row.access + row.refresh) || typeof row.expires !== "number" || !Number.isFinite(row.expires) || row.expires < 0) {
    throw new Error("Invalid model OAuth credential.");
  }
  return structuredClone(row) as ModelOAuthCredential;
}

export function isModelOAuthId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}
