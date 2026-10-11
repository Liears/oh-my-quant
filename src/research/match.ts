/** Expected fields must match. Unknown fields are never projected into public output. */
export function matches(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number") return typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, i) => matches(actual[i], value));
  if (expected && typeof expected === "object") return !!actual && typeof actual === "object" && Object.entries(expected).every(([key, value]) => matches((actual as Record<string, unknown>)[key], value));
  return actual === expected;
}
