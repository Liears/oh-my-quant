export interface SlashArgument { value: string; quoted: boolean }

/** Whole-value quotes group literal text. Backslashes and quotes inside bare words stay literal. */
export function tokenizeSlashArguments(input: string): { tokens: SlashArgument[]; error?: string } {
  const tokens: SlashArgument[] = [];
  let index = 0;
  while (index < input.length) {
    if (/\s/.test(input[index]!)) { index++; continue; }
    const quote = input[index], quoted = quote === '"' || quote === "'";
    if (quoted) {
      const start = ++index;
      while (index < input.length && input[index] !== quote) index++;
      tokens.push({ value: input.slice(start, index), quoted: true });
      if (index === input.length) return { tokens, error: "Unclosed quoted argument; close the matching quote before submitting." };
      index++;
      if (index < input.length && !/\s/.test(input[index]!)) return { tokens, error: "Separate a quoted argument from the next argument with whitespace." };
    } else {
      const start = index;
      while (index < input.length && !/\s/.test(input[index]!)) index++;
      tokens.push({ value: input.slice(start, index), quoted: false });
    }
  }
  return { tokens };
}
