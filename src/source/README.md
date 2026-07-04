# Source Module

`src/source/` owns market data provider access for WhyJ Quant.

## Layout

- `src/source/index.ts`
  - public entrypoint for the rest of the app
- `src/source/src/`
  - provider adapters and cross-provider orchestration
- `src/source/tests/`
  - regression and module behavior tests

## Responsibilities

- normalize configured source selection
- fetch bars from AKShare, Tushare, LLMQuant, and Financial Datasets
- fall back across providers when one source is empty, stale, or unavailable
- merge provider results with cache behavior only through injectable runtime deps
- expose source attribution metadata for TUI Overview

## Internal module split

| File | Responsibility |
|------|----------------|
| `src/source/src/source-contracts.ts` | shared source DTOs, runtime deps, provider options, and attribution labels |
| `src/source/src/source-providers.ts` | provider registry, symbol normalization, fallback order, and symbol search |
| `src/source/src/sources.ts` | cache-aware fetch facade and live fetch attribution over provider pulls |
| `src/source/src/akshare.ts` | AKShare fetch orchestration and compatibility re-exports |
| `src/source/src/akshare-types.ts` | AKShare DTOs shared by parser, client, and tools |
| `src/source/src/akshare-normalize.ts` | AKShare payload parsers and row normalizers |
| `src/source/src/akshare-python.ts` | Python interpreter discovery and subprocess execution |
| `src/source/src/akshare-scripts.ts` | Python script payloads used by AKShare subprocess calls |
| `src/source/src/akshare-endpoints.ts` | AKShare public endpoint whitelists and endpoint types |
| `src/source/src/sina-index-client.ts` | Sina A-index quote fallback client |
| `src/source/src/tushare.ts` | Tushare-backed fetch |
| `src/source/src/llmquant.ts` | LLMQuant-backed market fetch |
| `src/source/src/financial-datasets.ts` | Financial Datasets-backed fetch |
| `src/source/src/http.ts` | shared HTTP helpers and transport defaults |

## Import rules

1. External callers import from `src/source/index.ts`.
2. Tests may import deep module paths when they are targeting one adapter directly.
3. Cross-provider policy belongs in `source-providers.ts`, not in individual adapters.
4. Provider-specific parsing or transport logic stays in the adapter file.
5. Raw provider adapters do not import storage; callers pass explicit provider options or rely on canonical environment variables.
6. Storage-backed cache/settings defaults live in `src/runtime/source-runtime.ts`, not in this module.

## Test rules

- put provider parsing tests in `src/source/tests/`
- when a live-source bug causes Overview to show empty quotes or wrong source labels, add a regression test in `sources.test.ts`
- keep tests deterministic; mock provider adapters instead of hitting network paths

## Related docs

- [Module Architecture](../../docs/module-architecture.md)
- [Source Providers](../../docs/source-data-providers.md)
- [OhQuant Storage Policy](../../docs/ohquant-storage-policy.md)
