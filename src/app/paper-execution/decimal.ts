const SCALE = 10n ** 18n;
const DECIMAL = /^(0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;

/** Exact decimal amounts with at most 18 fractional places. Paper fills never round money. */
export function parseDecimal(text: string): bigint {
  if (typeof text !== "string" || !DECIMAL.test(text)) throw new Error("Invalid paper decimal");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(18, "0") || "0");
}

export function formatDecimal(value: bigint): string {
  if (value < 0n) throw new Error("Negative paper balance");
  const whole = value / SCALE;
  if (whole.toString().length > 30) throw new Error("Paper amount exceeds decimal range");
  const fraction = (value % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function multiplyDecimal(left: bigint, right: bigint): bigint {
  const product = left * right;
  if (product % SCALE !== 0n) throw new Error("Paper amount requires rounding");
  return product / SCALE;
}
