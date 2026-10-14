# Agent module

WhyJ uses the pinned pi-agent-core / pi-ai runtime through `src/kernel/`; exact versions are maintained in [package.json](../../package.json). Local model catalogs, protocol implementations and the copied agent loop have been removed.

## Modules

| Path under `src/` | Responsibility |
|---|---|
| `kernel/loop.ts` | Public upstream loop boundary |
| `kernel/llm.ts` | Public upstream protocols and model catalog |
| `model-config.ts` | Model IDs, endpoint routing, credentials and thresholds |
| `session.ts` | Application session facade and serialized session switching |
| `session-contracts.ts` | Public session API and events |
| `../../runtime/session-dependencies.ts` | Default local composition of model/auth snapshots, tools, skills, repo, prompts and research verification |
| `session-state.ts` | Instance context and event-to-state mapping |
| `tool-result-shape.ts` | Rendering hints for tool results |
| `session-runtime/` | WhyJ JSONL v3 tree, compaction, navigation, queues and execution helpers |
| `dispatch.ts` | prompt / steer / followUp routing |
| `context.ts` | System prompt and per-turn context injection |
| `skills.ts` | Project and optional external skill discovery |

Application code should use `createAgent()` and the `QuantAgentSession` interface. Update recent research context through that instance's `updateContext()` method. There is no shared session-memory singleton.

`createAgent({ dependencies })` accepts a complete host composition without invoking local defaults. Tools and skill content are copied, connections bind endpoint and lazy auth to one snapshot, and restored active tools are intersected with supplied tools. Independent tools and an in-memory repo run through the real Pi loop. See [Session dependency injection](../../docs/agent-runtime/README.md#dependencies) for the ports, an integration example, cancellation and failed recovery behavior.

`session-runtime` retains the existing JSONL format and WhyJ message behavior. It is a maintained adapter derived from the former pi harness; it is not the new upstream durable Harness. Runtime package upgrades and session-format migrations are separate changes.

See [the runtime design](../../docs/agent-runtime/README.md#pi-integration) for module ownership, lifecycle rules, test mapping, and upgrade steps. Shared upstream tool types may be imported directly; executable loops and protocols must pass through `kernel/`.

## Verification

```bash
bun test src/agent/test
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

Tests use isolated temporary directories or an independent in-memory repo, with model requests intercepted before transmission or served by local HTTP/SSE fixtures. Real provider authentication is a separate opt-in smoke check (`bun run test:providers`).
