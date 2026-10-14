# Pinned public risk workflow fixture

The five Markdown files under `LLMQuant-skills/skills/llmquant-risk` are copied from the reviewed LLMQuant/skills commit `1918237467c2dff4cc97a18ebc0892dfd46e8129`. Their normalized hashes must match `src/skill/llmquant-manifest.ts`; `stageSkillEvaluation` verifies the closure before a local Pi integration test.

The upstream MIT license is retained in `LLMQuant-skills/LICENSE`. These are public workflow resources, not user configuration, market observations or credentials. They keep deterministic integration tests independent of an installed `.ohquant/skills` checkout.
