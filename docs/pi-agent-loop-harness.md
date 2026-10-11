# pi 内核与 WhyJ 会话适配

更新：2026-10-11；先读 [Quant Harness](./quant-harness.md) 的所有权与输入组装，再读本文的底层生命周期。

## 当前版本与所有权

`@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai` 均精确锁定 **1.1.0**，项目 TypeBox 为 **1.3.7**。版本依据：[v1.1.0 release](https://github.com/earendil-works/pi/releases/tag/v1.1.0)；接口以安装包的公开类型和实际请求构造器为准。升级记录与验证见本文末尾。

升级前，TypeScript paths 将 `@earendil-works/pi-ai` 映射到本地 `pi/llm-index.ts`，实际执行本地复制的循环和协议代码。现已删除这个别名及旧循环、协议实现、模型目录和配套工具副本。修改包版本会更新真实使用的内核。

上游 0.85.1 同时引入了不同的 durable Harness、lane 和会话格式。本项目使用它的低层 `runAgentLoop` 与 pi-ai 协议实现；现有 JSONL v3 tree、显示消息、压缩规则和队列控制由 **WhyJ session-runtime** 维护。没有把原有 JSONL 文件迁移为上游新版格式，也不声称已经接入其 durable Harness。

## 模块地图

以下路径相对 `src/agent/src/`：

| 模块 | 职责 | 主要测试 |
|---|---|---|
| `kernel/loop.ts` | 唯一的上游运行循环入口，适配 WhyJ 扩展消息类型 | `kernel.test.ts` |
| `kernel/llm.ts` | 上游 provider/model 目录、原生及自定义协议分派 | `kernel.test.ts`、`anthropic-model-id.test.ts` |
| `model-config.ts` | 显式模型连接、Pi 凭证流程、能力覆盖、遗留迁移 | `model-config.test.ts`、`session.test.ts` |
| `session-contracts.ts` | 应用层会话 API、状态和事件类型 | TypeScript 检查 |
| `session-dependencies.ts` | 默认模型连接快照、工具/skills/repo/prompt/证据端口组装 | `session-dependencies.test.ts` |
| `session.ts` | 初始化、会话切换、上下文注入及对外 facade | `session.test.ts`、`session-lifecycle.test.ts` |
| `session-state.ts` | 事件到 UI 状态的映射、会话恢复状态 | `session-state.test.ts`、`session.test.ts` |
| `tool-result-shape.ts` | 工具结果的显示提示 | `tool-result-shape.test.ts` |
| `session-runtime/harness/agent-harness.ts` | 队列、hooks、工具循环和持久化编排 | `kernel.test.ts`、`harness-lifecycle.test.ts` |
| `session-runtime/harness/operation.ts` | 单一操作生命周期、取消信号、idle 等待 | `harness-lifecycle.test.ts` |
| `session-runtime/harness/stream-options.ts` | 请求参数克隆、合并、显式移除 | `stream-options.test.ts` |
| `session-runtime/harness/session/compact-session.ts` | 压缩准备、摘要生成与追加记录 | `harness-lifecycle.test.ts`、`session.test.ts` |
| `session-runtime/harness/session/navigate-session.ts` | 分支摘要、leaf 移动、编辑文本恢复 | `harness-lifecycle.test.ts`、`session.test.ts` |
| `session-runtime/harness/session/jsonl-format.ts` | JSONL v3 解析及 ID/父链/目标校验 | `session-journal.test.ts` |
| `session-runtime/harness/session/jsonl-storage.ts` | 版本快照、原子批次与隔离的 tree 读口 | `session-journal.test.ts`、storage 的 `session-process.test.ts` |
| `session-runtime/harness/session/jsonl-repo.ts` | 路径、列表、删除、完整及指定分支 fork；可注入 SessionFilePort | `session-journal.test.ts`、`session-lifecycle.test.ts` |
| `session-runtime/harness/compaction/` | token 估算、cut point、摘要内容与消息序列化 | `session.test.ts` |
| `session-runtime/harness/messages.ts` | `displayUser`、自定义/压缩消息转换 | `kernel.test.ts`、`session.test.ts` |
| `context.ts` / `skills.ts` | WhyJ prompt 和 skill 发现 | `context.test.ts`、`skills.test.ts` |
| `system-prompt.ts` | 根据当前请求工具/技能/缓存观察快照纯组装系统提示；工具描述由实际 schema 提供 | `system-prompt.test.ts`、runtime 的 `research-task-tool.test.ts` |

## 执行路径

```text
TUI / AppRuntime
  → QuantAgentSession
    → WhyJ session-runtime AgentHarness
      → kernel/loop → 上游 runAgentLoop
        → kernel/llm → 上游协议实现
        → WhyJ 工具
```

工具提供两类信息：`tool_execution_*` 是 UI 进度；`toolResult` 是下一次模型请求的上下文。成功、拦截和参数校验失败都要形成对应结果，按原工具调用顺序回传。工具的 sequential/parallel 规则由上游 loop 执行。

每个 turn 后，适配层 flush 待写入的 session 记录，并在 `prepareNextTurn` 重建上下文和读取下一轮 model/tools/thinking。运行中改配置不应修改已发出的请求。

## 生命周期与取消

`HarnessOperation` 统一管理 `turn`、`compaction`、`branch_summary`。只有 idle 能开始独占操作。生命周期覆盖异步准备、模型请求、工具执行、持久化、事件监听器和最后的 flush。

- `waitForIdle()` 等待当前完整操作；最后一个文本块或 `agent_end` 到达并不代表监听器已经结束。
- 不要在正在被 awaited 的事件监听器内等待同一 harness 的 idle，这会自等。需要启动后续操作时，从调用者等待当前 prompt 完成。
- `abort()` 从准备阶段起就能发出取消信号，并清空 steer、followUp、nextTurn 三个队列。
- 压缩和分支摘要的 hook、模型请求收到同一个 signal；在追加摘要或移动 leaf 前再次检查取消。
- hook 若不响应取消，完成等待仍会等其返回；返回后不会提交已取消的摘要。
- 监听器抛错不会留下永久 busy 状态。待写入记录在成功 flush 后才从队列移除。

## 输入与会话隔离

输入路由保持三个入口：idle → `prompt`；工具执行中 → `steer`；其他流式响应期间 → `followUp`。输入队列只由 harness 持有，Composer 从 `queue_update` 消费快照。

每个 `QuantAgentSession` 自有 SessionCtx。通过 `agent.updateContext()` 更新最近的 symbol、market、日期和工具结果提示，不再有模块级全局记忆。

会话构造接受完整 [QuantAgentDependencies](./session-dependencies.md)，默认本地组装集中在独立文件。工具/schema、skills 和模型快照隔离调用者后续修改；恢复工具集合与宿主工具取交集，空集合不重新激活内置工具。动态 system prompt 消费本轮活动工具和分支研究投影。

R06 增加 `getResearchState()`，从当前分支原 entries 和归档重建参数、证据、组合版本、报告引用与未完成调用。每次 `createTurnState()` 的动态 system prompt 消费同一投影；工具结果后的下一次请求也会刷新。初始化、prompt、turn 结束及压缩/导航同步最近对象提示。详细字段、截断和验证边界见 [研究状态与恢复](./research-state.md)。

R06 第三阶段加入 [结构化任务](./research-tasks.md) 的条件/重试/报告投影；显式任务范围覆盖旧最近对象提示。runtime 的 QuantResearchHarness 组合 Session 与工具执行守卫，不复制 Pi 循环。`prompt(..., {signal})` 在初始化等待和各个准备边界检查取消，避免取消早于底层操作开始时仍发请求；执行期间沿用 Harness abort。

`displayUser.content` 承载注入上下文后的模型输入，`displayUser.displayText` 保存 UI 原文。`convertToLlm` 在协议边界转换成标准 user 消息；这个自定义 role 不会发给 provider。低层 loop 入口只有一处类型适配，并由真实 loop + 工具调用测试覆盖。

## Session tree、恢复与压缩

JSONL v3 为逻辑 append-only tree，每个 entry 有 `id`、`parentId`、`timestamp` 和 `type`。`leaf` 决定当前分支。`buildContext()` 读取最近的模型/thinking/工具配置，并把 compaction、branch summary 转成模型可见消息。

物理提交由共享 `SessionFilePort` 和 storage 的 `LocalSessionFile` 承担：读取精确字节版本，持进程锁检查 SHA-256，再将完整转录写入唯一临时文件、fsync、rename。旧 writer 不能覆盖外部追加/修改，也不能复活已删除的文件；冲突要求重新打开会话，不自动把旧上下文合并到新研究。内存只在提交成功后更新，读口返回副本；同一 Session 的修改排队并从已提交 leaf 创建下一条记录。完整 fork 一次发布；指定分支 fork 保留标签引用及其祖先，但不把其他分支加入模型上下文。

移动 leaf 与分支摘要在同一批次提交。压缩/导航的取消信号贯通等待文件锁，取消不产生半份导航；存储失败后队列可重试，未确认的相同 entry 事务重试不会重复写入。普通调用若遇到提交结果不确定，应重新打开核对，不能用新 ID 无条件重发。文件观察者不参与提交确认，异常不能伪装成写入失败。

活动会话解析和 Resume 摘要读取均拒绝歧义 ID、缺父项、循环、缺失 leaf 目标和截断 JSON；摘要列表隐藏损坏条目并保留文件。全量复制的追加开销随转录大小增长，测量命令和本机结果见 [R02 实施记录](./feature-delivery.md)。这验证了本机进程故障恢复，不等于所有文件系统断电保证；研究字段的语义恢复仍按 F20 单独验收。

恢复和重置串行执行：等待前一次初始化/切换 → 取消并等待原 harness → 打开目标并重建 context → 成功后替换状态。目标不存在时保留原会话、研究上下文和可用的 ready 状态；旧 harness 的晚到事件不能写入新状态。

报告恢复先准备指定 leaf 的分支快照及所有注入端口，再提交 leaf 移动。即使目标就是当前 session，prompt/证据/skill 准备失败也不得提前改变研究位置；该情况由独立内存 repo 故障注入回归覆盖。

压缩默认保留约 20,000 个 recent tokens，预留 16,384 tokens；摘要保存目标、约束、进度、判断、后续任务及研究标的/区间/参数等信息。压缩通过追加 entry 改变后续 context，不删除历史。

自动压缩在新 prompt 前检查：达到 `WHYJ_QUANT_COMPACT_TRIGGER_TOKENS` 时执行。未配置时使用 `contextWindow - 16384`，配置值限制在模型窗口以内。手动 `/compact` 先等待 idle；`Nothing to compact` 是无操作提示。

`navigateTree` 在同一文件里移动 leaf；目标为 user/custom message 时回到它的 parent，并返回可编辑文本。`resumeSession` 切换的是整个会话文件。两者都必须通过 facade，不直接截断 UI 消息数组。

## 模型与 hooks

R06 的普通任务控制由会话绑定 `research_task` 工具完成，注册与注入见 [结构化研究任务](./research-tasks.md)。执行中只校验并返回候选事件，成功 toolResult 经原 Session 原子提交后才成为声明/关联/取消记录；不在工具内等待自己的 idle，不另排队重复写 custom note。投影核对调用、结果、action 与实际用户原文。`/resume --task` 通过 facade 的分支投影本地查看，不进入 Pi 模型循环。

模型连接通过共享 `model-config.ts` 解析，字段和优先级见 [配置参考](./configuration.md)。原生协议使用 provider 实现，自定义协议明确指定；URL 不覆盖协议，精确 ID 和 `[1m]` 等后缀保留，覆盖配置不修改上游目录。

每次新 prompt/skill/手动 compact 读取连接快照，当前运行和排队续问保持原连接。凭证按 provider 隔离，Pi 返回的 headers（含 null 删除值）、env 和 baseUrl 均传递到对话、压缩和分支摘要。请求选项克隆后再 patch，headers/metadata 支持显式清除，未知协议返回 error stream。

| Hook | 用途 |
|---|---|
| `before_agent_start` / `context` | 注入模型上下文 |
| `before_provider_request` / `before_provider_payload` | 请求参数与 payload patch |
| `after_provider_response` | 响应状态与 headers 观察 |
| `tool_call` / `tool_result` | 拦截或修改工具结果 |
| `session_before_compact` / `session_before_tree` | 取消或提供摘要 |

`tool_call` hook 现在将 `block/reason/terminate` 一起交给上游 `beforeToolCall`。单个被阻断且要求 `terminate: true` 的工具回执会结束该批次，不再无条件启动下一次模型请求；同一批次若仍有允许执行的工具或不要求终止的结果，Pi 继续执行及回答。`tool_result` 的同名终止 patch 仍按上游批次规则处理。修复前本地 Pi SSE 反例实际发送两次请求；修复后单调用为一次，混合批次仍为两次且合法工具执行。[行为回归](../src/agent/test/tool-call-termination.test.ts) 同时核对 session 中的阻断结果。这里是研究/扩展 hook 的停止能力，不是实盘授权或下单边界。

## 升级和验证

### Pi 1.1 transcript 迁移（2026-10-11）

Pi 1.x 从转录中的 `system` 消息重放提示词和工具集合。旧版直接传入 `AgentContext.systemPrompt`，并在 `convertToLlm` 过滤 `system` 的写法会丢失这两类信息。`kernel/loop.ts` 现在把本轮提示词写为 `whyj.runtime` 命名 section；更新同名 section 替换旧内容。上游循环负责把可执行工具集合与历史声明比较，产生 `toolsAdded/toolsRemoved`。转换器完整保留这些消息，JSONL 仍使用原 v3 格式。

新请求、工具后的资源更新及压缩后重建使用同一入口；恢复已有相同 section 时不重复追加。`kernel/llm.ts` 通过 `normalizeContext()` 将手动摘要等旧式 Context 转为 provider 所需 TranscriptContext。循环继续等待 message_end 持久化后才执行工具预检。

低层 `finishTurn` 在 `turn_end` 前接收结束/继续决策；本地 `shouldStopAfterTurn` 经适配器映射到结束决策，也在 `turn_end` 前运行。宿主通常使用工具 hook 的 terminate，仍遵守整批工具的终止规则。

模型与配置差异：

- Azure 的 provider ID 为 `azure`，协议仍为 `azure-openai-responses`。旧 ID 不自动重命名；在连接编辑器选择 Azure 并保存，或通过 Pi import 预览后导入新 ID，凭证必须属于所选连接。
- OAuth 测试从当前 provider 目录选取模型，不依赖已撤下的 `gpt-5.4`；实际用户模型 ID 不自动替换。
- fallback 响应的 `model` 保留请求模型，`responseModel` 记录服务端实际模型；Pi 按 fallback 价格计算成本。恢复仍使用请求连接。
- 配置校验接受 `supportsMidConvoSystemMessages`、`supportsMidConvoToolAdditions` 和 `supportsMidConvoToolChanges`；已移除的 `supportsToolReferences`、`deferredToolsMode` 显式拒绝，避免保存后被上游静默忽略。

验证包含真实上游循环、实际协议请求构造、本地 HTTP/SSE、动态资源、工具声明、JSONL 恢复与有损压缩。真实供应商鉴权和模型解释质量仍需独立验收。

1. 对照上游 release 和公开导出的 `.d.ts`，同步更新 pi 两包到同一精确版本，检查 TypeBox 要求。
2. 仅在 `kernel/` 适配循环和协议 API；会话格式变更单独设计迁移与回滚。
3. 运行 `bun run typecheck`、`bun run check:architecture`、`bun run test`、`bun run build`。
4. 需要验证真实账户时再运行 `bun run test:providers`。确定性测试不等同于供应商账户鉴权验收。

架构检查禁止 pi 的本地路径别名、不同版本的 pi 两包，以及在 kernel 以外导入上游循环/协议实现；共享的上游类型允许直接导入。内核回归使用真实上游循环和请求构造器，采用请求发送前拦截或隔离的本地 HTTP/SSE；Session 注入与恢复测试不使用真实模型账户。

当前 1.1.0 的 `runAgentLoop` 会等待传入的异步 event sink；WhyJ 在 `message_end` 中提交 session 消息，因此 assistant 消息写入完成后才进入工具预检。[内核顺序回归](../src/agent/test/kernel.test.ts) 用延迟的 assistant 消息屏障验证预检不会抢先执行。[pi-agent-core 包说明](https://www.npmjs.com/package/@earendil-works/pi-agent-core) 对返回 `EventStream` 的 `agentLoop()` 称为观察性事件：它的 stream consumer 不构成上述持久化屏障。升级若更换循环入口，需重新验证消息、工具预检、toolResult 和恢复所依赖的顺序；只看事件列表最终排序不足以证明异步提交已完成。

### 0.85.1 历史验证（2026-09-15）

当时的复跑方式（不作为 1.1.0 升级通过证据）：

```powershell
bun test src/agent/test/kernel.test.ts src/agent/test/tool-call-termination.test.ts src/agent/test/harness-lifecycle.test.ts
bun run typecheck
bun run check:architecture
bun run build
bun run test
```

`tool_call` 终止反例在修复前为 **0 pass / 1 fail**，预期一次却实际发送两次本地 Pi SSE 模型请求；修复后单调用一次、混合批次两次且允许工具执行。三文件定向 **13 pass / 0 fail、44 次 expect**，根 typecheck、architecture（0 baseline violations）、build（3003 modules / 6.88 MB）、测试围栏通过。最终 `bun run test` **1683 pass / 0 fail、198 文件、22105 次 expect、179.52 秒**，日志 `%TEMP%/whyj-pi-tool-termination-full-2026-09-15.log`；已跟踪差异及新文件行尾空白、本地文档路径检查通过。测试使用本地 SSE 与合成 session，未连接真实模型账户；hook 停止规则不替代完整研究任务、终端语义和外部供应商验收，F18/F20 仍为部分完成。

### 1.1.0 升级最终工程验证（2026-10-11）

最终代码固定后运行 `bun run test`：**1886 pass / 0 fail，224 个文件，25062 次断言，229.46 秒**，含 test fence；本机日志 `%TEMP%/whyj-pi-1-1-final.log`。此前一轮发现 TUI 的旧 Azure provider fixture，修正后重新执行完整套件；该轮也在补丁应用期间加载了旧版 token 估算模块，不计为最终验收。

`bun run typecheck`、`bun run check:architecture`（0 baseline violations）、`bun run build` 均通过，最终构建 2672 modules / 7.49 MB；`bun run src/index.ts --json --version` 返回 WhyJ 1.2.0、两个 Pi 包均 1.1.0。`git diff --check` 通过，五份相关文档的 158 个本地链接无缺失。

新增回归检查首个请求实际含提示词和 schema、动态提示替换与工具撤销/新增、恢复后无重复声明、压缩后重建、system section/schema token 估算、finishTurn 与旧停止 hook、移除字段拒绝及新 compat 字段导入。已有本地 HTTP/SSE、研究/报告恢复、OAuth 文件链接、原生协议和 TUI/无界面任务测试也在全量范围内。fallback 仍由 Pi 计算成本，测试同时保留请求与响应模型身份。

公开源五类固定窗口另行实测通过，见 [数据验收](./data-validation.md#2026-10-11pi-升级期间的公开源固定窗口复核)。本次完成的是 Pi 1.1.0 的本地适配及工程验证，不代表 F01 的真实 OAuth、多供应商权限或 25 项全部验收完成。
