type DecimalOperand = number | { difference: readonly [number, number] } | { product: readonly number[] };

/** Interpret the input's decimal spelling, as the fixed Python CLI's Decimal(str(value)) does. */
function fraction(value: DecimalOperand): [bigint, bigint] {
  if (typeof value !== "number") {
    if ("difference" in value) {
      const [a, ad] = fraction(value.difference[0]), [b, bd] = fraction(value.difference[1]);
      return [a * bd - b * ad, ad * bd];
    }
    return value.product.reduce<[bigint, bigint]>(([n, d], factor) => {
      const [fn, fd] = fraction(factor); return [n * fn, d * fd];
    }, [1n, 1n]);
  }
  const [digits, exponent = "0"] = value.toString().split("e");
  const places = (digits!.split(".")[1]?.length ?? 0) - Number(exponent);
  const units = BigInt(digits!.replace(".", ""));
  return places >= 0 ? [units, 10n ** BigInt(places)] : [units * 10n ** BigInt(-places), 1n];
}

/** Account * percent / 100 / divisor, floored before converting the decimal quantity to Number. */
export function floorPositionShares(account: number, percent: DecimalOperand, divisor: DecimalOperand,
  fractional: boolean, precision: number): number {
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) return NaN;
  const [a, ad] = fraction(account), [p, pd] = fraction(percent), [v, vd] = fraction(divisor);
  const scale = 10n ** BigInt(fractional ? precision : 0);
  const numerator = a * p * vd * scale, denominator = ad * pd * 100n * v;
  if (denominator <= 0n) return NaN;
  let quantity = numerator / denominator;
  if (fractional && numerator < 0n && numerator % denominator !== 0n) quantity -= 1n;
  if (!fractional || precision === 0) return Number(quantity);
  const digits = (quantity < 0n ? -quantity : quantity).toString().padStart(precision + 1, "0");
  return Number(`${quantity < 0n ? "-" : ""}${digits.slice(0, -precision)}.${digits.slice(-precision)}`);
}
