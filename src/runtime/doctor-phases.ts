export function parseDoctorPhases(value: unknown): Array<"model" | "tools" | "data"> | undefined {
  if (value === undefined) return;
  const parts = typeof value === "string" ? value.trim().toLowerCase().split(/[,\s]+/).filter(Boolean) : [];
  if (!parts.length || parts.some(part => part !== "model" && part !== "tools" && part !== "data")) {
    throw new Error("--phase requires model, tools or data, separated by commas. No diagnostics were started.");
  }
  return [...new Set(parts)] as Array<"model" | "tools" | "data">;
}
