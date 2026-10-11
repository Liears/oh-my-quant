/** An exact UTC instant for an application-observation boundary, never a provider publication claim. */
export function validateObservationCutoff(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    throw new Error("Observation cutoff must be an exact UTC instant (YYYY-MM-DDTHH:mm:ss.sssZ).");
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value)
    throw new Error("Observation cutoff must be a real UTC instant.");
  return instant;
}
