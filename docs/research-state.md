# 研究状态与恢复

更新：2026-09-19；起始实现为 R06 第四阶段。入口为 `QuantAgentSession.getResearchState()`；模型请求自动消费同一份分支状态。[Session 依赖注入](./session-dependencies.md) 和 [结构化任务](./research-tasks.md) 已接通，普通输入可通过 research_task 工具声明/查看任务，核验器可由宿主提供。现有 `/resume --task` 将同一投影交给只读面板，一级命令数量不变。完整任务交互、跨对象任务集与真实模型效果评测继续按 [PRD F18/F20](./PRD.md) 推进。

## 数据流与所有权

```text
Session.getBranch() → research/state.ts
  ├─ 原始 displayText / user → requests
  ├─ 唯一且顺序匹配的 toolCall / toolResult → operations
  ├─ research/input.ts → 归档校验、参数匹配、独立重算 → findings
  ├─ artifact_export / artifact_restore → reports
  ├─ research_task 宿主 note / 成功配对的工具结果 → task / taskErrors
  └─ formatResearchContext() → 下一轮 Pi 请求的 system context
```

[research/input.ts](../src/research/input.ts) 及七类计算核验器从 Artifact 迁至独立 `src/research/`。报告和会话共用核验规则；绑定包含 call/result entry ID 和 tool call ID，公开 analysis DTO 不带会话身份。Research 不依赖 Agent、TUI、Artifact、工具执行或实时 provider，架构检查约束两个方向。归档读取由 storage 拥有，核验器可注入 Bars、NAV 和比较读取函数。

投影输入必须是当前 leaf 的完整祖先链，不能传所有分支或 `buildContext().messages`。压缩改变模型消息投影，不删除原 entries；恢复重新核验原始参数、结果与数据版本。compaction/branch_summary 的自然语言不作为研究事实解析。

## 状态契约

| 字段 | 含义 |
|---|---|
| `requests` | 用户原文与 entry ID，保留目标、约束和后续修正；不把增强 prompt 当成用户要求 |
| `operations` | 工具名、调用/结果/请求 ID、参数白名单、状态、原因、引用和发现 |
| `recordedScope` | 组合 list/edit 的分组及前后 revision；比较保存时的组/窗口/基准/币种/权重请求。记录存在不等于计算通过核验 |
| `references` | Bars/NAV 的角色、窗口、来源、时点、日期与版本，以及引用是否通过归档核验 |
| `findings` | 七类计算重算匹配后的指标与假设；不从助手叙述提取数字 |
| `comparison` | 核验后的组身份/成员/版本、权重、区间、基准、计价币种及三组指标 |
| `reports` | 固定报告引用与来源 leaf/hash；此字段本身不检查文件当前是否存在 |
| `availableTools` | 当前会话提供的活动工具名称，不表示数据权限或 Python/key 已就绪 |
| `unresolved` | 未返回、失败或未核验的调用及原因，附工具是否在当前活动集合中 |
| `task` / `taskErrors` | 当前显式任务、条件/证据/报告/重试关联/状态，以及无效或过时任务事件；要求报告时 `reportAvailable` 区分可读、不可读和未核验；未声明时 task 为 null |

操作状态：`pending` 没有持久化结果，可能曾中断；`failed` 为工具错误；`unverified` 为缺证据、不支持、歧义配对或不一致；`verified` 为重算匹配；`recorded` 是组合管理/历史列表的执行记录，不属于核验指标。

不同调用 ID 的失败重试分别保留，成功不会自动删除旧失败。显式 ResearchTask 可通过 resolve 关联更晚的同工具/同参数核验结果；有效关联从待办中排除原失败，原 operation 仍保留。目标证据失效后重新打开待办。任务完成仅限所声明条件及报告要求，不能由此推断原始自然语言目标全部实现。契约与宿主入口见 [结构化研究任务](./research-tasks.md)。

## 恢复、缺失与模型投影

每次模型请求准备时生成状态；工具结果落盘后的下一次 Pi 请求能看到刚核验的指标。Session 初始化、prompt、turn 结束、压缩及导航同步最近对象/窗口/工具提示。恢复失败保留原会话，成功切到空分支或 reset 清除旧提示。

缓存修订不改变旧 DatasetRef；引用归档缺失时取消对应 findings 并保留未完成原因，不使用最新行情。比较归档丢失后仍可查看 session 记录的原组版本与调用范围，但不再标为核验通过。已保存报告字节继续由报告版本契约管理。

模型优先取得当前任务已验收条件绑定的核验操作，再取最近 6 次操作及最近 6 个未解决操作；去重后最多 24 次。首个与最近 3 条请求、当前任务绑定的报告及最近 3 份报告单独保留。报告投影用 `taskBound` 区分经任务来源检查的事件和其它记录，即使后者使用相同 `reportRef`；任务的 `reportAvailable` 再由宿主核对不可变文件版本与来源元数据。其它 `reports` 项仍只表示会话记录。引用日期压缩为首日/末日/数量，不注入全部曲线。嵌套列表最多 24 项、对象最多 64 字段、文本最多 2000 字符；`omitted.operations` 和 `omitted.acceptedEvidence` 分别标出操作及任务验收证据被省略的数量。完整 API 状态不截断，可按 entry/报告/数据版本定位原记录。这不是严格 token 预算，长组合和大型历史重算的性能还需测量。

状态是分支和归档的派生值，不写第二份状态文件。它可能包含用户原文、组合名称和模拟参数，属于内部研究上下文，不能替代 Artifact 的公开分享 DTO。

自然语言声明的事件由 `task-actions.ts` 绑定实际用户输入及唯一匹配的工具调用/成功结果；待执行调用、失败结果、重复配对或改写原文均不作为提交。控制操作不作为量化 findings，也不因其成功而完成研究条件。详细事件与模型读口见 [任务契约](./research-tasks.md)。

第五阶段增加 `evaluatedDates`：从核验后的计算曲线、比较日历或完整输入日期推导，和 references 中的完整归档日期分开。组合 findings 增加带 `Portfolio A /`、`Portfolio B /`、`Benchmark · SYMBOL /` 前缀的指标，避免把任意一组收益当成全部条件。明确的 `details.error` 记录为 failed 并保留诊断，不从错误文本反推数值。跨对象、缺数据和恢复验证见 [固定评测](./research-task-evaluation.md)。

## 验证与复跑

```powershell
bun test src/research/state.test.ts src/agent/test/research-recovery.test.ts src/agent/test/session-lifecycle.test.ts
bun test src/artifact/test/report-share.test.ts src/artifact/test/report-fund.test.ts src/artifact/test/report-dashboard.test.ts src/artifact/test/report-comparison.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

[状态测试](../src/research/state.test.ts) 使用实际归档和计算，覆盖参数/费用单位、用户原文、组版本/权重、修订与缺失、重复/错序调用、篡改指标、失败/中断、编辑范围、报告引用和截断。回测末值独立核对 `139/102`。

[恢复测试](../src/agent/test/research-recovery.test.ts) 运行真实 Pi 循环、JSONL repo 与本地 HTTP/SSE：工具后的请求包含核验状态；丢弃源消息的压缩会话仍恢复组合/报告/待办；空分支不夹带旧对象，切回恢复原状态；取消摘要不提交半份记录，失败 resume 保留旧状态。已有多 Agent 隔离回归继续通过。HTTP 为固定响应，未调用真实模型/市场账户，也不证明自然语言回答质量或 UI 完整任务成功率。

## 2026-09-19：较早的任务验收证据

原投影只取最近 6 次操作；一项任务先由真实归档回测满足收益/回撤条件，再执行 8 次不同本金的回测时，任务仍为 `complete`，但模型上下文已没有验收所用的收益值和 DatasetRef。现在按当前任务 `criteria.evidence` 的调用 ID 选回已核验操作，再合并最近操作与待办；超过 24 次时明确报告遗漏的任务证据数。删去原归档后重新投影，条件变为 `blocked`，旧收益值不再作为已核验发现出现。

验证环境为 Windows / Bun 1.3.14；[真实计算与归档回归](../src/research/tasks.test.ts)和状态专项 **25/25**，全量 `bun run test` **1853/1853、222 文件、23353 次断言**，日志 `%TEMP%/ohquant-accepted-context-full-20260919.log`；根 typecheck、architecture（0 baseline violations）及 build（3045 modules）通过。该回归检验确定性投影及归档失效，不证明真实模型能正确表述任意旧研究；F20 仍为部分完成。

## 2026-09-19：任务报告在长会话中的来源绑定

任务要求的报告原本只以 `reportRef` 留在任务状态；模型上下文只保留最近 3 份报告。持久化会话在有效任务报告之后又记录 4 份其它报告和一份同引用但来源不符的恢复记录，再经有损压缩、重启和实际 Pi 请求，原报告标题已不可见。现在任务投影记录通过来源 entry ID/父链/哈希检查的 `reportEntryId`；模型上下文优先保留该事件，并用 `taskBound` 标记它。相同 `reportRef` 的其它记录不会被误标为任务报告。

[恢复回归](../src/agent/test/research-recovery.test.ts)使用本地 Pi/SSE 传输、真实回测归档和 JSONL 会话，确认任务仍为 complete、原报告标题和绑定 ID 进入重启后的模型请求。四文件专项 **35/35**；全量 **1854/1854、222 文件、23361 次断言**，日志 `%TEMP%/ohquant-bound-report-context-full-20260919.log`；typecheck、architecture（0 baseline violations）和 build（3045 modules）通过。这只证明提示输入与记录来源绑定，不证明真实模型回答质量、报告当前文件可读或报告正文语义；F20 保持部分完成。

## 2026-09-19：任务报告缺档后的状态

默认宿主新增 `verifyReport` 端口，通过 storage 读取固定版本快照、校验指纹与引用，并比较保存的 provenance 和通过任务来源检查的记录。ResearchTask 只核验最新的有效绑定报告一次；读取失败、内容损坏、来源不一致或宿主未提供端口时保留 `reportRef`/`reportEntryId`，但 `reportAvailable` 为 `false` 或 `null`，任务不再标为 `complete`。普通历史报告列表仍只是记录；报告打开/恢复继续额外核对源会话。

[真实 Pi/JSONL 恢复测试](../src/agent/test/research-recovery.test.ts)先用真实不可变报告版本得到 `complete`，再删除该版本快照，确认任务变为 `blocked`，下一次 Pi 请求带 `reportAvailable:false`；来源元数据不一致也被拒绝。纯投影另覆盖宿主缺席、返回不可用和抛错；只读任务视图显示不可用。五文件专项 **49/49**；全量 **1855/1855、222 文件、23369 次断言**，日志 `%TEMP%/ohquant-report-availability-full-rerun-20260919.log`；typecheck、architecture（0 baseline violations）、build（3045 modules）通过。首轮全量仅有旧模型基准测试的固定 2 ms TPOT 下限偶发失败，改为检查正值后复跑全通过。此验证不等于真实模型语义或完整 UI 连续流程通过，F18/F20 仍部分完成。

## 2026-10-09：结构化恢复收口

F20 的本地恢复契约已按同一组条件重新核对：研究对象、市场/日期、基准、参数、组合 revision、已验收指标、DatasetRef、报告来源和未完成事项均从当前分支原事件与不可变归档重建；有损摘要不充当事实源。长历史优先保留任务绑定证据，缺档撤销核验但保留范围，失败 resume 不替换原会话，取消 compaction 不提交半份摘要，分支与多会话不串状态。

[真实 TUI 与 headless 等价任务](./research-tasks.md#2026-10-09真实-tui-与-headless-等价验收)补齐交互入口，[键盘组合工作流](../src/tui/test/research-workflow.test.ts)另从首次配置连续执行到比较、自动报告和无重新取数的恢复。与四类任务的压缩/重启矩阵、任务报告来源/可用性和恢复回答数值门槛合并后，F20 的结构化恢复条件已闭环。六文件专项 **51/51、497 次断言**，最终全量 **1878/1878**；完整工程结果记录在[实施记录](./feature-delivery.md#2026-10-09r06-第六阶段真实-tui-与结构化恢复收口)。这些证据不把固定模型回答扩展为普遍的自然语言正确率；该语义质量继续由 F12/F24 跟踪。
