/** A parsed result observed during one dashboard scan and fixed in its tool transcript. */
export interface BenchmarkResultSnapshot {
  filename: string;
  /** SHA-256 of JSON.stringify(result), excluding insignificant file formatting. */
  revision: string;
  result: Record<string, unknown>;
}
