# App repair plan

Agreed on 2026-10-13 against app revision 2ab32b9fd7c25f7793d01406ddf9de6a6d0b1668.

## Delivery order

1. Correct fund/factor answer false positives and improve long-conversation rendering. Preserve research verification, automatic-report safeguards and the complete conversation.
2. Improve research progress, cancellation/continuation, public-data timeout feedback and Doctor guidance. Preserve the configured reasoning depth; a future fast mode requires explicit selection.
3. Improve configuration, report discovery and visual readability within DESIGN.md.

Each batch is independently verified and proposed as a pull request. The first batch uses focused changes rather than a new model judge or a broad rendering redesign.

For batch two, the agreed interrupt binding is configurable with Ctrl+G as its default; existing exit and panel-close bindings retain their meanings. Interrupting stops current requests while preserving the task, history and verified evidence; explicit continuation resumes unfinished work and checks whether evidence still applies. The Overview retains available old observations with their original dates and refresh/stale status, and allows retrying failed symbols only.

For batch three, keep the black/gold design, improve necessary-text contrast and configuration/report discovery, and add concise Chinese or bilingual action guidance. A full theme replacement or multilingual system is outside this repair plan.

## First-batch acceptance

- Correct Chinese TWR drawdown qualifications and explicit non-prediction statements produce no false contradiction and do not prevent automatic reports.
- Incorrect percentages and unsupported positive mean-reversion assertions remain rejected; unrelated disclaimers must not hide contradictory assertions.
- Complete history, wrapping, resize, scrolling, selection and copying remain available.
- With the same fixed 120x32 viewport and synthetic message fixture as the audit, target warm-paint p95 at or below 30 ms for 1000 messages and 80 ms for 5000 messages. Cold layout and changed-history behavior are measured separately.
- Actual terminal interaction is checked where the environment supports it; character projections and sink measurements are not physical-input evidence.

## Agreed test boundaries

- Public answer-checking and evidence-audit functions: correct/incorrect text against fixed verified metrics; these cannot establish real-model explanation quality.
- AppRuntime final-answer and automatic-report flow: observable warning and report output using controlled external agent responses; these cannot establish provider latency.
- Conversation rendering and existing TUI input/copy interfaces: wrapping, history, resize, scroll and selection behavior; the performance harness separately measures synchronous paint work.

Read [GLOSSARY.md](../GLOSSARY.md) for the meaning of verification and answer contradictions. Existing architecture and design references remain authoritative.

## First-batch verification

The fund qualifier and factor non-prediction regressions each failed before the respective fix. Correct final answers now pass the AppRuntime automatic-report flow, while existing incorrect-answer cases still prevent automatic reports.

On Windows with Bun 1.4.3, fixed 120x32 viewport and 20 warm samples:

| Messages | Before warm p95 | After warm p95 | After cold layout | After last-message update | After 80x32 reflow |
|---|---:|---:|---:|---:|---:|
| 1000 | 114.10 ms | 3.34 ms | 68.64 ms | 1.33 ms | 63.16 ms |
| 5000 | 585.24 ms | 14.88 ms | 286.16 ms | 6.20 ms | 287.50 ms |

The cache retains one width and rendered-input snapshot per live message and invalidates changed text/tool/skill fields. Returned rows and segments remain independent of the cached layout. Cold layout and resize still scale with history; this batch removes repeated unchanged-message layout rather than virtualizing the whole conversation.

Reproduce the controlled CPU measurement with `bun run scripts/measure-conversation-render.ts --check --output NEW-render.json`. It is separate from the deterministic test suite because wall-clock thresholds depend on hardware and load.

The production QuantTui accepted `/help`, Escape and `/exit` through a Windows exec PTY with 1000 synthetic messages and exited normally. This checks raw keyboard routing, not native Windows Terminal/Electron pixels, clipboard integration or IME behavior.

Engineering checks on the reviewed code: 1927 tests passed across 231 files, 25339 assertions; typecheck, architecture (0 baseline violations) and build passed. The focused rendering/scroll/selection/copy set passed 85 tests, and final-answer/evidence/runtime verification passed 41 tests before the additional factor disclaimer cases. No live provider or market calls were needed for these regressions.

Upstream issue tracking: [answer qualifiers #8](https://github.com/yangjingo/oh-my-quant/issues/8), [conversation rendering #9](https://github.com/yangjingo/oh-my-quant/issues/9). Batches two and three remain planned work.
