export function textValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export function formatCell(value: unknown, maxLength = 30): string {
  const text = typeof value === "number" && Number.isFinite(value)
    ? Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "")
    : textValue(value);
  if (!text) return "--";
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

export function outputLimit(value: unknown, defaultValue = 20, max = 100): number {
  const n = Number(value ?? defaultValue);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

export function formatParamLine(params: Record<string, unknown>, maxCellLength = 30): string {
  return Object.entries(params)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${formatCell(value, maxCellLength)}`)
    .join("  ");
}

export function selectPreviewFields(
  rows: Record<string, unknown>[],
  priority: string[],
  maxFields: number,
): string[] {
  const available = new Set(rows.flatMap((row) => Object.keys(row)));
  const fields = priority.filter((field) => available.has(field));
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!fields.includes(key)) fields.push(key);
      if (fields.length >= maxFields) return fields;
    }
  }
  return fields.slice(0, maxFields);
}

export function formatRecordPreview(
  rows: Record<string, unknown>[],
  priority: string[],
  options: {
    maxFields: number;
    maxRows?: number;
    cellMaxLength?: number;
  },
): string[] {
  if (rows.length === 0) return ["Preview    --"];
  const fields = selectPreviewFields(rows, priority, options.maxFields);
  const previewRows = options.maxRows == null ? rows : rows.slice(0, options.maxRows);
  return [
    `Columns    ${fields.join(", ")}`,
    ...previewRows.map((row, index) => {
      const values = fields.map((field) => `${field}=${formatCell(row[field], options.cellMaxLength)}`).join("  ");
      return `${String(index + 1).padStart(2, "0")}         ${values}`;
    }),
  ];
}
