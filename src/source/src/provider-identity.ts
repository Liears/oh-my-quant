/** Reject an explicit provider ticker that does not identify the requested instrument. */
export function assertDeclaredTicker(candidate: unknown, requested: string): void {
  if (candidate !== undefined && (typeof candidate !== "string" || candidate.trim().toUpperCase() !== requested.toUpperCase())) {
    throw new Error("Provider identity mismatch");
  }
}
