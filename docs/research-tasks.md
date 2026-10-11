# 结构化研究任务与验收

更新：2026-09-19。[QuantResearchHarness](../src/runtime/quant-harness.ts) 提供结构化宿主 API；普通输入可经 `research_task` 工具声明、查看、关联重试和取消任务。AppRuntime 与无 UI 的 Quant Agent 使用相同工具链；现有 `/resume` 增加 `--task` 只读查看参数，一级命令仍为十个。完整任务交互、跨对象任务集及真实模型评测继续实施，F18/F20 保持部分完成。

2026-09-19 补充：任务验收现在双向比较声明与实际调用的完整参数。先前若声明省略 `cash` 而回测实际传入 `cash: 1000`，即使结果本身 verified，任务也可能错误地判为 satisfied；现在保留核验结果，但该条件 pending，并指出 `cash` 差异。模型可见提示也要求在声明时列出完整计划调用参数。专项 75/75、全量 1782/1782 测试，类型检查、架构检查及构建通过；[本轮真实模型复跑](./research-task-evaluation.md#2026-09-19完整参数验收后的股票复跑) 的流程检查 7/7，但人工审阅仍发现超出证据的解释，不能据此将 F18/F20 标为完成。

## 在终端中使用

配置模型后直接输入明确的研究要求，例如：

```text
研究 AAPL，2026-01-01 至 2026-02-09，SMA 1/2，零手续费；核验总收益和最大回撤。
查看这项任务的目标、验收条件和未完成原因。
继续原任务，保持原窗口和费用假设。
结束这项任务。
恢复这项任务，保留原范围和验收条件。
```

模型先读取当前任务及原输入 ID，再声明条件，随后调用计算工具；缺少对象、日期或必要假设时先补齐输入。`Quant.Research` 工具结果显示目标、范围、条件状态、缺项和报告引用。用户通过 `/resume` 恢复会话，通过 `/config` 配置 Auto Artifacts。模型能否正确拆解任意研究要求仍需评测。

在交互终端输入 `/resume --task`，直接查看当前分支的目标、原文、验收条件、证据、失败原因、重试关联和报告引用。方向键滚动，Enter 重新读取并核验本地证据，Esc 关闭。面板是打开时的快照；刷新不会发起模型/行情请求，也不追加会话记录、切换分支或修改任务，模型输出期间仍可查看。继续、修改或结束任务时，关闭面板后在 Composer 中输入要求。

这个参数必须单独使用，不能附加 session ID 或其他 flag。无 UI 宿主提供活动 Quant session 时返回同一投影的文本和 data；单次 shell 命令没有活动会话时明确报错，不自动选择最近的历史文件。

## 输入与判据

[ResearchTaskSpec](../src/types/research-task.ts) 保存调用方原始 request、目标、对象/市场/日期、可选基准和组合版本、允许工具、约束说明、可选固定数据版本、必需结果及报告要求。调用方负责把原始目标完整转换为验收条件；系统不假定这些条件覆盖自然语言目标的全部含义。

结构化宿主 API 仍要求显式、非空的任务 ID。模型通过 `research_task` 工具**第一次声明尚无任务**时，可以省略 `task.id`；宿主从已核对的当前用户请求 entry ID 生成 `study-<entry ID>`，把它写入提交事件，随后 read/恢复都返回同一个 ID。模型明确提供的有效 ID 原样保留。修改已有任务、取消后继续或另开任务时，必须从 read 复制原 ID 或显式选定新 ID，不能靠省略字段重置原任务的证据边界。生成 ID 只补齐元数据，不补写对象、日期、费用、指标或数据引用；缺这些必需输入仍会失败。原助手调用与生成后的提交事件分别保存在 journal，恢复时重新核对两者。

| 状态 | 判定 |
|---|---|
| active | 任务已声明，仍缺结果或匹配报告；一次模型停止不会自动完成 |
| blocked | 所需工具不可用、结果未核验、参数/范围/指标不匹配、版本冲突、未解决调用，或已绑定报告版本不可读/未由宿主核验 |
| complete | 所有声明的条件有匹配且重算通过的证据，无未解决调用或数据版本冲突；要求报告时另有对应来源记录，且固定版本可读、完整、来源元数据一致 |
| cancelled | 显式取消事件已记录；结果仍可查看，工具执行需先重新声明任务 |

每个 criterion 指定工具、完整调用参数和指标标签；空 metrics 表示仅要求该工具的核验结果。验收逐字段双向比较参数，实际调用新增的本金、费用、日期等字段也会导致不匹配，避免用未声明假设的计算结果满足条件。只有本任务开始后的调用才可满足条件；观察对象、实际计算日期、可选数据 revision/hash 和组合版本再独立检查。同一对象的独立计算条件不得混用不同观察版本；`show_dashboard` 的历史评分集合由排行榜逐项核验，允许其内部包含不同修订。显式固定的 `dataRefs` 仍逐项约束排行榜输入。调用前的守卫执行 allowedTools、显式标的/基准和日期边界，返回可解释的工具错误；自然语言 `constraints.notes` 是保留的说明，不是已经实现的任意规则执行器。默认 Quant 会话在 Pi `tool_call` 预检时使用当前已提交任务检查参数范围，被阻断的单工具批次要求停止下一轮模型请求；执行器还用同一判定复查。

若任务声明了 `scope.benchmark`，`score_benchmark` 的实际基准必须与之相同。省略 `benchmark_symbol` 会使用工具默认的 `000300.SH`；即使沪深 300 也列在任务的 `symbols` 中，它也不能代替另行声明的 `SPY` 基准。声明与调用均应显式传递所选基准；守卫在执行前拒绝不符调用，恢复投影同样不会将旧错误评分算作满足条件。

未声明 `scope.benchmark` 表示任务不约束单一基准。`scope.symbols` 仍限定研究标的；已核验评分的显式或默认基准、已核验排行榜中的全部基准，以及已核验组合比较的基准可作为比较输入，不要求混入研究标的列表。其它策略标的仍须在 `scope.symbols` 中。需要固定某个基准或其数据版本时，应声明 `scope.benchmark`，并按需提供 `dataRefs`。

`show_dashboard` 可把不同基准的历史评分排在一起。如果任务已声明单一基准，验收会检查整个已核验评分集合，而不只看显示的前十行；混入另一基准时不满足该条件。无效评分文件已从排行榜集合排除，输入提取也跳过其伪造或缺档的 DatasetRef，不会因此阻断合法任务或增加报告的缺档计数。有效评分的缺档引用仍阻断核验。跨基准历史排行榜仍可浏览，但应在未指定单一基准的研究任务中使用。

`research_task read` 的 metricLabels 按宿主可用工具提供价格分析、基金 DCA 和组合比较的准确标签。组合的单序列条件也应声明完整比较参数，包括基准和全部成员/基准的币种表；嵌套对象要求完整相等，不把 `{AAPL: USD}` 当作完整币种表的通配符。2026-09-15 补充参数差异诊断：已有同工具调用但条件未匹配时，显示最近调用中不同的顶层字段名，仍保持 pending，不将该次计算当作满足验收。具体参数见已记录操作，系统不自动改写用户条件。真实模型反例与回归见 [基金与组合评测](./research-task-evaluation.md#2026-09-15基金与组合评测扩展)。

组合标签由 [核验与发现共用的定义](../src/research/comparison-metrics.ts) 生成。声明前已有 `Common dates` 和 `Portfolio A/B` 两组各九个指标；不使用用户自定义组名替换序列标签。控制工具可调用 `{"action":"read","benchmark":"SPY"}`，额外返回 `Benchmark · SPY / ...` 的九个准确标签，metricLabelBenchmark 显示本次查询使用的规范代码。省略 benchmark 时使用当前任务的基准；尚无任务/基准时不猜测 SPY，也不返回虚构基准标签。显式查询 QQQ 只影响标签目录，不修改当前 SPY 任务、版本或任何计算条件。此参数仅用于 read，declare 仍在 task.scope 中保存基准。

该目录只声明指标名称，不保证样本能够计算该值；例如零波动的 Sharpe 仍可能为 null，要求该指标的验收不能因此通过。停用的 compare_portfolios / portfolio_comparisons 不出现在目录中；read 不获取行情或计算组合。

模型可见的指标区分原始值和展示值：百分比在内部以小数存储，例如 0.01；read 和研究上下文明确标为 fraction，同时提供 display=1%。普通数值与期间不乘 100，缺失值显示 N/A。核验和报告继续使用原始数值，展示转换不会改写证据。

因子支持显式 start/end，warmup 也包含在任务窗口内。基金任务保留 `.OF` 身份，DCA 调用可使用对应六位代码；完整 NAV 归档可包含窗口外历史，日期验收使用核验器实际计算的日期。组合 groupIds/portfolioRevision 只约束比较结果，成员的单标的分析另查对象、日期和输入版本。比较指标必须限定序列，例如 `Portfolio A / Total return`、`Portfolio B / Max drawdown`、`Benchmark · SPY / Total return`，不以含糊的 `Total return` 代替两组验收。

当前验收使用已有七类量化核验器，不从助手叙述推导数字。scope 的窗口是实际观察必须处于的边界，不能据此推定交易日完整性、历史当时可得性或指标适用性。更多任务类型和必需能力选择仍需固定评测。

## 按任务装配（2026-09-15）

每次 Pi 模型请求前，从已提交的原始分支重新投影任务，将实际工具 schema 和执行工具集合限制为宿主启用工具与 `allowedTools` 的交集，并保留 `research_task` 控制入口。没有任务时使用宿主集合；取消任务后只保留控制入口。声明结果成功落盘后，下一工具轮次即采用新范围；助手仅提出声明或执行中取消不会提前改变范围。

宿主启用集合与本次请求集合分别维护：`state.tools`、研究状态的 `availableTools` 和控制工具读口仍表示宿主可用目录，供新任务声明选择。临时装配不追加 `active_tools_change`，不会将一次回测范围固化为宿主配置。换任务可以选择其他已启用工具；重启后缺少的工具仍保持缺失，不自动启用扩展。压缩、重启和分支导航均从原 journal 重建范围。

技能装配沿用空闲边界保存的原始内容和依赖观察。任务未提供 `bash` 时，依赖 shell/本地文件读取的模式变为 blocked；系统索引、`getSkills()` 和显式调用消费同样的限定结果。工具循环中不重新探测 Python、不刷新扩展或安装结果。此规则只收缩已声明依赖的技能模式；尚未实现任意第三方技能的语义相关性排序，也不构成 shell 沙箱。

底层通用 `prepareTurnResources` 只接受已启用工具的唯一子集。首次请求准备失败或取消不会提交用户输入、替换宿主工具或产生模型请求；后续工具轮次失败保留先前已经提交的记录。Quant 策略通过 `prepareRequestResources` 和 `beforeToolCall` 端口注入；Pi 上游循环未被复制或修改。即使模型返回已移除的工具名，Pi 也会返回找不到工具的结果，原实现不会执行；已选工具在执行前检查对象、日期和参数范围。单个越界调用的本地 Pi SSE 反例从两次模型请求缩为一次；随后按原范围发起合法调用仍会执行。宿主注入的工具预检可先阻断合法任务调用，结果保留在会话中。Pi 对混合批次按全部结果决定是否继续，不能将一个被阻断工具解释为整批停止。[行为测试](../src/runtime/quant-harness.test.ts) 使用固定本地传输，不代表真实模型能正确拆解任意任务。

确定性传输原验证默认 106 个 schema；两个归档入口加入后，默认 108 个静态 schema 在单一回测任务声明后仍缩至 `research_task`、`run_backtest` 两个，取消后只剩前者。归档研究任务的验收参数须明确 symbol、market、start/end、analysis 与 `observed_before`，因子还需 factor；同一归档截止、结果版本和指标才能满足条件。验证入口：

```powershell
bun test src/runtime/research-task-tool.test.ts src/runtime/quant-harness.test.ts
bun test src/runtime/skill-readiness.test.ts src/agent/test/turn-resources.test.ts
```

覆盖新任务扩展能力、停用工具、跨会话隔离、有损压缩/重启/分支切换、运行中注册表刷新延迟、技能资格和准备失败/取消。这些是实际 Pi 请求与本地 SSE 的契约测试，不证明真实模型选用正确或端到端研究加速；F24 保持部分完成。

2026-09-15 工程复测：新增 8 项测试并扩充既有行为断言；全量 1346 pass / 0 fail，165 个文件、17173 次断言，耗时 87.40 秒。typecheck、架构检查（0 baseline violations）、build 和 whitespace 检查通过；本次更新的五份 Markdown 中 123 个本地路径链接有效。全部任务 fixture 使用临时目录、合成数据与本地模型传输，无真实账户或交易调用。

## 提示与 schema 一致性（2026-09-15）

系统提示不再复制完整工具说明目录。`system-prompt.ts` 只组装通用研究/展示约束、实际工具名、技能索引与显式传入的公开缓存观察；每个工具的描述和参数由本次 Pi schema 提供。默认本地读取留在 context.ts。Shell 使用说明仅在 bash 活动时出现；控制工具的日期指导使用各 schema 的实际字段，不介绍尚未启用的计算工具。

分析、新闻、引擎和组合提示保留各自的证据与假设要求，但改用已启用能力，不要求固定函数调用。显式回测或风险任务不会因为通用技术分析建议而追加无关指标，失败重试也不得暗中扩大原窗口。纯组装测试及真实 Pi/SSE 回归覆盖空工具、受限回测、技能禁用、动态自定义描述与宿主快照。

```powershell
bun test src/agent/test/system-prompt.test.ts src/agent/test/context.test.ts
bun test src/runtime/research-task-tool.test.ts src/runtime/research-evaluation.test.ts
```

本阶段新增 3 项测试，全量 1349 pass / 0 fail；类型、架构和构建检查通过。[真实股票样本](./research-task-evaluation.md#2026-09-15任务装配与-schema-提示复跑) 完成研究与恢复的 5 项自动检查，但研究阶段重复计算、约 235 秒时延及中间声明诊断缺口继续保留，不据此宣布完整研究质量达标。

## 宿主调用示例

```ts
import { createQuantResearchAgent, QuantResearchHarness } from "./src/runtime/quant-harness.ts";
import type { ResearchTaskSpec } from "./src/types/research-task.ts";

const task: ResearchTaskSpec = {
  id: "aapl-fixed-study",
  request: "回测 AAPL，2026-01-01 至 2026-02-09，SMA 1/2，零手续费；说明收益和最大回撤。",
  goal: "核验指定窗口与费用假设下的策略",
  scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
  constraints: { allowedTools: ["run_backtest"], notes: ["仅研究，不执行交易"] },
  dataRefs: [],
  criteria: [{ id: "returns", description: "收益和回撤有归档证据", tool: "run_backtest",
    parameters: { symbol: "AAPL", fast: 1, slow: 2, commission: 0 },
    metrics: ["Total return", "Maximum drawdown"] }],
  reportRequired: false,
};
const agent = createQuantResearchAgent();
const harness = new QuantResearchHarness(agent);
const state = await harness.run(task);
console.log(state.task);
```

示例会使用当前模型和数据连接；它不是零网络测试。`createQuantResearchAgent({ dependencies })` 支持已有完整注入端口。AppRuntime 默认使用这个工厂；宿主可调用 `await runtime.submitResearch(task, expectedRevision, signal)`，其消息、HUD 和报告路径沿用现有运行时。自定义 agentFactory 若绕过该工厂，也会绕过工具执行守卫。

已有任务修改需使用读取到的 `state.task.revision`：

```ts
await harness.update({
  version: 1, type: "declare", expectedRevision: state.task!.revision,
  task: { ...state.task!.spec, goal: "更新后的明确目标" },
});
```

修改同一 ID 保留该任务的研究范围起点；换 ID 开始新任务，旧分支记录仍保留。接口不会隐式删去既有失败来满足验收。输入在异步运行前复制，调用方后续修改对象不改变记录或实际请求。

`dataRefs` 用于固定用户指定或已经观察到的数据版本。尚无此类引用时声明 `[]`，不要虚构 revision/hash 来填充字段；后续计算仍需匹配归档证据才能满足验收。用户明确指定的版本必须保留，不匹配属于阻塞原因。工具 schema 与指导已说明这些规则，但没有用语义校验自动判断引用来源。修正模型自行添加的占位约束后，同一任务中的已有证据会按新条件重新核验，不必仅为填充可选引用重复计算；显式版本、参数或范围变化仍可能使原证据不再满足条件。[价格评测审计](./research-task-evaluation.md#2026-09-15逐次请求与任务审计) 留存首次声明、修正和中间状态，便于检查最终 complete 的形成过程。

## 重试、恢复与取消

`research_task` custom note 保存 declare/resolve/cancel 事件，expectedRevision 为调用方审阅的上一事件 ID。无效/过时事件不替换任务；投影提供 `taskErrors` 说明，宿主写入前先校验。同一 Harness 实例串行提交声明；它不取代 Session 文件的冲突/原子提交契约。

普通输入使用 [research-task-tool.ts](../src/tools/research-task-tool.ts) 的 read/declare/resolve/cancel。工具只准备事件，不在执行中等待自身 idle，也不把事件另排队写成 note；成功的 toolResult 经原 Session 原子提交后才成为任务事件，revision 就是该结果 entry ID。投影核对唯一且顺序匹配的调用、结果、实际 action 和用户原文；助手调用、错误结果、重复或篡改配对均不能声明任务。工具 read 的模型可见内容包含完整条件、最新请求 ID 和操作引用，不能只将这些字段放在 provider 看不到的 details 中。

模型工具的 expectedRevision 是直接从 read 复制的字符串。尚无任务时，返回绑定当前用户 entry 的初始令牌；已有任务时返回已提交任务事件 ID。用户换了输入，即使还没声明任务，旧初始令牌也失效；声明成功后旧令牌不能覆盖新版本。工具先验证令牌，再由任务层将合法初始令牌映射为 journal 的 null 前置条件，原事件版本校验继续执行。宿主 API 与既有 JSONL 的 null 事件仍按原契约恢复。没有原始用户输入时不能声明任务；模型无须自行构造 null 或令牌。

声明使用最近一条用户输入的 entry ID，宿主读取原 displayText/user 文本，不接受模型改写的 request。目标/条件仍由模型按用户要求填写；结构校验与原文绑定不证明其语义覆盖完整。声明和计算使用不同工具轮次，先前计算不能倒算为新任务证据。控制工具可在任务取消后继续 read/declare，不受计算 allowedTools 集合阻断；它不调用行情、修改组合或提交订单。

`declare` 的 `task.id` 是非空必填的本地研究标识；新任务选稳定 ID，修订沿用原 ID。字段 schema 与任务工作流已明确这一点，且本地 Pi/SSE 证实两处说明进入实际模型请求。固定基金真实模型在新增说明后仍第一次漏填，由 schema 拒绝、留下错误结果，随后补齐；不能把最终任务 complete 或评测 `passed=true` 当作“首次声明可靠”。原请求、范围和验收条件不会因为补 ID 而由宿主猜测或放宽。证据见 [固定基金解释回归](./research-task-evaluation.md#2026-09-15固定基金样本的解释回归)。

resolve 需指定 `{callEntryId, callId}` 的 from/to 和原因：源调用尚未解决，目标是同任务中更晚、工具和完整参数一致、核验通过的结果。关联只改变待办投影，原失败保留。归档丢失或任务输入要求变化后，关联会变成 inactive，原待办重新出现；已记录的事件 revision 保留，便于继续修改。不能用“重试成功”的文本结论关联不同参数或不同任务。

验收状态由证据自动计算，resolve 不能手动标记条件完成。若模型声明漏写原请求中的参数，应依据原请求更正同一任务声明；已有同任务计算会重新匹配，无须重复计算。用户要求的范围、版本或费用不得为了通过验收而删除。

恢复从当前分支原 entries 重建，不从有损摘要猜测条件。真实 JSONL 测试主动将任务与参数排除出压缩后的模型消息，重新打开仍能恢复验收状态并注入下一次模型请求；切回中断 leaf 则重新显示缺项。显式任务的对象/窗口覆盖旧 SessionCtx 提示，多对象任务不猜测单一最近标的。

执行取消保留已提交的任务与证据，尚未得到结果的条件继续未完成。Session `prompt(..., {signal})` 在初始化等待、模型设置、自动压缩、上下文准备和正式请求边界检查取消，执行期间向原 Harness 发出 abort。停止整个任务则另写显式 cancel 事件。取消发生在已提交声明之后不会倒删该记录。

## 报告与验证边界

`reportRequired` 检查报告来源 entry ID/父链/哈希中包含当前任务 revision 及全部必需结果；不把另一份报告或后续改写来源计为完成。任务同时保存通过检查的 `reportEntryId`，恢复上下文按该事件保留较早的报告标题，并与同 `reportRef` 的其它记录区分。`reportRef` 保留来源绑定的固定引用，`reportAvailable` 表示宿主是否还能读取与该来源元数据一致的不可变版本；缺档/损坏为 `false`，未提供核验端口为 `null`，两者都会阻止 `complete`。其它历史报告引用仍只是会话记录。打开与恢复仍由 Artifact 服务执行完整来源会话验证；研究任务状态属于内部会话资料，可能含用户原文和组名，不能替代公开分享 DTO。

```powershell
bun test src/research/tasks.test.ts src/runtime/quant-harness.test.ts
bun test src/research/task-actions.test.ts src/runtime/research-task-tool.test.ts
bun test src/tui/test/research-task-panel.test.ts
bun test src/agent/test/research-recovery.test.ts src/artifact/test/report-recovery.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

第三阶段 14 项新增测试使用真实计算/归档、Pi 循环、JSONL 和本地 HTTP/SSE。覆盖人工收益 `139/102 - 1`、两个 runtime 入口、报告绑定、版本冲突/缺档、重试关联、取消、输入快照、过时声明、有损恢复及旧对象隔离。固定模型响应不等于自然语言研究成功率；股票、指数、基金、组合与失败任务集仍需扩展。

第四阶段新增 18 项测试：9 项 runtime/命令链路、3 项事件来源校验、6 项面板渲染与按键测试。固定响应从实际 provider 收到的工具文本中取得 requestEntryId、revision 和失败/成功引用；未绕过工具读口直接访问 Agent 状态。覆盖普通 prompt 与 AppRuntime.submit、已声明但未计算、过时修改、取消、同参失败重试关联、有损恢复，以及错误/缺失/重复/乱序/改写原文的记录。

面板在 60×20、80×24、120×32 单元格下验证中文换行、完整内容可滚动到达、固定底部操作、尺寸变化、按键重映射、关闭与切换清理。真实 AppRuntime 在模型请求未结束时查看/刷新，验证不新增请求、不改分支或对话。这里是自动化渲染与按键契约，不替代真实终端视觉验收；没有真实模型、外部市场或账户调用。

第五阶段的 [跨对象固定评测](./research-task-evaluation.md) 扩展股票、指数、基金、组合与缺数据/失败续问；通过实际工具/归档/报告/JSONL 验证，并修正日期、基金别名、组合条件和失败诊断的缺口。模型语义和完整终端视觉仍需单独验收。

## 2026-10-09：真实 TUI 与 headless 等价验收

[终端工作流测试](../src/tui/test/research-workflow.test.ts)现在用同一 AAPL 风险请求、同一任务声明和同一固定行情，分别通过 `agent.prompt()` 与真实 `QuantTui` 键盘解码、Composer 提交、AppRuntime、Pi 工具循环执行。两个入口运行在隔离数据根中，最终逐项比较任务 spec、条件状态、核验操作和指标；TUI 还必须实际显示最终回答。该测试不以直接调用面板或 runtime 回调代替键盘入口。

既有同文件测试继续覆盖 80/120 列下首次模型与行情配置、可见组合编辑、比较、自动报告、清屏和报告恢复；任务矩阵覆盖股票、指数、基金、组合的 headless/AppRuntime、缺数据/供应商失败、同参数重试、报告和有损恢复。Quant Harness 专项六文件共 **51/51、497 次断言**通过，最终全量为 **1878/1878**。固定 SSE 只验证执行与状态契约；自然语言解释质量和真实供应商覆盖分别由 F12/F24、F08/F21 继续验收。按 PRD 的本地功能闭环口径，F18 的验收条件已满足。
