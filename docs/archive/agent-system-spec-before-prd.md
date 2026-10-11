> 历史快照：2026-09-14 合并前正文。可能包含过时命令、路径与完成声明。当前设计见 [quant-harness.md](../quant-harness.md)，完成度见 [PRD](../PRD.md)。

# WhyJ Quant — AI Agent 系统规格 (v3，已实现)

> 最后更新：2026-09-13

**推荐阅读顺序**
- 从这里开始了解系统级架构和所有权边界。
- 然后阅读 `docs/pi-agent-loop-harness.md` 了解 loop/harness 生命周期和队列语义。
- 最后阅读 `docs/agent-loop-context.md` 了解 prompt assembly、`displayUser` 和模型-vs-UI 文本流。

## 1. 概述

Agent 循环与模型传输使用精确锁定的 pi-agent-core / pi-ai 0.85.1。WhyJ 的会话适配层单独维护 JSONL v3 tree、压缩、队列及 displayUser；没有采用上游新版 durable Harness 的 lane/session 格式。运行边界和升级步骤见 [pi 内核与会话适配](.././pi-agent-loop-harness.md)。

**设计参考：**
- `docs/pi-agent-loop-harness.md` — pi agent loop、harness phase、session tree、compaction、resume 边界的技术博客
- `docs/builtin-tool-registry.md` — 未来内置 agent 工具的轻量注册表
- pi `packages/agent/src/harness/agent-harness.ts` — harness 生命周期、hooks、队列管理
- pi `packages/agent/src/harness/compaction/compaction.ts` — token 估算、cut points、摘要生成
- pi `packages/agent/src/harness/session/session.ts` — 基于树的 session 存储
- pi `packages/agent/src/harness/messages.ts` — 消息转换、compaction/branch summary 消息

## 2. 文件地图

```
src/agent/
  src/
    kernel/           上游 pi 循环、模型目录与协议的唯一实现入口
    session-runtime/  WhyJ JSONL v3 会话适配、压缩、导航、队列、skills/执行环境
    model-config.ts   模型 ID、协议端点、凭证、上下文阈值
    session-contracts.ts / session-state.ts / tool-result-shape.ts  契约与状态映射
    session.ts        AgentHarness 之上的 WhyJ Quant facade；持有 prompt/turn context injection 和队列转发
    dispatch.ts       prompt/steer/followUp 路由（对 facade）
    context.ts        Prompt assembly（基础模板 + 动态注入）
    skills.ts         Skill 发现和诊断
  test/
    session.test.ts   estimateTokens, estimateContextTokens, createAgent
    context.test.ts   BASE_SYSTEM_PROMPT, injectSessionContext
    dispatch.test.ts  prompt/steer/followUp 路由

src/cli/
  catalog.ts          重导出 runtime Slash catalog，供 CLI 消费
  registry.ts         parseCommand()、executeCommand()、slash handlers
  registry.test.ts    Parser 测试

src/runtime/
  command-catalog.ts  一级 Slash 名称与描述的单一真源（TUI、帮助、one-shot）

src/tools/
  registry.ts         内置工具注册、显示元数据、CLI 查找、启用的 agent 工具顺序
  data-tools.ts       本地数据获取工具
  quant-tools.ts      5 个计算工具（factor、backtest、risk、benchmark、dashboard）
  bash-tool.ts        Shell 工具（pi NodeExecutionEnv + codex 风格参数）

src/storage/
  index.ts            .ohquant/ 目录布局、settings load/save
  bars.ts             日线数据：loadBars、saveBars、isCacheFresh、getMeta
```

## 3. Agent 架构

`createAgent()` 现在返回一个 facade，它：

- 创建以当前 cwd 为根的 `NodeExecutionEnv`
- 打开或创建 `.ohquant/sessions/` 下的 pi `JsonlSessionRepo` session
- 使用 WhyJ Quant 工具和 system prompt callback 实例化 WhyJ 会话适配 `AgentHarness`
- 镜像核心 `AgentEvent` 状态（`isStreaming`、`pendingToolCalls`、`messages`），使现有 TUI runtime 保持其事件驱动的 UI 流
- 转发 harness `queue_update` 事件，使 Composer 队列状态来自真实 harness queues，而非 runtime 侧的影子队列
- 通过实例内 `updateContext()` 与 `injectTurnContext()` 保留每轮 symbol 记忆，不同 Agent 不共享状态

### 3.1 统一模型连接

`model-config.ts` 是 Settings、Doctor 和 Agent 的共享解析入口；详细字段和交互见 [配置参考](.././configuration.md)。

```text
/config → Model / Doctor → Model connection
  → 搜索 Pi provider / 实际模型 ID
  → API key 或 Pi Provider setup
  → 草稿校验 → Save → settings.json
  → 新 prompt/skill/手动 compact 读取连接快照
  → resolveConfiguredModel + resolveConfiguredAuth
  → kernel/llm → Pi provider 的原生请求实现
```

- `provider` 和实际 `model` 显式保存。端点、密钥和 provider 环境按 provider 隔离；能力覆盖按具体模型 ID 隔离。
- 模型目录、默认端点/协议、reasoning 能力和 API-key/环境凭证解析由锁定的 pi-ai 0.85.1 提供。`Provider setup` 使用同包的交互式凭证流程。
- 自定义协议支持 OpenAI Completions、OpenAI Responses、Anthropic Messages、Google Generative AI。原生 provider 仍通过其自身实现分派，包含 Bedrock 等特殊协议。
- URL 不能改变显式协议；如需将某个模型接到 Anthropic 兼容网关，明确选择 `anthropic-messages`。
- `model.id` 保留命名空间和 `[1m]` 等后缀。目录外的 ID 允许手填，是否存在由供应商确认；控制字符及不合法的端点/能力限制会在本地拒绝。
- Thinking 由 Pi 模型能力约束。模型窗口同步用于 HUD 和 compact 阈值；`WHYJ_QUANT_COMPACT_TRIGGER_TOKENS` 仍是独立压缩策略。
- 当前分析和排队续问使用同一连接快照；新提交的 prompt/skill/手动 compact 才应用保存的连接。切换不会清空历史或重建 session。
- 凭证解析的 headers、环境和端点信息传递到对话、compaction 和 branch summary，请求都使用相同 kernel。
- 缺少 `provider` 的旧配置只走遗留解析；打开模型编辑器转换为草稿，保存后使用明确连接。新模式不受旧角色别名强制改写。

### 3.2 验证边界

`model-connection.test.ts` 使用实际 Pi 目录和 SDK payload 构造器验证协议、精确 ID、模型能力与凭证隔离。`model-request.test.ts` 在临时目录和本地 HTTP 服务上运行真实 Agent/Doctor/smoke，验证保存切换、会话保留、错误/空响应/超时及启动配置修复。它们不证明供应商账户或付费 API 可用。

真实账户使用 `Save & Verify`、`/doctor --phase model` 或 `bun run test:providers` 单独验收。旧 smoke 曾只检查 prompt Promise 完成，不能作为真实连通性证据；当前版本要求非错误且有文本的 assistant 响应。

### 3.2 消息模型分离：模型文本 vs 显示文本

WhyJ 现在区分：

- 模型面向的用户文本：LLM 在 session/turn context injection 之后实际应看到的内容
- UI 面向的用户文本：用户在 Composer 中输入的原始字符串

为保持这两个关注点分离而不重新引入 runtime 侧待处理输入分类账，harness 使用 `src/agent/src/session-runtime/harness/messages.ts` 中的自定义 `displayUser` 消息类型。

- `displayUser.displayText` 是 Composer / Conversation 中显示的原始用户输入
- `displayUser.content` 是面向模型的文本 payload
- `convertToLlm()` 在模型请求前将 `displayUser` 转换回标准 provider `user` 消息

这使 UI 渲染、队列状态、session 持久化和 compaction 保持一致，同时仍允许在 session 层进行 prompt/turn context injection。

## 4. 数据工具 (src/tools/data-tools.ts)

每个工具包装仓库的本地数据 adapter 路径，并在适当时本地缓存。

| 工具 | 后端 | 调用 | 缓存？ |
|------|--------|----------|---------|
| `fetch_bars` | 当前市场兼容的配置 provider 与回退链 | `fetchBars(symbol, market, start, end)` | 是 |

模式：TypeBox schema → `fetchBars()` → `saveBars()` → `ok(text)`。

## 5. 计算工具 (src/tools/quant-tools.ts)

量化工具是内置 agent 工具，不是 slash 命令。完整功能设计：`docs/quant-tools-design.md`。

| 工具 | 需要 | 输出 |
|------|----------|--------|
| `compute_factor` | 自动取数 | momentum/reversal/volatility/volume_ratio/rsi/sma_deviation、百分位 |
| `run_backtest` | 自动取数 | 总收益、CAGR、Sharpe、最大回撤、胜率、盈亏比 |
| `check_risk` | 自动取数 | 年化波动率、VaR(95/99)、CVaR(95/99)、最大回撤持续时间、偏度、峰度 |
| `score_benchmark` | 直接数据获取 | 获取策略+benchmark、回测、3 维度评分（100分制）、保存 JSON |
| `show_dashboard` | .ohquant/ 文件 | 读取 benchmark 结果、排名、展示前 10 |

`compute_factor`、`run_backtest`、`check_risk` 和 `score_benchmark` 统一通过 `runtime/analysis-data.ts` 自动获取数据，校验新鲜度与日期窗口；无需手工调用 `fetch_bars`。结果保留实际来源、数据日期及陈旧缓存状态。`show_dashboard` 仅读取已保存制品。

## 5b. Shell 工具 (src/tools/bash-tool.ts)

参考：pi `NodeExecutionEnv` + `executeShellWithCapture`；codex `shell` tool parameters。

| 工具 | 参数 | 行为 |
|------|--------|----------|
| `bash` | `command`、可选 `workdir`、可选 `timeout_ms` | 通过 pi harness 运行 shell（Unix 上 bash，Windows 上 Git Bash）。`executionMode: sequential`。非零退出抛出异常。输出尾部截断在 pi 默认值（约 50KB）。 |

用于 `whyj` CLI、`bun test`、git、文件检查。行情数据仍应通过数据工具。

## 6. Prompt Assembly (src/agent/src/context.ts)

### 基础模板 (BASE_SYSTEM_PROMPT)
- 身份："WhyJ Quant 终端中的量化金融分析师"
- 列出本地数据、量化和 shell 工具及一行描述
- Shell/工具纪律：调查期间禁止仓库本地的临时脚本和临时演示文件夹；使用一次性命令或 OS 临时路径并清理
- 工作流：按问题选择 Quant tool → 工具自动取数 → 返回该问题所需的指标与来源
- **输出约束**：无 markdown、无 emoji、纯 ASCII、SI 后缀、金融术语
- 金融术语：年化收益率、momentum premium、tail risk、tracking error、information ratio 等

### 动态注入
- `buildSystemPrompt(extra?)` 追加缓存 symbol（最多 15 个），含 source + bar count
- `injectSessionContext(input, ctx)` 用 `last_symbol`、`last_market` 等包装首个 prompt turn
- `injectTurnContext(input, ctx)` 用相同的 session memory 包装排队的 follow-up / steering turn

重要边界：`AppRuntime` 不再自行注入 prompt 文本。原始 Composer 输入被转发到 `dispatchUserMessage(agent, input, input)`，session facade 是唯一允许在到达 harness 之前增强用户文本的层。

## 7. Token 估算与 Compaction

Compaction 不再是 `src/agent/src/session.ts` 中的本地启发式方法。WhyJ Quant 的 `session-runtime/harness/compaction/` 保留基于原 pi 的 JSONL v3 压缩规则，模型调用使用上游 pi-ai：

- token 估算委托给 WhyJ session-runtime `estimateTokens()` / `estimateContextTokens()`
- session 历史通过 pi `prepareCompaction()` 和 `compact()` 压缩
- compaction 摘要和 branch summary 作为显式 session-tree entries 存储
- `displayUser` 在 token 估算、cut-point 选择、turn-start 发现、摘要序列化和 branch navigation/editor restore 期间被视为 user-equivalent 消息
- 当前 adapter 为测试和小工具暴露 token 估算 helper，但权威 compaction 行为位于 WhyJ session-runtime 代码中
- session facade 在每个新 prompt 前读取 `WHYJ_QUANT_COMPACT_TRIGGER_TOKENS`；当前 context 估算达到阈值时，先调用 harness `compact()` 并刷新 session context，再进入正常 prompt loop

## 8. Session 持久化

主要存储现在是 `.ohquant/sessions/<encoded-cwd>/...jsonl` 下的 pi JSONL tree sessions。

- entries 是仅追加的，包括 message、compaction、branch_summary、label 和 leaf 记录
- `app-runtime` 不再在 `agent_end` 时序列化 Markdown 转录
- session 重放通过 pi `buildSessionContext()` 从存储的 branch path 派生

## 9. 生命周期

```
App 挂载
  → ensureDirs(), loadSettings()
  → createAgent()                                // pi AgentHarness 之上的 WhyJ Quant facade
  → agent.subscribe()                            // Core AgentEvent → UI

用户消息
  → src/cli/registry.ts: parseCommand(input)
    → /slash → executeCommand()
    → NL 文本 → dispatchUserMessage(agent, input, input)
      → idle           → session.prompt()      → injectSessionContext()
      → active + tools → session.steer()       → injectTurnContext()
      → active + no tools → session.followUp() → injectTurnContext()
      → harness queue_update 驱动 Composer queue
      → 需要时 pi compaction / branch-summary hooks
      → streamFn → LLM API
      → tool_execution_start/update/end → UI updates
      → agent_end → session 已由 harness 持久化
```

关键架构变化是 TUI 中显示的 Composer 队列现在通过 `queue_update` 从 harness `steer/followUp/nextTurn` 队列派生。`AppRuntime` 不再持有平行的 `composerQueue` 真源。

## 10. 配置

单一真源是 `.ohquant/settings.json`，由 `OHQUANT_DIR` 决定目录。字段、示例、默认值、保存时机和迁移规则只在 [配置参考](.././configuration.md) 维护，避免 Agent、Doctor 和 Settings 各自定义配置语义。

## 11. 洞察系统与提示

Agent thinking 期间显示的投资提示由 insight pipeline 驱动：

```
notes/quant/funder.md  ──┐
                         ├──→ src/quant/insight-generator.ts
notes/quant/notes.md   ──┘         │
                                   ▼
                          .ohquant/insights.json  （启动时自动重新生成）
                                   │
                                   ▼
                          insight.ts → getQuotes() → thinking bar spinner + tips
                                      → getInsightRules() → conversation 关键词匹配
```

**组件：**

| 文件 | 角色 |
|------|------|
| `src/quant/insight-generator.ts` | 解析 `notes/quant/*.md` → `InsightEntry[]`（quote、author、title、principle、wisdom、keywords） |
| `src/quant/insight.ts` | Loading overlay quotes + conversation insight derivation + 内置 risk rules |
| `scripts/generate-insights.ts` | 手动重新生成的 CLI 命令：`bun scripts/generate-insights.ts` |
| `.ohquant/insights.json` | 缓存输出；当 notes 源文件更新时自动重新生成 |

**自动重新生成：** 在每次 `loadEntries()` 调用（首次 `getQuotes()` 或 `getInsightRules()` 调用）时，系统比较 `notes/quant/funder.md` 和 `notes/quant/notes.md` 的 `mtime` 与 `.ohquant/insights.json`。如果 notes 更新，重新生成自动运行。无需手动脚本调用。

**Thinking bar：** 在 agent `"thinking"` 或 `"running tool"` 活动且有对话内容时，保留的底部行显示：`⠋ "quote" — Author`，每 5 秒循环，ora spinner 帧每 80ms 更新。

**Loading overlay：** 当对话为空且 agent 正在启动时，用居中显示的 spinner + 阶梯动画 + 多行投资引言（中文 + 英文 + 作者）替换对话区域。

**回退：** 当 `.ohquant/insights.json` 缺失或为空时，`fallbackQuotes()` 中的 16 条硬编码量化提示作为默认集合。
