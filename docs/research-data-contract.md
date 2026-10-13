# Research daily-bar contracts and price-volume calculations

This is the foundation for evidence-based research, not a trading strategy or buy-point qualification system. The existing CLI/TUI and tools continue using their current APIs. New research callers explicitly use the APIs below.

Completed-session validation in this first implementation is restricted to market A, using the supplied exchange calendar and Shanghai closing boundary. Other markets are refused rather than assigned A-share session rules.

## Ownership and public APIs

- `src/types/research-data.ts`: shared `DailyBarDataset`, `ResearchContext` and selection DTOs, independent of runtime/providers.
- `src/source/index.ts`: exports `fetchResearchBars`, a direct provider pull with fallback attribution and atomic provenance. No storage dependency or cache fallback.
- `src/runtime/source-runtime.ts`: exports a settings-backed `fetchResearchBars` wrapper. This binds credentials/preferences and returns the source dataset without modifying evidence.
- `src/quant/index.ts`: exports `selectCompletedBars`, `analyzePriceVolume`, `relativeStrength` and the low-level ATR/volume/location calculations. No network or storage dependency.
- `src/storage/src/bars.ts`: newer observations replace same-date cached bars; unmodified historical dates are retained and sorted. Cached legacy bars do not acquire research evidence through this update.

The `source` and `quant` public entry points are extended so consumers do not import their internals. Existing tools and their registry are unchanged in this first implementation.

## Data and time contract

A dataset carries symbol, market, actual provider, bars, `fetchedAt`, optional underlying `marketAt`, adjustment evidence, units, and per-date finality evidence. Evidence includes source and timezone-aware `verifiedAt`.

- `fetchedAt` is when this program received the response, not the underlying market timestamp.
- `marketAt=null` explicitly means the provider did not supply the underlying timestamp. It is never substituted with `fetchedAt`.
- Adjustment is `raw`, `qfq`, `hfq` or `unknown`. No corporate-action basis is inferred from a price array or `adjClose` alone.
- Volume units are shares/lots/units/unknown; amount is CNY/unknown. Unknown units cannot pass the dataset-aware price-volume summary. Provider adapters must normalize or attest units.
- Finality is final/partial/unknown per session. Historical dates and a fresh HTTP request do not themselves prove finality.

An optional `BarProviderAdapter.fetchDataset(request)` returns bars and evidence together. Without it, the legacy `fetchBars` path produces unknown adjustment/units, null market time and no finality attestations. Current built-in providers use that conservative legacy path. Consequently, default research pulls are inspectable but cannot yet produce verified closed-bar metrics. A source-backed calendar and evidence-aware provider adapter are required; this implementation does not fabricate them.

`ResearchContext` requires an Asia/Shanghai `asOf` with `+08:00` and a sourced, ordered, unique exchange-session window ending at `lastCompletedSession`. During intraday/lunch analysis that endpoint is a prior completed session; on a non-trading day it is the verified previous session. Do not synthesize weekdays as an exchange calendar. The calendar must be known by `asOf` and verified no earlier than the final session's close.

`selectCompletedBars` validates dates, provenance and adjustment before selecting bars. It excludes invalid OHLCV, dates outside the supplied calendar, partial/unknown finality and future confirmations. OHLC must be positive and geometrically consistent, activity non-negative. Finality evidence must be dated after session close, before retrieval and no later than `asOf`. The latest completed bar must be present; if supplied, `marketAt` cannot precede its close. Exclusion reasons and insufficiency issues remain visible.

This checks supplied evidence consistency, not independent vendor truth, calendar authenticity or historical point-in-time corporate-action data. Later retrieval cannot be used to claim information was available before the analysis timestamp. An archived point-in-time dataset is needed for retrospective validation.

## Calculation conventions

| API | Convention |
|---|---|
| `relativeStrength(stock, benchmark, context, N)` | `(stock_return - benchmark_return) * 100`, in percentage points. Requires both endpoints and every session in the last N+1 calendar window. No zero fill, carry-forward or extension to older common dates. Requires the same market and declared adjustment basis. |
| `atr(bars, N=14, smoothing="wilder")` | True range is max(high-low, abs(high-prevClose), abs(low-prevClose)). First bar supplies previous close only. First ATR at index N averages N ranges. Subsequent Wilder values use `(previous*(N-1)+TR)/N`; SMA uses a rolling N-range mean. |
| `closeLocationEfficiency(bar)` | `(close-low)/(high-low)`. Zero range returns null. |
| `precedingVolumeRatio(bars, N=20)` | Latest volume divided by the median of the preceding N bars, excluding latest. Insufficient history or zero baseline returns null. This is a daily ratio, not same-minute intraday volume normalization. |
| `medianTradedAmount(bars, N=20)` | Median of the last N amounts, including latest completed bar. Low-level function returns provider numeric units; callers must verify CNY before labeling it CNY. |

Low-level array functions validate bars and windows but do not prove finality. Prefer dataset-aware APIs for research. `analyzePriceVolume` uses the contiguous verified suffix ending at the last completed session, requires enough observations, and refuses unknown units. It preserves the available Wilder initialization history and reports `historyStart`/`historyObservations` for reproducibility; an unverified gap is never bridged.

## Calling the foundation

```ts
import { fetchResearchBars } from "../src/runtime/source-runtime.ts";
import { analyzePriceVolume, relativeStrength } from "../src/quant/index.ts";
import type { ResearchContext } from "../src/types/research-data.ts";

// context must come from verified calendar data; no built-in calendar feed is assumed.
async function research(context: ResearchContext) {
  const stock = await fetchResearchBars("600000.SH", "A");
  const benchmark = await fetchResearchBars("000300.SH", "A");
  if (!stock.dataset || !benchmark.dataset) return { status: "data_insufficient" };
  return {
    priceVolume: analyzePriceVolume(stock.dataset, context),
    rs: [5, 10, 20, 60].map((period) => relativeStrength(stock.dataset!, benchmark.dataset!, context, period)),
    attempts: { stock: stock.attempts, benchmark: benchmark.attempts },
  };
}
```

No new slash command, auto report, portfolio persistence or trading action follows from these APIs. Tests use synthetic evidence and deterministic price paths, validating calculation/refusal behavior rather than profitability.
