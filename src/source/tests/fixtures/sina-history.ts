/** Synthetic Sina daily packets with independently specified OHLC/volume deltas. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function sinaPacket(format: 1479 | 3466 = 3466, count = 2): string {
  const bits: number[] = [];
  const write = (value: number, width: number) => {
    const unsigned = value < 0 ? value + 2 ** width : value;
    for (let i = 0; i < width; i++) bits.push(Math.floor(unsigned / 2 ** i) % 2);
  };
  const day = Date.parse("2025-01-06T00:00:00Z") / 86400_000 - 7657;
  write(format, 12); write(63, 6);
  if (format === 1479) {
    write(2, 6); write(day, 18); write(0, 3); write(0, 3);
    for (let row = 0; row < count; row++) {
      write(32, 6); write(47, 6); write(3, 3); write(5, 3);
      write(row ? 5 : 100, 12); write(10, 12); write(10, 12); write(5, 12); write(100, 18);
    }
  } else {
    for (let row = 0; row < count; row++) {
      if (!row) {
        // Control packet: explicit date, unchanged precisions and value widths.
        for (const bit of [1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1]) write(bit, 1);
        write(1, 3); write(day, 18); write(0, 1);
      } else write(0, 1);
      write(row ? 5 : 100, 9); write(10, 9); write(10, 9); write(5, 9); write(100, 15); write(0, 15);
    }
    for (const bit of [1, 1, 0, 0, 0]) write(bit, 1); // Explicit end-of-stream sentinel.
  }
  while (bits.length % 6) bits.push(0);
  let encoded = "";
  for (let i = 0; i < bits.length; i += 6) encoded += ALPHABET[bits.slice(i, i + 6).reduce((sum, bit, offset) => sum + bit * 2 ** offset, 0)];
  return encoded;
}
export function sinaDeclaration(code: string, format: 1479 | 3466 = 3466, count = 2): string {
  return `var KLC_K2_${code}="${sinaPacket(format, count)}";`;
}
