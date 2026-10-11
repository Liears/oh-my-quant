/** Shared visual tokens for the frame-buffer TUI and HTML artifacts. */
export const WHYJ_THEME = {
  gold: "#D4AF37",
  goldHighlight: "#E2BE4D",
  cashDark: "#947618",
  cashWarm: "#F0D77A",
  cream: "#F5F5F5",
  muted: "#A6A6A6",
  bodyCopy: "#F5F5F5",
  authorCopy: "#A6A6A6",
  hairline: "#242424",
  stepDim: "#242424",
  positive: "#1E9F4D",
  negative: "#E5494D",
  marketUp: "#E5494D",
  marketDown: "#1E9F4D",
  codeDim: "#7A7368",
  thinking: "#7F807D",
  canvas: "#0B0B0C",
  selectionFg: "#0B0B0C",
  selectionBg: "#D4AF37",
} as const;

/** One explicit convention for all markets in a workspace, including mixed portfolios. */
export type MarketColorScheme = "red-up" | "green-up";

export function normalizeMarketColorScheme(value: unknown): MarketColorScheme {
  return value === "green-up" ? "green-up" : "red-up";
}

export function marketColors(scheme?: MarketColorScheme) {
  return scheme === "green-up"
    ? { up: WHYJ_THEME.marketDown, down: WHYJ_THEME.marketUp, neutral: WHYJ_THEME.muted }
    : { up: WHYJ_THEME.marketUp, down: WHYJ_THEME.marketDown, neutral: WHYJ_THEME.muted };
}

export function marketColorLabel(scheme?: MarketColorScheme): string {
  return scheme === "green-up" ? "Green up / Red down" : "Red up / Green down";
}
