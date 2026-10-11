/** Safe, short provider method name; never persist a URL, header, or credential here. */
export function isSafeProviderEndpoint(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value);
}
