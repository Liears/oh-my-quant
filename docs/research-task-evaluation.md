# 研究任务评测

更新：2026-09-14，含 R06 第五至第七阶段。固定矩阵入口为 [research-task-matrix.test.ts](../src/runtime/research-task-matrix.test.ts)。这组测试检查研究任务的执行、证据与恢复契约；模型动作由固定 SSE 响应给定，不测自然语言理解准确率。真实模型入口、运行记录及人工审阅范围见后文。

## 执行范围

四类任务分别通过普通 `agent.prompt` 与 `AppRuntime.submit` 执行：读取当前任务 → 声明条件 → 调用实际量化工具 → 核验 → 生成绑定报告 → 有损压缩 → 重启 → 读取原任务和报告。请求 ID 和 revision 从模型实际收到的工具文本取得。

使用真实 Pi 循环、数据编排、缓存、不可变归档、量化计算、报告生成器与 JSONL。仅行情/NAV 供应商传输和模型响应使用 fixture；所有文件位于隔离 TEMP，测试后关闭 HTTP 服务并清理。没有真实市场、模型或账户调用，也未验证终端/浏览器视觉。

| 任务 | 必需结果 | 人工检查及反例 |
|---|---|---|
| 美股 AAPL | 指定窗口 momentum(2)、波动率和最大回撤 | 合成价格 100…139，末值 `139/137 - 1`；窗口外额外放入价格 999，不能进入计算 |
| 指数 000300.SH | 同窗口 momentum(2)、风险 | 相同人工公式，经 A 市场数据编排；保留 `.SH` 指数身份 |
| 基金 270042.OF | 本金收益、TWR、TWR 最大回撤 | 2 月/3 月 NAV 0.5/0.75，每次投入 100，零费；本金收益 25%，TWR 50%。归档另含 1 月 NAV，实际计算日期不含该月 |
| 股票组与基金组 | 两组各自收益/回撤、股票成员风险 | 共同日期 1 月 1 日/2 月 1 日，AAPL 100→131 为 31%，基金 1→0.5 为 -50%；USD 是显式合成报价假设，不是实际基金币种声明 |
| 无数据 | 缺项、失败原因、后续同参重试 | 不产生指标或归档引用；保留 DATA_NOT_ENOUGH，数据补齐后仍需显式关联重试 |
| 供应商失败 | 原错误、失败记录、后续同参重试 | 全部 fixture provider 失败时不伪装成正常空数据；重试成功不删除旧失败，不更改任务条件 |

正向任务还分别验证：缩窄日期后原证据不能完成新范围；组合版本或组顺序不符时阻塞比较条件；不带组限定的 `Total return` 不能冒充两组收益；报告未生成时保持 active，来源绑定完成后才 complete。压缩主动移除任务参数与结果，恢复从原分支重建，不从摘要猜测。

补充回归拒绝非法因子日期、改写因子请求窗口和基金/股票六位代码混淆。基金裸代码只在基金 DCA 工具中按 `.OF` 解释，股票工具不沿用该别名。

## 本轮修复

- `compute_factor` 增加 start/end，传入数据编排、任务参数和报告核验；warmup 也在这个闭区间内，不额外取窗口外数据。
- `ResearchOperation.evaluatedDates` 从核验器的计算曲线/比较日期或完整输入推导。NAV 完整归档可宽于计算窗口，归档 identity/revision/hash 仍逐项核验。
- 组合任务的组 ID/revision 只约束比较结果。单标的风险仍检查对象、日期和数据版本，不被要求伪造组合元数据。
- 组合条件通过 `Portfolio A / Total return`、`Portfolio B / Max drawdown` 等限定标签区分序列；分享报告 DTO 不添加私有组信息。
- 业务错误保存 `details.error`，研究投影识别为 failed。无可用数据且存在供应商错误时保留来源诊断；有效的 stale-cache 回退规则不变。

## 复跑

```powershell
bun test src/runtime/research-task-matrix.test.ts
bun test src/research/tasks.test.ts src/tools/quant-tools.test.ts src/tools/shared/results.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

固定矩阵不能证明模型会正确选择目标、指标、工具或解释条件。F12/F18/F20 仍需真实模型的研究输入集、解释与失效条件检查，以及完整终端任务验收；不以固定响应通过率替代这些要求。最新工程检查结果见 [实施记录](./feature-delivery.md)。

## 真实模型入口

R06 第六阶段新增 [evaluate-research.ts](../scripts/evaluate-research.ts) 和独立 [research-evaluation.ts](../src/runtime/research-evaluation.ts)。使用已保存的模型连接、实际 Pi 循环、Quant 工具与研究投影；价格读取注入固定的合成观察，不访问真实行情。每次运行在独立 TEMP 保存归档和 JSONL，结束后清理；输出文件保留检查结果和模型回答。

```powershell
# 无模型调用，查看参数
bun run eval:research -- --help

# 会产生模型用量；输出路径必须尚不存在
bun run eval:research -- --case all --timeout-ms 120000 --max-requests 12 --output output/research-evaluation.json

# 本地确定性回归，无外部模型调用
bun test src/runtime/research-evaluation.test.ts
```

`--case` 默认 stock；支持 stock、index、fund、portfolio、annual，21 个 `skill-*` 案例，以及 news-conflict、news-role-spoof、news-missing、news-hk、news-reversal、news-all 和 skill-all，契约见 [新闻模型评测](./news-evaluation.md)、[年报模型评测](./annual-evaluation.md)与 [Skill 模型评测](./skill-evaluation.md)。当前 all 包含四类量化任务、五个新闻样本、一个年报样本及 21 个 skill 样本，共 31 例；历史 all 结果仍按当时范围保留。每例总时限包含完整案例，默认 120 秒、最多可设 600 秒；请求限制计量 Agent 的 provider-request 事件，不是底层 HTTP 重试次数。Ctrl+C 取消；退出码 0 仅表示列出的自动检查通过，1 表示未通过，130 表示取消。

股票/指数要求明确声明原文、对象、日期、momentum(2)、年化波动率和最大回撤，基金/组合使用下文列明的条件，然后调用实际工具。自动检查范围与必需条件完整、任务经证据核验完成、没有未解决失败、独立数值一致。只有这四项证据检查全过才追加故意遗漏细节的压缩记录，创建新 Agent 并恢复同一 JSONL，再检查任务未改变、没有重新计算。2026-09-15 补充研究/恢复各自正常结束且有非空最终文本，当前共七项；恢复成功不能掩盖研究回答失败。此处恢复是同进程的新实例，不是操作系统进程重启。

结果保留 provider/model/protocol/thinking、端点哈希、facade system prompt 哈希、宿主工具名、耗时、请求事件数、已结束 assistant 消息上报的 token 用量、逐项检查、任务与操作证据、失败工具的原始参数和错误，以及研究/恢复回答。2026-09-15 新增逐次准备请求与任务过程审计，字段边界见文末。不会主动导出连接凭证或原始端点；任务原文、工具参数及错误仍属于内部评测资料。中止请求的用量可能不完整；哈希不等于已经归档全部 prompt 或依赖版本。

stock/index 只开放三个价格计算工具与 research_task；fund/portfolio 的工具集合和输入见后文。所有样本关闭外部 skills，并附加合成数据说明。股票/指数合成价格为连续日历日 100…139，数据来源标签仅用于归档契约，不代表供应商返回了该行情。自动通过后仍需逐份审阅数值解释、适用/失效条件、有无把合成上涨解释为实际投资机会，以及恢复回答是否完整；不能外推为全工具集或完整终端的总体成功率。

入口回归覆盖：实际工具与有损恢复、只有口头完成但无证据、删除必需条件却显示任务 complete、重复工具请求上限、停滞请求超时、注入端口实例隔离及禁止真实数据回退。

## 2026-09-14 真实运行记录

首轮使用保存的 `zai-coding-cn / glm-5.3-flash`、openai-completions、high thinking；每例 120 秒、最多 12 个请求事件。未修改用户连接设置。[原始结果](../output/research-evaluation-2026-09-14-initial.json) 保留不覆盖。

| 样本 | 结果 | 请求事件 | 已上报 input / output tokens | 留存任务与计算 |
|---|---|---:|---:|---|
| AAPL | 120 秒超时 | 6 | 9575 / 4717 | task=null，operations=[] |
| 000300.SH | 120 秒超时 | 8 | 9730 / 3702 | task=null，operations=[] |

两例均未通过，均未进入压缩恢复，不能给出解释质量或恢复语义通过结论。首轮入口只在普通 prompt 结束后填充 checks，因此超时结果是空检查数组；后续已修正为结束清理后核对已提交证据，超时依然不通过。新增 toolFailures 保存被拒绝的工具结果，避免声明失败后只有空任务而没有诊断。没有改动原始结果或放宽条件。

首轮文件 SHA-256：`a52e894c2298696399ec0d1d9257a66ff8032bf5a15851b3ff42a43683d037a2`。原始结果不能定位最早失败的工具或参数，需使用修正后的诊断入口复跑；请求次数本身不能证明工具已成功执行。

[诊断复跑](../output/research-evaluation-2026-09-14-diagnostic.json) 将股票时限设为 180 秒、请求上限 8；仍超时，四项检查全失败，保留五次任务控制错误。随后 [参数诊断](../output/research-evaluation-2026-09-14-arguments.json) 使用 120 秒、上限 4，因请求上限停止。记录确认模型两次传入字符串 `"null"`，随后省略 expectedRevision；另将 `Maximum drawdown` 写为 `Max drawdown`。这些样本和不同预算分别保留，不合并成可比成功率。

据此修正生产工具契约：schema 明示首次声明需要 JSON null；版本错误回传预期值及类型提示；read 直接返回 expectedRevision/requestEntryId，并按当前工具集合提供价格工具的 metricLabels。标签与归档核验共用 `PRICE_RESEARCH_METRICS`，不另造一份评测专用别名，也不把错误字符串自动转成 null。新增回归验证先拒绝字符串 null、再接受正确版本，原验收条件保持完整。基金与组合的指标发现仍需后续扩展。

[修正后股票样本](../output/research-evaluation-2026-09-14-revised-stock.json) 使用同一连接、180 秒和上限 12，在 176.34 秒结束，8 个请求事件，已上报 30102 / 7325 input/output tokens。模型选用了正确指标标签并完成实际因子/风险计算，但仍三次发送字符串 `"null"`、一次省略版本字段；任务没有声明成功。仅独立数值检查通过（1/4），整体失败，未进入恢复。`outcome=finished` 只指请求正常结束，不是研究验收完成。

本次回答逐项审阅：

- Latest 约 0.0146，独立值 `2/137 = 0.0145985401459854`；最大回撤为 0。
- 波动率约 1.30%，独立 Python 以 `r = 1/p, p=100…138` 计算样本标准差再乘 `sqrt(252)`，得到 `0.013038293078614618`，与归档核验值一致。
- 回答说明合成数据、固定窗口、40 个观察、小样本限制，以及零回撤不等于无风险；未将其当成实际买入机会。日期/周期/数据变化需重算的限制有交代。
- 回答明确承认任务声明失败，但声称传输把 null 强制转换为字符串。留存记录只证明工具收到字符串，不支持该传输归因；确定性真实 Pi 测试可正确传递 JSON null。因此解释质量仍有无依据的因果判断，不能标为完整语义通过。

尚待解决：真实模型首次声明的字段可靠性、声明失败后的任务流程、基金/组合真实样本、成功声明后的真实恢复回答与完整终端验收。F12/F18/F20 状态继续为部分完成。

## 工程回归与时限

新增六项入口回归，覆盖真实 Pi 加固定传输、验收条件完整性、截止/请求上限、端口隔离、失败参数留存以及错误版本纠正。CLI 帮助的 text/JSON 和模型错误的 slash/shell 各拆成独立用例，避免两个冷启动共享默认的 5 秒测试时限；每个子进程显式限时 10 秒，测试看门狗 15 秒，模型 probe 仍限时 2 秒。异步子进程在 finally 中终止并等待退出，原输出/鉴权脱敏断言保留。集成时限不作为启动性能达标证据。

复核中保留了失败日志：`%TEMP%/whyj-r06-model-evaluation-reviewed.log` 的 Doctor 等待超时，以及 `whyj-r06-model-evaluation-complete.log` 的两个 CLI 子进程超时。相关入口单独复跑为 24 pass / 0 fail；不删除失败记录，也不把真实模型样本算进确定性测试通过数。

最终工程回归：**990 pass / 0 fail，129 文件、10123 断言，187.06 秒**，日志 `%TEMP%/whyj-r06-model-evaluation-final-reviewed.log`。相对第五阶段新增六项评测测试，另两个旧的多入口用例拆为四项，不把拆分计为新增能力。root typecheck、评测脚本独立 strict typecheck、architecture（0 baseline violations）、build（2665 modules / 5.96 MB）通过。此结果不覆盖真实模型语义、真实市场或完整终端视觉。

## R06 第七阶段：声明版本令牌

上一阶段真实模型样本显示，仅增加 null 类型说明没有解决首次声明。当前工具改为复制 read 返回的 expectedRevision 字符串：未声明时令牌绑定用户 entry，声明后使用事件 ID。工具检查观察版本，任务层再转换内部 null 前置条件；不隐式接受字符串 `"null"`，不自动读取当前版本替调用方放行。既有 journal 中的 null 声明继续按原事件恢复，避免改进调用接口破坏旧研究证据。

固定矩阵与普通 headless/AppRuntime 工具测试改从实际模型可见 read 内容取得令牌。新增反例验证输入变化前的初始令牌失效，以及新令牌/旧 null 记录形成相同内部事件，篡改令牌则不能恢复为有效任务。原始失败样本保留，当前接口与历史运行说明按阶段区分。

同一保存连接的 [180 秒双样本](../output/research-evaluation-2026-09-14-revision-token.json) 均完成声明与计算，四项初始检查全过，但在恢复阶段超时（各 9 个请求事件），整体仍失败。两例各有一次 schema 错误，模型自行改正后未绕过核验；不是无错误执行。

随后 [300 秒双样本](../output/research-evaluation-2026-09-14-revision-token-300s.json) 保持原任务与检查，仅改变总时限：

| 样本 | 时长 / 请求事件 | 自动结果 | 回答与限制 |
|---|---|---|---|
| AAPL | 122.09 秒 / 5 | 结构检查 5/5，但 request-failed，passed=false | 保留研究回答，恢复请求失败，无完整恢复回答 |
| 000300.SH | 240.28 秒 / 9 | 5/5，finished，passed=true | 研究与恢复回答均留存；任务/条件未改变，没有重新计算 |

300 秒指数样本的数字、对象、日期、指标与原证据一致，并声明合成观察与小样本限制；但恢复回答将 `0.013038` 标成 percent，可能被理解为 0.013038% 而非约 1.3038%。另外，两份研究回答对超短周期均值回复、噪声或最少样本量作了未由本次实验支持的推断；尤其股票回答的“20 日”阈值不是风险工具的 30 bar 最低输入要求。自动检查通过不能代替这些解释质量检查。没有据单个自动成功样本宣布 F12/F18/F20 完成。

模型上下文现采用独立 `researchMetricsForModel` 投影：内部 percent 指标的原始值不变，模型可见 unit 改为 fraction，并增加已换算的 display，例如 `value=0.013038293… / unit=fraction / display=1.3038293%`。任务 read、恢复后的系统上下文以及组合 series 使用同一投影；报告和核验 DTO 保持原格式。新增正/负/零/null、普通数值/期间单位及恢复上下文回归，实际 Pi 工具文本也检查换算后的值。

令牌阶段工程回归为 **993 pass / 0 fail，129 文件、10130 断言，57.92 秒**（`%TEMP%/whyj-r06-revision-token-reviewed.log`），其中一个旧双入口 CLI 用例拆为两项。先前全量的 Doctor 编排测试重复导入本机 AKShare，现通过既有依赖端口注入固定状态；独立 `doctor-tools.test.ts` 仍验证依赖失败、取消与超时。损坏配置的 doctor/help 冷启动分别测试，显式子进程时限与清理保持，原字节/脱敏断言不变。该回归早于上述单位投影，单位改动另作最终验证。

[单位修正后的指数样本](../output/research-evaluation-2026-09-14-units-index.json) 使用同一连接、300 秒预算和最多 12 个请求事件，实际耗时 **167.30 秒、9 个请求事件，finished / passed=true，5/5 检查通过**；已上报 input/output tokens 为 65993 / 7742。保留一次声明含多余字段的失败，模型随后纠正。恢复回答将年化波动率正确显示为 **1.3038%**，日期、周期、验收条件与证据引用保持，没有重新计算或改写任务。

人工审阅仍限定结论：回答说明了合成序列和适用窗口，但来源字段 financial-datasets 是测试归档标签，不是供应商实取证据；“短周期对噪音高度敏感”等概括没有通过本次单调合成序列实验验证。该单例不能代表股票恢复请求已修复，也不覆盖基金、组合、全工具集和完整终端验收。F12/F18/F20 保持部分完成。

单位修正后的最终工程回归：**995 pass / 0 fail，130 文件、10137 断言，58.33 秒**，日志 `%TEMP%/whyj-r06-metric-units-final.log`；typecheck、architecture 和 build（2666 modules / 5.96 MB）通过。新增两项单位投影测试，实际恢复工具文本增加百分比断言；没有放宽任务验收检查。

## 2026-09-15：任务装配与 schema 提示复跑

[股票样本原始结果](../output/research-evaluation-2026-09-15-scoped-prompt.json) 使用保存的 `zai-coding-cn / glm-5.3-flash`、openai-completions、high thinking，300 秒总时限、最多 12 个请求事件。生产提示已移除完整手写工具目录，并在声明后按任务装配；本例宿主仅提供三个价格工具和控制工具，关闭外部技能，价格仍为固定合成观察。

```powershell
bun run eval:research -- --case stock --timeout-ms 300000 --max-requests 12 --output output/research-evaluation-new-stock.json
```

结果为 **finished / passed=true，5/5 自动检查通过**：235.35 秒、9 个请求事件，已上报 input/output tokens 为 77550 / 9622，没有工具错误回执。研究与有损压缩后的恢复回答均保留；恢复没有新增计算，也没有修改最终任务、日期、周期或验收条件。本例不能用来宣称提示改动降低了延迟或总 token：没有同条件重复采样的对照。

人工审阅：

- 最新动量 `139/137 - 1 = 0.0145985401`，研究解释为约 1.46%；年化波动率在两阶段均为 1.3038293%，最大回撤为 0%，与核验结果一致。
- 回答限定合成序列、原始窗口、period=2、252 期年化和小样本，不推断真实持仓或提供实盘指令。`financial-datasets` 仍只是测试归档标签，回答的 Source 行不能当作供应商实取证据。
- 研究阶段实际保留四个已核验操作：因子和风险各执行两次，参数与数值相同。自动通过仅要求最终条件完整及恢复不重算，不将这次重复视为高效执行。
- 回答自述初始 dataRefs 为占位，后经版本更正再计算；最终任务 notes 也记录更正，但导出文件未保留每次声明原文和中间任务状态，无法完整独立复核该过程。不能把模型自述当作新增审计证据。后续需保留声明诊断，并约束无来源的版本占位。

本文件的历史 `config.toolNames` 表示宿主启用目录，`systemPromptHash` 来自 facade 状态，不是逐次实际请求的工具集合或完整动态提示存档。实际 schema 收缩由本地 HTTP/SSE 的 [任务工具回归](../src/runtime/research-task-tool.test.ts) 单独验证。后续需扩充逐次请求审计、基金/组合真实样本和完整终端验收；F12/F18/F20/F24 仍保持部分完成。

同轮工程回归：**1349 pass / 0 fail，166 文件、17200 断言，89.90 秒**；typecheck、architecture（0 baseline violations）、build（2955 modules / 6.69 MB）及 whitespace 检查通过。新增两项纯提示组装测试和一项动态 schema 回归，并扩充既有受限任务断言；没有放宽真实模型检查条件。

## 2026-09-15：逐次请求与任务审计

[research-evaluation-audit.ts](../src/runtime/research-evaluation-audit.ts) 独立观察原 Agent 事件，不复制循环、执行工具或另写任务日志。价格评测 stock/index 的结果新增 `audit.version=1`；新闻评测尚未接入此模块。

| 字段 | 保存内容与边界 |
|---|---|
| `preparedRequests` | 按事件顺序保存 research/recovery 阶段、API、准备 payload 的 JSON SHA-256 与 UTF-8 字节数。`scope=prepared-payload` 不证明 HTTP 已发送、供应商已接收或产生计费；也不用于计数底层重试 |
| `toolNames` / `toolSchemasHash` / `instructionMessagesHash` | 从 openai-completions 准备 payload 提取工具名、完整 tools JSON 哈希和 system/developer 消息 JSON 哈希。其他协议或无法映射的结构标记 `unsupported-or-invalid`，这些字段为 null；不能将 null 解读为没有工具 |
| `toolTrace` | 原 assistant 调用参数、toolResult 成败/错误和任务事件，附阶段、callId、工具名及当时已提交的 journal entry ID。后续修正不会覆盖首次声明 |
| `checkpoints` | 每次 turn_end 读取当前已提交分支，复制 leafId、任务/版本/条件状态、taskErrors、操作核验状态和未解决项；不是随后独立排队写入的宿主消息全部落盘后的快照 |

不保存原始请求 payload、完整工具 schema 或指令正文。哈希用于一致性对照，不能单独还原请求。旧 `config.toolNames` 和 `systemPromptHash` 分别增加 `host-enabled`、`facade-state` 范围标识，仍不能代替上述逐次记录。参数、任务原文和错误可能包含调用方提供的私有内容，审计文件不等同于公开分享 DTO。

工具指导明确：尚无用户指定或工具观察到的版本时，使用 `dataRefs: []`；已有明确版本必须保留，不匹配应阻塞。此处是声明指导，没有新增“来源真实性”的语义强制校验。固定模型回归先声明占位版本并得到 blocked，随后修正同一任务，验证旧声明/阻塞状态仍可追溯，且能复用两项已核验证据，无须再次计算。另以本地 HTTP 收到的 JSON 哈希对照准备请求，验证声明前四工具、声明后三工具以及恢复的记录；不将本地传输证明外推到真实供应商。

[新增审计的股票样本](../output/research-evaluation-2026-09-15-audited-stock.json) 使用相同保存连接、300 秒总时限和 12 个请求事件上限，结果为 **finished / passed=true，5/5 自动检查通过**，耗时 **122.61 秒**，**5 个请求事件**，已上报 input/output tokens **25662 / 4881**。文件 SHA-256：`50ffdfe7a9a91bbea7d8a9594f936e5fb979651941cf5ef7eb8a90ea21a798ad`。

审计记录确认：首次且唯一一次声明使用空 dataRefs，无占位版本；因子和风险各执行一次，均 verified，无工具错误。五次准备请求的工具数量为 **4、4、3、3、3**，最后一次为恢复阶段；声明提交后没有再提供 run_backtest。任务从未声明到 active 再到 complete，恢复保持同一版本和三项验收条件，没有新增工具调用。

人工审阅中，研究与恢复的最新动量约 0.0146、年化波动率约 1.30%、最大回撤为 0，与归档计算一致。回答注明合成数据、窗口和年化假设；VaR/CVaR 明示为历史逐期收益，不能解读成损失预测。研究回答的 VaR 99 来自原风险工具文本，但并未列入三项必需条件或自动数值检查；其他概括性解释仍需独立审阅。来源 financial-datasets 只是合成归档标签。相比上一样本，本次没有重复计算，但单次耗时/token 差异不能证明提示改动的稳定收益。

同轮工程回归：**1352 pass / 0 fail，167 文件、17237 断言，90.02 秒**，日志 `%TEMP%/whyj-eval-audit-final.log`；typecheck、architecture（0 baseline violations）和 build（2955 modules / 6.69 MB）通过。新增两项 payload 审计测试和一项声明历史回归，保留原五项模型验收检查。基金/组合真实模型样本、第三方技能相关性与完整终端验收仍待补齐；F12/F18/F20/F24 保持部分完成。

## 2026-09-15：基金与组合评测扩展

[基金工具](../src/tools/fund-dca-tools.ts) 新增 createFundDcaTool，接受独立 NAV 读取接口；[组合工具](../src/tools/portfolio-tools.ts) 新增 createComparePortfoliosTool，复用现有 PortfolioComparisonDeps。默认实例仍使用原生产取数、计算、归档与取消流程，[注册工厂](../src/tools/registry.ts) 可按宿主注入，互不修改全局工具。基金验收标签由 [同一核验模块](../src/research/fund.ts) 提供给 research_task read，声明前即可查找准确标签。

| 样本 | 隔离数据及工具 | 必需条件与独立预期 |
|---|---|---|
| fund | fund_dca_backtest + research_task；270042.OF 合成 NAV：1 月 1 日为 1、2 月 1 日为 0.5、3 月 1 日为 0.75 | 仅 2 月至 3 月，每月 1 日投 100，显式零费 decimal；本金收益 25%、TWR 50%、TWR 最大回撤 0 |
| portfolio | list_portfolios、compare_portfolios + research_task；在空 TEMP 建 Core/AAPL、Stable/MSFT，40 个日历日价格分别 100…139、恒定 100，SPY 为 100…119.5 | 1 月 1 日至 2 月 9 日；原组合 ID/版本、SPY、USD 等权买入持有、缺成员失败；两组累计收益 39%/0%，最大回撤均为 0 |

基金 NAV 使用生产规范化与不可变归档，包含窗口外 1 月观察但不进入本次投资计算；费用缺省或其他基金直接拒绝，无真实取数回退。组合 [独立 fixture](../src/runtime/research-evaluation-portfolio.ts) 只支持列明的代码/日期/USD，实际计算保存可重算的比较档案；其他币种或请求范围拒绝，不查询 FX 或修改真实组合。来源名称只是归档类型标签，不是供应商实取证明。每例只使用正文中的原始请求，不额外提供正确答案；模型说明由生产提示生成。

评测仍要求声明原始请求、精确范围、完整必需条件、归档核验完成、无未解决失败，以及独立数值一致；初始四项全部通过才进入有损压缩与新 Agent 恢复，第五项要求同任务/版本且不新增操作。股票、指数与新案例使用同一个执行/审计/取消模块，未复制 Agent 循环。

补充等价输入规则：基金工具接受裸代码或对应 `.OF`；组合选择接受正确的 ID 或名称，缺成员策略省略等价于生产默认 fail。scope.symbols 的顺序不影响集合含义，组合显式 benchmark 可同时列入 symbols；组 ID 顺序、版本与 benchmark 本身仍逐项匹配，额外 GOOG 不被允许。基金费用和日期被改写、删除 TWR 验收、其他基金/汇率回退、非空组合 fixture 都有拒绝回归。

### 首轮原始结果与人工核对

使用保存的模型连接；以下不同预算与不同对象不合并为成功率。

| 结果文件 | 预算 | 实际耗时 / 请求事件 | 自动检查与结果 |
|---|---|---|---|
| [基金首次](../output/research-evaluation-2026-09-15-fund-initial.json) | 300 秒 / 12 | 300.02 秒 / 6 | 四项研究检查均通过，恢复阶段超时；passed=false |
| [组合首次](../output/research-evaluation-2026-09-15-portfolio-initial.json) | 300 秒 / 12 | 123.20 秒 / 5 | 3/4；研究已核验完成，但评测把 symbols 中显式 SPY 错当额外标的，未进入恢复；passed=false |

基金文件 SHA-256：`F2664D7DAEDD83460B02618FF5E530D2F8D78640A582DA5FCF78E04626BA6073`；组合文件：`7D9B0F913B413EA67B2BAC9838B2F34A924FBF3E1495075C99694FA824A50876`。两份原始文件不修改，评测修正不追写历史 passed 字段。

基金首次：已上报 input/output tokens 为 41081/7646。唯一一次 DCA 调用，零工具错误；声明保留 .OF 身份、日期、投入/频率/费率和三项验收。回答区分 25% 本金收益、50% TWR 和 0% TWR 回撤，注明单位净值不含分红/拆分/赎回成本。另列 XIRR 19645.828% 为参考而非验收项；这一极短窗口的年化数值不能当作预期回报或实际账户业绩。“持仓 2 期”等表述不够准确，实际证据是两次合成申购。

组合首次：已上报 input/output tokens 为 41339/4187，零工具错误。读取组信息、声明后仅执行一次比较；四项指标正确，解释给出 SPY 19.5%、超额 ±19.5 个百分点、MSFT 零波动下 Sharpe N/A，明确固定快照与无真实交易结论。它把后续数据版本变化笼统表述为原结果失效：更准确的说法是旧报告仍对应原快照，新研究须重新核验。初次 scope 拒绝属于评测误判，修正后以 SPY 正例、GOOG 反例验证等价边界。

```powershell
# 使用保存连接，会产生模型用量；必须选择尚不存在的输出文件
bun run eval:research -- --case fund --timeout-ms 600000 --max-requests 12 --output output/fund-evaluation-new.json
bun run eval:research -- --case portfolio --timeout-ms 600000 --max-requests 12 --output output/portfolio-evaluation-new.json

# 确定性检查，无外部模型或市场请求
bun test src/runtime/research-evaluation.test.ts src/tools/fund-dca-tools.test.ts src/tools/portfolio-tools.test.ts
```

首轮基金 fixture 直接使用未规范化的 NAV source 字段，被原归档核验拒绝；改为复用 normalizeFundNav 后通过，没有放宽验证器。初次类型检查另发现测试的联合参数类型无法直接解构可选费率，已修正测试构造。失败日志保留为 `%TEMP%/whyj-fund-evaluation-targeted.log`、`whyj-fund-evaluation-checks.log`。新增范围的最终复测与真实恢复结果见后续记录。

### 恢复复跑与参数诊断

以下均使用 `zai-coding-cn / glm-5.3-flash / openai-completions / high` 保存连接、600 秒总时限、12 个请求事件上限；数据仍为上述合成 fixture。

| 结果文件 | 实际耗时 / 请求事件 | 上报 input/output tokens | 自动结果 |
|---|---|---|---|
| [基金恢复](../output/research-evaluation-2026-09-15-fund-recovery.json) | 343.89 秒 / 6 | 42233 / 11640 | finished，5/5，passed=true |
| [组合第二次](../output/research-evaluation-2026-09-15-portfolio-reviewed.json) | 182.27 秒 / 7 | 67008 / 5441 | finished，2/4，passed=false；未进入恢复 |

基金文件 SHA-256：`3E8E7FE715E55E3EE0BAAF3AC483D5A5BAF7DF14DEBC993BB6AC096DD23A7B3C`；组合文件：`862CF71848D16258CCA74BD6892B9F379DD3D1D294ADC548E3CC48E1E0D0798A`。

基金研究只执行一次 DCA，无工具错误；恢复没有新工具调用或重复计算，保持原任务版本、日期、投入/频率/费率、三项必需指标和模型额外声明的 Purchases=2。恢复回答正确区分归档的三条 NAV 与窗口内两次申购，并保留数据版本与计算引用。人工审阅仍发现研究回答把 XIRR 解释为“资金约一个月获利 50%”，容易混淆：首笔 100 在 28 天内增长 50%，末日追加的 100 未产生持有期收益，总本金收益是 25%。账户余额回撤也不宜直接称为 money-weighted 收益口径，固定被动净值样本不能证明管理能力。自动通过不代表这些解释已经合格。

组合第二次的收益/回撤正确、scope 通过，但声明的 currencies 只有 AAPL，实际比较使用 AAPL/MSFT/SPY 全表；同时声明参数遗漏 benchmark。两项条件均未匹配，任务保持 active。模型错误地声称参数逐项一致，随后以 resolve 尝试手动完成条件，被既有 from/to 校验拒绝。这是模型参数声明/解释失败，不再是首轮的 benchmark 集合误判。回答还将 Core/SPY 的非零 Sharpe 数值放在描述 MSFT 零波动的句子里，存在指代混乱；不计为完整语义通过。

据此补充生产诊断：同工具已有调用但参数不匹配时，报告最近调用不同的顶层字段名；匹配规则、pending 状态和原记录保留。工具指导说明单组指标也使用完整比较参数，以及验收自动计算、resolve 仅关联同参失败重试。新增本地 Pi/SSE 回归先复现 currencies 差异提示缺失，再更正同任务声明，验证原失败条件仍留在审计历史、复用唯一一次比较并通过恢复。没有把模型错误自动改成成功，也没有修改原评测文件。

本轮最终工程回归：**1399 pass / 0 fail，171 文件、17794 次断言，118.84 秒**，日志 `%TEMP%/whyj-object-evaluation-diagnostics-tests.log`。相对本轮开始新增 11 项测试；类型检查、评测脚本独立 strict 检查、架构检查（0 baseline violations）、构建（2958 modules / 6.71 MB）均通过。固定传输测试证明数据注入、数值、声明与恢复的契约，不替代真实模型解释质量或真实市场数据验收。

### 完整参数提示后的组合复测

[第三次组合结果](../output/research-evaluation-2026-09-15-portfolio-parameters.json) 保持相同原始输入、连接与 600 秒 / 12 请求事件预算，结果 **finished / passed=true，5/5**，耗时 **196.89 秒**，**6 个请求事件**，已上报 input/output tokens **46977 / 6699**。SHA-256：`31709B55D036775629477D1E6449FEACD19027EA7BE73C9E845BB434DAA1A7FA`。

一次声明保留完整 currencies、benchmark、日期、组 ID/版本与四项必需指标；只执行一次比较，无工具错误或 resolve 调用。恢复不执行新工具，保留同一任务/版本和比较引用，Core 39%、Stable 0%、SPY 19.5% 及两组零回撤正确。该次没有触发新增参数差异诊断；诊断及修正路径由固定传输回归验证，不能将这一次成功全部归因于诊断或提示修改。

人工审阅仍未通过完整解释质量：研究回答写“累计收益为期末/期初净值”，漏了减一；把 40 个估值日说成 40 个间隔，实际有 39 个相邻收益间隔。恢复回答虽保留 buy-and-hold 参数，却写“仅按共同估值日再平衡”：追溯发现 [比较计算模块](../src/quant/portfolio-comparison.ts) 的通用 warning 无条件含有 `Rebalance at common valuation dates only`，容易在买入持有场景被误解为实际操作。这一展示措辞缺口留待按 weighting 区分，并需保护已归档结果的重算一致性；本轮未改变数值或重写历史档案。新版本或假设需要重新比较，不意味着旧快照报告被自动作废。

F12/F18/F20/F24 继续为部分完成。工程和固定案例已通过，真实模型完整语义、更多窗口/对象/模型与真实终端任务仍待验收；本轮不同预算、多次复跑不构成总体成功率或稳定时延提升证据。

## 2026-09-15：按实际组合方法解释与旧档案核验

上一节发现的买入持有/再平衡混淆追溯到生产 warning。本次增加 [共享方法说明](../src/quant/portfolio-comparison-notes.ts)：从实际 weighting 生成持有或再平衡语义，列明累计收益公式中的减一、估值日与相邻收益间隔数量、CAGR 与风险年化的不同依据。工具文本、核验研究投影与新生成报告使用同一来源，减少模型在数据边界上的猜测。

比较结果默认升级 methodVersion 2，仅修正说明，不改变账本和数值。版本 1 的完整结果仍按旧定义重算核对，不能忽略 warning 字段来绕过证据匹配；未知版本直接拒绝。旧比较与已有 HTML 不迁移、不重写，当前展示根据核验通过的输入生成新说明。人工双标的样例仍分别得到买入持有 `[1, 1.25, 1]` 和再平衡 `[1, 1.25, 1.5625]`。

四项新增回归覆盖两版本的原字节恢复、说明被改写/未知版本拒绝，以及两种 weighting 的历史工具→研究核验→分享 HTML。另直接读取 [上一日真实公开数据结果](../output/portfolio-comparison-2026-09-14-r05.json)，版本 1 全部结果精确重算相等、文件字节不变、当前展示正确写明不再平衡。原文件 SHA-256 为 `1E3ACCEDCFB2A8E0F69B5FD57CB82B63AF881E495AE148784E306526C03022D9`；这是已有完整输入的离线重算，本次没有重新请求行情供应商。

工程回归：**1403 pass / 0 fail，171 文件、17849 次断言，101.67 秒**，日志 `%TEMP%/whyj-comparison-method-tests.log`。typecheck、architecture（0 baseline violations）、build（2959 modules / 6.71 MB）通过；evaluate-research、check-portfolio-comparison 和 check-portfolio-report 三个脚本另经独立 strict 类型检查。比较三层专项为 27/27，通过不代表模型叙述自动正确。

[更新方法说明后的真实模型结果](../output/research-evaluation-2026-09-15-portfolio-method-notes.json) 使用相同保存连接及 600 秒 / 12 请求事件预算，**finished / passed=true，5/5**，耗时 **276.92 秒**，**9 个请求事件**，上报 input/output tokens **108988 / 10609**。SHA-256：`44CB5E4CC001BCC75506C505E3703329427B7DE875235945C4101CCCF4B6EEA9`。仅计算一次比较，恢复仅 read，不新增量化计算；无工具执行错误。

人工审阅确认本次研究与恢复均正确区分 40 个共同估值日、39 个收益间隔，说明买入持有、不调仓，并保留累计收益公式中的减一及超额百分点口径。收益/回撤、USD 假设、基准、原日期和缺成员失败条件一致；没有把短窗口 CAGR 作为长期预期。

仍有中间失败：首次声明写成 `Core / Total return`、`Stable / Max drawdown` 等自定义组名标签，计算后任务为 blocked；模型读取核验结果后，在相同任务中改为 `Portfolio A/B` 标签，复用原比较完成验收。两次声明和 blocked 检查点均保留，未把失败算作工具错误或重新计算。首次声明准确性与声明前组合指标发现仍需改进；本次耗时/token 增加，不能宣称稳定性能提升或全部真实模型语义通过。

更新后的 [合成报告样例](../output/portfolio-report-2026-09-15-method-v2/share.html) 已生成，三条末值为约 1.875、1.2、1.452，与独立预期一致。这里只验证生成、数值与结构，未新增真实浏览器视觉验收。

## 2026-09-15：声明前发现组合指标

修复上一例先声明 `Core / Total return`、计算后才找到 `Portfolio A / Total return` 的发现缺口。[指标定义模块](../src/research/comparison-metrics.ts) 同时供比较核验与 research_task read 使用；19 个无基准标签覆盖共同日期及 Portfolio A/B 两组各九项指标，明确 benchmark 后增加该基准九项标签。目录过滤宿主停用工具，不从当前组名或用户原文猜测标签。

read 可显式传 benchmark 以发现新任务的基准指标；默认仅使用已声明任务的基准。查询不会更改任务、版本、原条件或获取数据。目录与已有核验标签逐项一致，单位和数值定义未改，null 指标仍不能满足验收。

四项新增测试覆盖声明前标签可见、显式/默认基准、下一研究标签查询不污染当前任务、停用工具与无效参数，以及真实 Pi/SSE 中错误标签 blocked→读取目录→更正同任务→复用原计算→有损恢复。后者核对目录与实际核验发现的全部 28 个标签相等，并保留原错误声明和 blocked 检查点。首次运行先复现两个缺目录测试失败，实现后通过；不通过自动重命名或放宽指标匹配来提升通过率。

工程回归：**1407 pass / 0 fail，172 文件、17896 次断言，107.10 秒**，日志 `%TEMP%/whyj-comparison-labels-tests.log`。typecheck、评测脚本独立 strict 检查、architecture（0 baseline violations）、build（2960 modules / 6.71 MB）和 whitespace 检查通过。指标目录不替代真实模型首次声明准确性或完整解释质量验收。

[增加指标目录后的真实复测](../output/research-evaluation-2026-09-15-portfolio-labels.json) 使用相同保存连接与原始输入，600 秒 / 12 请求事件预算；**finished / passed=true，5/5**，耗时 **161.17 秒**，**5 个请求事件**，上报 input/output tokens **33083 / 5938**。SHA-256：`665D4C5420A5645480B8C5207C94669367B80AC7592ABDD8C550EB562C756243`。

模型先 list_portfolios/read，再一次性声明正确的 Portfolio A/B 四个指标及完整参数，只计算一次比较；没有工具错误、更正声明或恢复阶段工具调用。初次 read 未显式传 benchmark，因此本例验证了无基准目录对两组验收标签的可发现性；带 benchmark 的 28 标签查询由固定 Pi/SSE 测试验证，不能混称已由此真实样本执行。

人工审阅：研究与恢复的 39%/0% 收益、零回撤、SPY 19.5%、40 个估值日与 39 个区间、USD 和买入持有假设一致。回答仍把后续价格版本变化笼统称为结论失效；准确边界是旧结论仍对应原快照，新观察需重新比较。它也把 CAGR 与 Sharpe 合并描述为从短窗口外推，未充分区分 CAGR 的日历年数和风险的每年观察频率。因此仅确认该次首次声明与列出的自动检查通过，不宣布完整语义验收、总体成功率或稳定成本/时延提升。

## 2026-09-15：最终回答与基金收益口径

原 stock/index/fund/portfolio 评测仅有五项证据检查，最终文本为空或 stopReason=length 也可能满足 passed；研究阶段错误还可能被新恢复实例的正常状态掩盖。新增 [evaluation-answers.ts](../src/runtime/evaluation-answers.ts)，研究、新闻和年报共用逐阶段事件收集与结束判定，不从恢复加载的历史消息中寻找本轮答案。

每个已开始的阶段保存 text、stopReason、hasError、toolCallCount；流式取消/失败也保留已观察的部分文本。只有正常 stop、无错误、无待执行工具调用且非空文本才满足回答条件。未得到正常最终文本标为 no-final-answer，截断/异常为 request-failed；超时、请求上限和显式取消仍保留各自 outcome。恢复成功不清除前段失败。新闻仍为六项，年报仍为九项，价格/基金/组合增加两项后为七项；历史结果不改写或与新门槛混算成功率。

新增 13 项实际 Pi/localhost SSE 反例覆盖股票和基金两阶段空白/截断、新闻首次空白/截断后正常恢复、两阶段流式部分文本取消，以及无响应的恢复不得复用研究答案。既有年报两项反例继续使用同一模块。保留文本只是提供审阅材料，不将可读文本当作正确解释。

[fund-dca-notes.ts](../src/quant/fund-dca-notes.ts) 从实际计算账本派生统一说明，进入基金工具文本及核验后的研究/报告投影。区分申购次数、独立申购日、实际 NAV 估值间隔、首末笔持有天数，以及末日申购没有后续 NAV 区间但仍可收取费用。本金收益是利润除以累计投入，TWR 是剔除外部投入后的指数变化，XIRR 使用带日期现金流按 actual/365 求年化率；后者的定义参照 [Microsoft XIRR 文档](https://learn.microsoft.com/en-us/office/vba/api/excel.worksheetfunction.xirr)。短期外推、管理能力和实际账户均不由此得到证明。

本例首笔 100 在 28 天内从 100 增至 150，末日再投 100，期末 250；总利润 50、本金收益 25%、TWR 50%。XIRR 满足 `-100 + (250-100)/(1+r)^(28/365) = 0`，不能说全部 200 都持有一个月并获利 50%。三项纯计算说明测试和一项工具→归档核验回归覆盖这组算式、延迟申购、多个计划共用净值日、末日费用与单日期无解；真实 Pi 恢复请求断言确认相同说明可见。计算算法和保存的结果字段没有改变，旧记录无需添加说明字段即可重新核验，已有 HTML 不重写。

```powershell
bun test src/runtime/research-evaluation.test.ts src/runtime/news-evaluation.test.ts src/runtime/annual-evaluation.test.ts
bun test src/quant/fund-dca-notes.test.ts src/tools/fund-dca-tools.test.ts
bun run eval:research -- --case fund --timeout-ms 600000 --max-requests 12 --output output/fund-answer-contract-new.json
```

初次新增数值断言将浮点结果 0.25000000000000017 与 0.25 严格相等比较，失败两项；改为 12 位小数近似断言，原计算与字节不变检查保留。初次日志 `%TEMP%/whyj-evaluation-fund-targeted.log`，最终工程结果与真实回答审阅另记。

[真实基金结果](../output/research-evaluation-2026-09-15-fund-answer-contract.json) 使用相同原始输入与保存的 zai-coding-cn / glm-5.3-flash / openai-completions / high，600 秒 / 12 请求事件上限；**finished、passed=true、7/7**，实际 **249.63 秒、7 个请求事件**，上报 input/output tokens **42391 / 9759**。SHA-256：`CD73932589890AD6FD6FF84C6B65CFF67820FA24FFBC2D5B264BF6638CAADC17`。两份回答均 stop、无错误、无工具调用；仅计算一次 DCA，恢复不再调用工具。首次声明遗漏 task.id 被 schema 拒绝，补齐后的唯一有效声明与原错误均留在审计中，没有把首次声明算作成功。

两阶段均正确给出本金收益 25%、TWR 50%、观察回撤 0%、首末笔 28/0 天，以及 XIRR 为短窗口年化而非持有期回报或预测。研究阶段说明只观察到两个净值日/一个相邻区间，恢复区分完整归档三条 NAV 与实际投资窗口。

完整解释仍未通过：研究回答称本金收益“与基金本身表现无关”，又未限定窗口、币种、费率和数据口径就说 TWR 可直接跨基金/基准比较；“短窗口回撤无统计意义”等断言也超出本例证据。恢复擅自称标的为“A 股开放式基金”，合成 scope.market=A 不证明真实基金投资类别。模型还复述 Purchases=2 periods，追溯发现核验 DTO 的申购次数使用了 periods 单位；随后改为 number，并在实际 Pi 恢复请求中断言 display=2。该单位修正发生在本次真实运行之后，尚未再次调用真实模型验证，不追写原结果。后续继续验证解释和首次声明可靠性，本次不提供总体成功率或时延改进结论。

工程首次全量为 **1549 pass / 1 fail，185 文件、20851 断言，270.71 秒**，日志 `%TEMP%/whyj-evaluation-fund-full.log`。失败是 OAuth UI 测试在凭证文件消失后过早操作；文件删除早于异步锁释放与面板退出结束。测试现用既有 signOut 注入端口等待实际操作，显式验证文件已删但完成门槛未释放时不可切换，完成后原认证切换/取消/保存断言不变。未改生产 OAuth 行为或扩大测试超时。含最后单位修正的六文件专项 **76/76、17.93 秒**，日志 `%TEMP%/whyj-evaluation-fund-targeted-final.log`；最终全量另记。

最终全量 **1550 pass / 0 fail，185 文件、20859 断言，243.22 秒**，日志 `%TEMP%/whyj-evaluation-fund-full-final.log`，相对本轮开始新增 17 项测试。收尾另修正同日期申购的说明分支：首末笔持有天数相同时不再声称持有期不同；最终三文件专项 **41/41、385 断言、16.73 秒**，日志 `%TEMP%/whyj-fund-final-boundaries.log`。此前六文件专项包含全部评测与 OAuth UI；末次专项覆盖基金说明、实际工具/归档和 Pi 恢复，未因文字分支重复整套全量。根目录与评测脚本独立 strict 类型检查通过；最终 typecheck、architecture（0 baseline violations）及 build（2977 modules / 6.75 MB）通过，日志 `%TEMP%/whyj-fund-final-boundary-checks.log`。Whitespace 与本轮六份文档的 188 个相对文件链接检查通过。本轮无真实市场/账户或新增浏览器验收。

## 2026-09-15：固定基金样本的解释回归

重新审计上一份真实基金回答，原有七项检查只证明任务、算术、正常最终文本与有损恢复，并未检查自然语言结论。研究回答的“本金收益与基金表现无关”、未对齐口径的直接 TWR 比较、“零回撤无统计意义”，以及恢复回答把 `.OF` 的 A 市场路由推断成 A 股基金，分别记录为四个明确错误。新增 [已知错误说法检查](../src/runtime/fund-answer-claims.ts)：基金评测报告逐阶段保存 `knownClaimViolations`，只要命中便使 `passed=false`；原七项证据检查仍单独保留。它是固定样本的回归门槛，不是通用自然语言正确性评估器，未命中的回答仍要人工审阅。

[账本派生说明](../src/quant/fund-dca-notes.ts) 补上本金收益对 NAV/份额/投入日期/费用的依赖、跨基金 TWR 比较的估值区间与收益口径前提、以及 `.OF` / A 市场路由的分类边界。它们经基金工具回执及核验投影进入模型上下文，没有更改计算公式、保存结果或旧报告。专项纯函数与真实本地 Pi/SSE 回归证明：即使三项验收和七项流程检查均通过，包含上述错误的最终文本仍使整次评测失败。

[第一次复测结果](../output/fund-claim-gate-2026-09-15.json) 继续使用隔离的合成 NAV、已保存的 glm-5.3-flash 模型连接，600 秒/12 请求事件上限，无真实行情或账户工具。结果 finished、7/7，**223.06 秒、6 个请求事件，input/output tokens 41340/9148**；SHA-256 `CE8735061DAF585DB8ABABAD7FFF14DB9FCCE78E37C329BC925232E2CD08D4D8`。旧四类说法未重现，研究与恢复均说明对比需对齐、零观察回撤不代表无风险、`.OF` 不证明资产类别。但人工审阅又发现研究回答把两次申购 NAV 都说成 0.6000（实际 0.5000、0.7500，0.6000 是混合平均成本），并称 2026-02-01 至 2026-03-01 为 29 天（实际 28 天）。这份文件在后两类检查加入前写出 `passed=true`，因此不应被当作完整解释通过；用现在的检查重审研究文本命中两个新错误码。

随后账本说明直接给出首末笔成交 NAV、净投入/总份额形成的平均单位成本及实际成交日，并明确不同 NAV 交易不能都等于平均成本；固定样本检查新增 `blended-cost-as-each-purchase-nav` 和 `wrong-fixed-window-day-count`，同时验证“分别为 0.5000/0.7500、平均 0.6000、持有 28 天”的正确表达不被拒绝。本地 Pi/SSE 反例确认新增错误也能在七项流程检查通过时拒绝。

[第二次复测结果](../output/fund-cost-window-2026-09-15.json) 在相同合成输入、模型与隔离工具范围下 finished、7/7、`knownClaimViolations=[]`、`passed=true`，耗时 **224.28 秒、7 个请求事件、input/output tokens 36647/10048**；SHA-256 `A0558EE4D0107A394A5B231B932F1A778D23D53897B3CB5224079A993425FE9B`。人工逐段核对研究/恢复：分别报出 0.5000、0.7500 的申购 NAV 与 0.6000 的混合成本，首笔 28 天/末笔 0 天，结果 25%/50%/0%，并保留跨基金比较、缺失分红、稀疏净值、资产类别和账户模拟边界。研究把 XIRR 的短窗年化称为“失真”，较准确说法应是数学上可计算但短窗年化数值极端、不能预测长期收益；恢复使用了后者。首次任务声明仍遗漏必填 `task.id`，由 schema 拒绝后才更正，失败调用保留在 `toolFailures`；因此首次声明可靠性和更广任务的完整语义仍待验收。本次样本通过不代表总体解释正确率、稳定时延或成本改善。

验证方式：`bun test src/runtime/fund-answer-claims.test.ts src/quant/fund-dca-notes.test.ts src/runtime/research-evaluation.test.ts` 专项 **38/38、338 断言**；`bun run test` 全量 **1658/1658、196 文件、21998 断言、179.98 秒**。`bun run typecheck`、`bun run check:architecture`（0 baseline violations）、`bun run build`（3001 modules / 6.86 MB）通过。真实复测命令为 `bun run eval:research -- --case fund --timeout-ms 600000 --max-requests 12 --output output/fund-cost-window-2026-09-15.json`；脚本拒绝覆盖已有输出，保存原始工具轨迹、两阶段回答和错误调用供人工复核。外部真实基金行情、账户、浏览器与完整终端视觉不在这次固定样本范围。

第三次复核首次声明：`research_task` schema 的 `task.id` 本来就是必填，但字段没有独立说明，工作流也只强调修订时复用 ID；现明确要求第一次声明携带非空稳定 ID。真实本地 Pi/localhost SSE 在发给模型的 OpenAI 请求中断言字段说明与工作流文字都可见。[第三次真实结果](../output/fund-id-guidance-2026-09-15.json) 的首轮工具 schema hash 与 instruction hash 均相对第二次改变，但 glm-5.3-flash 仍漏填 `task.id`，由 schema 拒绝后更正；这不是提示未进入请求。结果最终 finished、7/7、`knownClaimViolations=[]`、`passed=true`，**158.84 秒、7 个请求事件、input/output tokens 41166/6454**，SHA-256 `A0758A5FBDC9C0C4405E67CD76AAD8A43225B06C7E6D1C8497EA879D383DFEE5`。`passed` 是最终证据/回答与已知说法的门槛，**不包含首次声明零错误保证**；这一次没有改善该可靠性缺口。该结果只说明错误被拦截且模型能更正，不证明新增文字能稳定减少无效调用。字段说明后的 Pi/控制工具专项 **36/36、335 断言**、typecheck、architecture（0 baseline violations）、build（3001 modules / 6.86 MB）通过；全量 1658/1658 的记录发生在字段说明修改前，不混写成修改后全量。

## 2026-09-15：首次研究声明的宿主 ID 与真实复跑

上一份样本证明再增加 `task.id` 提示仍未让模型首次填写。现在 `research_task` 的初始声明可省略 ID：宿主仅在未声明任务的初始修订令牌下，从已核对的原用户请求 entry ID 派生 `study-<entry ID>`。结构化宿主 API、显式 ID 和修改已有任务的 ID 要求不变；缺对象、窗口、条件或版本仍需正常校验。原始 assistant 调用保留缺字段的参数，成功 toolResult 保存生成后的完整事件；journal 回放逐项核对，不能靠模型叙述补写 ID。预修复的回放反例为 **4 pass / 1 fail**（任务未落成）；修复后真实本地 Pi/SSE 完成声明、回测、read、有损恢复，并验证修改已有任务再省略 ID 会失败。[动作回放](../src/research/task-actions.test.ts) 与 [Pi 会话回归](../src/runtime/research-task-tool.test.ts) 提供复跑入口。

[新的真实基金样本](../output/fund-host-id-2026-09-15.json) 使用保存的 `zai-coding-cn / glm-5.3-flash` 连接、固定合成 NAV 和隔离工具范围，600 秒 / 12 请求事件上限；**finished / passed=true，7/7、无工具错误、无已知错误说法命中**，耗时 **324.15 秒、6 个请求事件、上报 input/output tokens 49774/12104**。SHA-256：`3AB6C643708275E9ACCDDC2C0E200487282873E973B8AD0E21556A954594E263`。原始 `declare` 的 `task.id` 为空缺，成功回执提交 `study-01a0a5c4-5db9-7ffa-b308-cbd3b3eb296e`；一次 DCA 计算 verified、三项条件 satisfied，恢复不重新计算。与先前样本的耗时或用量不可直接比较：模型抽样、提示/schema 和本地代码版本均有变化，不据单次结果宣称稳定提速或降费。

人工审阅确认两阶段正确区分 0.5000/0.7500 的申购 NAV、0.6000 的混合成本、28/0 天、25% 本金收益、50% TWR、0% 观察回撤，也明确数据为合成、短窗口和非账户结果。恢复回答仍称 **19645.828% 的 28 天 XIRR 为“极端伪影”**，研究回答把本例两笔等额投入的本金收益说成“同权平均”但未限定等额前提。前者的数字来自已日期化现金流的年化解，不能因数值极端称计算无效；更准确的是短窗外推为假设性的年化值，不能作持有期回报或长期预测。[Microsoft 的 XIRR 定义](https://support.microsoft.com/en-us/excel/functions/xirr-function)说明日期现金流和 365 天折现；[CFA Institute 对不足一年业绩展示的意见](https://www.cfainstitute.org/sites/default/files/-/media/documents/comment-letter/2020-2024/CFA-Institute-Supplemental-Comment-Letter-on-SEC-Proposed-Rules-for-Private-Fund-Advisers.pdf)针对私募基金，支持谨慎看待短窗年化；把该原则用于本合成定投解释是工程推论，不是此产品的法规结论。这两个措辞需继续改进及跨样本复核；本次自动通过不证明完整金融解释质量或首次声明在所有模型上可靠。

## 2026-09-16：基金年化口径与恢复错算

[基金解释说明](../src/quant/fund-dca-notes.ts) 现把本金收益定义为按每笔毛投入加权的期末盈亏比：固定金额计划的权重相等，成交日期和持有天数却可能不同；如果多笔落在同一实际 NAV 日，说明改为相同持有期。对于有解的 XIRR，说明明确写出日期现金流跨度、365 天年化和短窗假设性外推，不把极端年化数值称作计算错误；无解仍为 N/A，不伪装为零。相同说明进入实际基金工具回执和研究恢复核验投影，计算值、旧归档与账户边界未改。定向 [说明边界测试](../src/quant/fund-dca-notes.test.ts) 和真实本地 Pi/SSE 评测回归覆盖两笔、同日及无解情况。

[改说明后的第一次真实模型样本](../output/fund-annualization-2026-09-16.json) 使用同一保存连接及固定合成 NAV，600 秒 / 12 请求事件上限；**finished、7/7、零工具错误、原当时已知说法门槛无命中**，耗时 **270.23 秒、7 个请求事件、上报 input/output tokens 56952/7877**。SHA-256：`1204F53A873E26C70764BA96BEF7C56B3F489AD30B1212559AA3C99B87B15E80`。原助手首次声明再次没有 ID，宿主生成并提交，计算一次、恢复只 read。研究回答这次正确把 XIRR 称为“28 天跨度外推，数值极端但非计算错误”，但恢复回答出现明确算术矛盾：写 **Principal return 25.00%**，却把公式写为 **（末期模拟市值 200 − 投入 200 本金）/200**；该式等于 0%，已核验市值实际是 250。原文件保留原时点 `passed=true`，不追写；它只能表示原七项流程通过，不能作为完整金融解释通过的证据。

[已知错算门槛](../src/runtime/fund-answer-claims.ts) 增加一行本金收益公式的数字一致性：若报告百分比与同一行明确给出的期末市值/投入不符，记录 `wrong-fixed-principal-formula` 并使本次基金评测 `passed=false`；不会改写七项流程检查或任务证据。用当前规则重审上述原始文件，恢复阶段命中该码；两份先前历史基金文件未误命中。[真实 Pi/SSE 反例](../src/runtime/research-evaluation.test.ts) 在任务与七项流程全通过时仍拒绝该错式，预修复为 36 pass / 2 fail，实现后定向通过。模型可见核验说明另提供 `期末模拟市值／累计毛投入 = 1.25` 的比例，不把用户投入金额复制进说明；模型若打印具体金额仍须自行与比例核对。这个固定样本规则不能发现所有任意语言或跨行的错算，人工逐段审阅继续必要。

[比例说明后的第二次真实模型样本](../output/fund-principal-identity-2026-09-16.json) 在相同保存连接与隔离合成 NAV 上 **finished、7/7、无工具错误、当前已知错算/说法门槛零命中**，耗时 **228.45 秒、5 个请求事件、上报 input/output tokens 29867/8175**。SHA-256：`7A32C779DC41DFA4B0D7779D975F1D7DBE4631AB002C0B123B0DD8BCDE8221FF`。原助手声明仍省略 ID，由宿主提交稳定 ID；DCA 只计算一次，恢复只读原证据，没有变更任务或量化操作。人工审阅本例研究明确写 `(250−200)/200=25%`，恢复正确使用 `终值/总投入=1.25`；两阶段均将 28 天 XIRR 说明为假设性年化外推、极端但非计算错误，区分 0.5/0.75 NAV 与 0.6 混合成本及 28/0 天、合成数据和非账户边界。研究仍把一个净值区间的回撤泛称为“尾部风险与恢复特征”，随后虽说明短窗不具代表性，但不能把这份单例当作所有风险解释已验证。5 次请求或较低输入 token 是本次抽样结果，不证明稳定性能收益；完整终端、其他基金/市场、真实数据与跨模型解释仍待测。

本轮最终验证：基金说明、实际工具、任务回放、Pi 会话和评测专项先通过 **49/49、449 次断言**；`bun run test` 全量 **1688/1688、198 文件、22144 次断言、175.68 秒**，日志 `%TEMP%/whyj-fund-principal-id-full-2026-09-16.log`。`bun run typecheck`、`bun run check:architecture`（0 baseline violations）、`bun run test:fence` 与 `bun run build`（3003 modules / 6.88 MB）通过。真实模型三份输出互不覆盖；外部真实行情、账户和完整终端视觉尚未因本轮测试而得到验收。

## 2026-09-16：基金回答数值与当前任务证据核对

此前的固定样本规则只检查少数已见错句和同一行本金公式，不能发现恢复回答把明确标出的 Principal return 从工具已核验的 25% 改写成 20% 的情况。[基金回答检查](../src/runtime/fund-answer-claims.ts)现在只把清楚标记的本金收益率、TWR 和 TWR 最大回撤百分比，与**当前任务同参数、verified 状态**的 `fund_dca_backtest` 指标逐项对照；XIRR/年化标签不借用这三项，模糊文字仍留给人工审阅。[证据匹配模块](../src/runtime/fund-answer-evidence.ts)要求同一任务的基金验收条件使用一致参数；不同投入金额、混合工具或彼此矛盾的重复核验结果不会被拿来支持回答。

默认 [AppRuntime](../src/app-runtime.ts) 在 Agent 轮次最后一个正常结束的基金回答后检查当前任务投影。若明确数字与工具证据冲突，或同一行本金公式内部算术矛盾，保留原回答、追加可见复核提示，并停止本轮自动报告；正确数字继续原报告流程。研究证据缺失时也提示复核。提示目前是本地对话消息，重启后需要重新核对原回答；它不写入研究日志。检查只覆盖有完整基金任务、可匹配操作和明确标签/公式的回答，不能自动证明所有金融叙述正确，也不能撤销已经展示给用户的原回答。[专项测试](../src/runtime/fund-answer-evidence.test.ts)与 [CLI 回调测试](../src/app-runtime.test.ts)覆盖三项验收、参数错配、重复结果冲突、两种错算及正确答案的报告行为；真实本地 Pi/SSE 评测还验证了恢复阶段错报 20% 会使 `passed=false`。

[本轮真实模型原始结果](../output/fund-verified-metric-audit-2026-09-16.json)使用已保存的 `zai-coding-cn / glm-5.3-flash` 连接、隔离合成 NAV、600 秒及 12 次请求事件上限；**finished、7/7 流程检查、5 次请求事件、219.75 秒、上报 input/output tokens 30429/7676**。原文件 SHA-256 为 `E800CCD94628A6B6EAF4FDA0DFB2A48E7AE3801BC85414E953AEFDD046222297`，写入时 `passed=false`：研究文本说“与同期基金涨幅直接对比会误导”，旧比较规则却把“直接对比”四字当成无条件推荐。旧文件不改写；规则现按句识别“不能直接比较”和“直接对比会误导”，并保留同一回答中另有肯定句仍失败的反例。用当前规则重审原两阶段文本，`knownFundAnswerViolations` 分别为 `[]`、`[]`；报告的核验指标 25%/50%/0% 与两段明确数字一致。原始模型流程和这次离线重审应分别阅读，不能把旧文件的 `passed` 字段说成新的成功输出。

人工审阅仍发现研究文本对“第二笔投入当晚于高点买入”的表述含糊；本例第二笔是在期末 0.75 NAV 申购，尚无后续持有区间。样本只有两个投资窗口净值日，无法代表其它费用、分红、基金或市场；完整终端流程与跨模型解释继续验收，F12/F20 保持部分完成。复跑固定测试：

```powershell
bun test src/runtime/fund-answer-claims.test.ts src/runtime/fund-answer-evidence.test.ts src/runtime/research-evaluation.test.ts src/app-runtime.test.ts
$taskOutput = "output/fund-evaluation-$(Get-Date -Format yyyyMMdd-HHmmss).json"
bun run eval:research -- --case fund --timeout-ms 600000 --max-requests 12 --output $taskOutput
```

评测命令需要已配置模型连接，输出路径须是新文件；它只提供合成 NAV 和隔离工具，不请求真实行情或账户。

最终工程验证：四文件专项 **77/77、446 次断言**；`bun run test` 全量 **1735/1735、207 文件、22754 次断言、287.78 秒**，日志 `%TEMP%/ohq-fund-answer-final-full-2026-09-16.log`。`bun run typecheck`、`bun run check:architecture`（0 baseline violations）、test fence（包含于全量）与 `bun run build`（3023 modules / 6.96 MB）通过。更新的 PRD、实施记录和本文共 265 个相对文件链接可解析，`git diff --check` 通过。原始模型评测文件未改写；F12/F20 的完整任务集继续实施。

## 2026-09-18：股票任务的当前模式与市场身份

用已保存的 `zai-coding-cn / glm-5.3-flash` 连接，运行隔离合成 AAPL 固定样本。三个原始结果各自保留，不回写历史文件：

| 样本 | 结果 | 发现 |
|---|---|---|
| [首次](../output/research-evaluation-stock-2026-09-18.json) | finished，3/5 检查 | 模型将价格日期当作应用观察截止，要求 `2026-02-09T23:59:59.999Z` 的历史归档；样本实际在本次运行时才归档，隔离宿主也未提供历史归档端口。两个工具正确拒绝，任务 blocked；不能把该样本伪装成 2 月已观测。 |
| [时间边界修正后](../output/research-evaluation-stock-no-asof-2026-09-18.json) | timeout，2/5 检查 | 请求已明确样本归档时间与价格日期不同。模型未再请求 `observed_before`，却在当前模式的验收条件与工具调用中传入 `market: US`；旧宿主拒绝后，去掉 market 的重试虽算出两个指标，失败尝试仍无法按不同参数自动消除，任务 blocked。 |
| [市场身份修正后](../output/research-evaluation-stock-market-2026-09-18.json) | finished，7/7 检查，`passed=true` | 当前模式接受与代码一致的市场身份，仍由配置选取数据源；`source` 无观测截止时继续拒绝。两次计算均 verified，任务 complete；有损压缩后原任务和操作保留，恢复未重算。 |

最终样本耗时 166.87 秒、6 个模型请求事件，上报 input/output tokens 为 46018/5766；文件 SHA-256 为 `FBDD3AE1FB1FD28A13A0082E78F25B14D212357362ED0CCC44E8DE9DF70839B3`。人工复核研究与恢复正文：最新两期动量约 0.014599、年化波动率 1.3038%、最大回撤 0% 与工具核验一致；回答明确 `financial-datasets` 是合成样本标签、价格日期不等于本次应用观测时间、未设置历史截止，并列出窗口、年化假设与更换数据版本后的失效条件。40 根是连续日历日期的合成序列，不能据此证明真实交易日、供应商历史可得性或预测力。当前检查仍不保证其它未标记叙述均正确。

修正覆盖生产的 [价格工具入口](../src/tools/shared/analysis-observation.ts)、[任务声明校验](../src/research/tasks.ts)及模型可见的 `market` 字段说明；市场不匹配和当前模式选择 `source` 仍受拒绝。三文件专项 58/58、460 次断言与类型检查通过。重跑命令（输出必须是新文件）：

最终 `bun run test` 为 **1773/1773、214 文件、22909 次断言、279.36 秒**；`bun run typecheck`、`bun run check:architecture`（0 baseline violations）、`bun run build`（3031 modules）通过。修改的三份文档共 256 个本地链接可解析；三个评测文件未检出明显凭证字段，均未覆盖旧输出。

```powershell
bun run eval:research -- --case stock --timeout-ms 300000 --max-requests 12 --output output/research-evaluation-stock-new.json
```

这只覆盖隔离合成股票单例与 headless 恢复；真实终端布局、其它市场/模型、真实行情和更广解释质量仍待验收，F12/F18/F20/F24 保持部分完成。

## 2026-09-19：完整参数验收后的股票复跑

收紧任务验收为声明/实际调用的双向完整参数匹配后，用当前代码及已保存的模型连接重新运行隔离合成 AAPL 样本。独立结果保存在 [本次评测 JSON](../output/research-evaluation-stock-exact-2026-09-19.json)，SHA-256 为 `919BE12518DE0073CB7BF1C29F867FFC7E5B85E78DB63F66ECA6C00794A724C4`。运行耗时 198.19 秒、5 个模型请求事件，`finished`，7/7 自动检查通过。两个 criterion 的声明参数与对应 `compute_factor`、`check_risk` 实际调用逐字段一致，两次结果 verified、无工具失败或任务错误，任务 complete；有损恢复保留任务与证据，没有重新计算。该任务未要求报告，`reportRef` 为空符合声明。

人工复核保留一个语义问题：研究回答根据本合成样本的两期动量最新值低于前期均值、分位为 0%，称其为“短周期均值回归型特征”。本次工具只核验了动量与风险指标，没有检验后续收益是否回归，因此这个定性结论超出已验收证据。恢复回答未重复该措辞。7/7 只证明自动契约通过，不代表解释全文通过；F12/F18/F20/F24 继续部分完成。评测文件未检出 `apiKey`、Authorization、Bearer 凭证或 password 属性。

复核命令（每次使用新的输出文件，保留原始记录）：

```powershell
bun test src/research/tasks.test.ts src/runtime/quant-harness.test.ts src/runtime/research-task-tool.test.ts src/runtime/research-task-matrix.test.ts src/runtime/research-evaluation.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
bun run eval:research -- --case stock --timeout-ms 300000 --max-requests 12 --output output/research-evaluation-stock-next.json
```

## 2026-09-19：历史因子分位与均值回归证据边界

上一份股票评测的 7/7 自动契约不检查“低动量分位 ⇒ 均值回归”这句解释。当前[因子证据边界](../src/quant/factor-evidence.ts)由 `compute_factor` 工具文本与结构化回执、独立重算的研究 `assumptions`、有损恢复上下文共用：动量是窗口内过去价格收益，`reversal` 指标是过去收益的负号；最新值、前期均值和分位只描述已观察窗口，不检验后续收益、均值回归或预测优势。通用系统提示不再把 “mean reversion” 当成未加条件的术语建议。固定任务的[狭窄回答检查](../src/runtime/factor-answer-claims.ts)只拦截明确断言该结论的句子，显式“尚未检验/不构成证据”不拦截；仍由人工审阅其它说法。旧原始报告不改写，用现行规则离线重审仅研究阶段命中 `unsupported-mean-reversion-claim`，恢复阶段无命中。

同时修复一个独立的最小样本数值边界：仅有一个有效因子值时，前期均值和分位过去错误显示为 0；现在返回 `null`，工具文本写 `N/A (no prior factor values)`，不能把不存在的历史比较当成真实零值。已有两项或以上有效因子值时计算方式不变。[纯因子反例](../src/quant/factor-summary.test.ts)、工具和实际 Pi 研究/恢复请求的定向回归覆盖这两条边界。

[首次边界复测原始报告](../output/research-evaluation-stock-factor-boundary-2026-09-19.json)使用与前例相同的隔离合成 AAPL 任务及保存的真实模型连接：`finished`、7/7 机械检查、5 个请求事件、176.02 秒，SHA-256 `C2640609E05384C3EEA7DDA9B6673918137267EA9C775B43D86885B8EADC4F5B`。模型研究明确说“0% 分位不构成均值回归或未来收益证据”，恢复也说明未检验后续收益；这两个否定句被首版词法规则误报，故原文件 `passed=false`、两段各一项 claim violation。保留该原始结果；修正规则后的离线重审两段均无命中，不将离线结果伪装成原评测通过。随后再次运行真实模型，独立报告及最终工程检查见下文。

[第二次独立模型复测](../output/research-evaluation-stock-factor-boundary-final-2026-09-19.json)为 `finished`、7/7 机械检查、`passed=true`、8 个请求事件、204.96 秒，上报 input/output tokens 48756/7249；原始文件 SHA-256 为 `D9C30279BDAEB9426BEDFB4B5A022627B289C122148A7C10316D7BA9DD56CF6C`。任务 complete，三个验收条件均 satisfied，研究和恢复都保留窗口、数据版本、指标与失效边界。人工复核两段回答：研究明确指出 0% 分位不是反转或延续信号，恢复指出分位不检验未来收益或均值回归；两段均没有从历史排名推出均值回归。这个合成单例不能代表不同模型、真实行情或所有表述已通过语义审查。此前完整参数复跑暴露的原始错误仍保留在旧报告中。

[交互运行时](../src/app-runtime.ts)也将同一狭窄检查限定到当前 complete、参数匹配且因子操作 verified 的任务。若回答明确断言未经检验的均值回归，原文仍显示给用户，随后追加复核提示并停止**该轮待生成的自动报告**；修正后的回答可继续生成。证据缺失时不把参数错配当成支持结论。否定句、普通聊天与混合工具任务不会被这一固定规则扩大拦截。[证据范围测试](../src/runtime/factor-answer-evidence.test.ts)和 [CLI 事件回归](../src/app-runtime.test.ts)覆盖这一路径；这只是已见错句的回归门槛，不是通用金融事实核查。

复跑方式：

```powershell
bun test src/quant/factor-summary.test.ts src/tools/quant-tools.test.ts src/runtime/factor-answer-claims.test.ts src/runtime/factor-answer-evidence.test.ts src/runtime/research-evaluation.test.ts src/app-runtime.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
# 使用已有模型配置，每次给 --output 一个新文件名，避免覆盖原始证据
bun run eval:research -- --case stock --timeout-ms 300000 --max-requests 12 --output output/research-evaluation-stock-next.json
```

最终工程检查：相关六文件定向测试 **89/89、540 次断言**；`bun run test` 全量 **1794/1794、220 文件、23028 次断言、231.82 秒**，日志 `%TEMP%/ohq-factor-boundary-prod-final-full-2026-09-19.log`。`bun run typecheck`、`bun run check:architecture`（0 baseline violations）及 `bun run build`（3037 modules）通过。三份文档的相对文件链接可解析；最终真实模型原始 JSON 未检出 `apiKey`、Authorization、Bearer 或 password 字段/标记。全量测试之前一次混合状态运行有一条 SSE 计时断言低于 2 ms；单独复跑和上述最终完整回归均通过，因此未修改该断言。F12/F18/F20/F24 保持部分完成。

## 2026-09-19：组合回答数值与当前比较证据

此前组合固定任务可以完成工具、声明和有损恢复的机械检查，但最终文本中的收益或回撤数字并未对照本轮已核验的比较。即使模型把 Core 的 +39.00% 写成 +38.00%，任务状态仍可能显示 complete，且开启 Auto Artifacts 时会保存该段错误叙述。

[组合回答核对](../src/runtime/portfolio-answer-evidence.ts)从当前 complete 任务的满意验收项读取精确的 `callEntryId/callId`，只取那次 `compare_portfolios` 已核验操作及其归档组身份、组合版本和四个指标；旧操作、同名组或仅靠答案文字均不能当证据。[可读数字检查](../src/runtime/portfolio-answer-claims.ts)只识别明确标记的当前组名或组合 A/B 的累计收益、最大回撤，以及列对齐的比较表和模型实际使用的 `TR`/`DD`、`Max DD` 格式；基准收益和成员权重不会当作组合收益。回撤接受正负号两种幅度写法，四舍五入容差为 0.05 个百分点。若证据缺失或数字冲突，原模型回答仍显示，终端另给复核提示并暂停本轮自动报告；更正回答可正常生成。

同一检查接入 `eval:research --case portfolio`，使压缩恢复后改写已核验数字的回答不能继续标为评测通过。它只覆盖清晰标注的百分比，不检查未标注叙述、解释充分性、真实供应商价格或模型投资建议；F12/F20 仍保持部分完成。

[首次真实模型运行](../output/research-evaluation-portfolio-answer-audit-2026-09-19.json)的任务与比较已完成，研究回答正常结束，但 180 秒截止时恢复回答仍在生成：`timeout`、5/6 检查、6 个请求事件，原文件 SHA-256 为 `CF7BEF727ECF27BB0A4C4DFE7DCD85CAC21383F96A9C8B335459A466500DFF03`。保留这个失败回执。用 300 秒新上限的[独立复跑](../output/research-evaluation-portfolio-answer-audit-300s-2026-09-19.json)正常结束，任务 complete、研究/恢复均 `stop`、7/7 机械检查、5 个请求事件、183.05 秒、无工具错误；文件 SHA-256 为 `981CF43BFADE7AAB2B24EE83FA413D9641F53B54416B69F7103FC6E73B87C735`，未检出凭证字段/标记。人工审阅两段文本的组别、窗口、收益/回撤、39 个区间和合成/账户边界，未发现这几项与核验结果冲突。

两次运行的实际回答使用 `TR`/`DD` 和 `Max DD` 表格，有别于初版仅识别完整词的检查；最终解析器依据原文补齐这几种形式。复核时还发现仅含 `TR`/`DD` 表头的回答会被 CLI 预筛选跳过，表格列也未解析缩写，现由独立的纯缩写表格反例覆盖入口与数值检查。300 秒运行在这些格式修正之前启动，因此不把其 `passed=true` 作为最终解析器在模型进程内执行的证据；修正后离线复核已保存的两段正确原文均无冲突，并分别将 Core 收益改为 38% 后均返回 `wrong-verified-portfolio-a-return`。定向回归覆盖表格、紧凑行、旧比较隔离和真实 AppRuntime 暂停/恢复自动报告。这个合成单例和词法核对仍需更广的真实任务与解释质量验收。

纯缩写表格修正前三文件定向测试 **74/74**、全量 **1804/1804、221 文件、233.04 秒**，日志 `%TEMP%/ohq-portfolio-answer-full-final-2026-09-19.log`；修正后定向 **74/74、471 次断言**，最终 `bun run test` 全量 **1804/1804、221 文件、23133 次断言、229.58 秒**，日志 `%TEMP%/ohq-portfolio-answer-full-verified-2026-09-19.log`。`bun run typecheck`、`bun run check:architecture`（0 baseline violations）、`bun run build`（3041 modules）及构建产物 `--help` 均通过。

可复跑：

```powershell
bun test src/runtime/portfolio-answer-evidence.test.ts src/runtime/research-evaluation.test.ts src/app-runtime.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
bun run eval:research -- --case portfolio --timeout-ms 180000 --max-requests 12 --output output/research-evaluation-portfolio-next.json
```

## 2026-09-19：单标的风险回答数值与任务证据

固定股票任务原先只拦截未经检验的均值回归结论：将 `Annual volatility 9.00%` 写入已核验结果实际约为 1.3038% 的研究回答，任务、计算和恢复检查仍全部通过，评测会误判为通过。[失败转通过的 Pi/SSE 回归](../src/runtime/research-evaluation.test.ts)保留这条反例，并覆盖只在有损恢复中把最大回撤改为 9% 的情况。

[风险数值核对](../src/runtime/risk-answer-evidence.ts)从当前完成任务的 `check_risk` 验收条件出发，要求所有风险条件指向同一次已核验调用、参数与单标的范围一致，且该调用含有限的年化波动率和最大回撤；旧调用、缺失证据或条件互相矛盾不会支持数字。模型可把两个指标拆成两条条件，本机保存的[真实股票评测](../output/research-evaluation-stock-factor-boundary-final-2026-09-19.json)正是这种形式。数值检查只处理明确标签后的百分比及带标的的对齐表行，按工具展示精度容许 0.05 个百分点；其它风险判断仍需人工审阅。CLI 保留原回答、提示复核并暂停该轮自动报告，修正后的回答可继续生成。

保存的真实模型研究与恢复原文在最终解析器下均无数值冲突；分别把其中 `Annual volatility 1.3038…%` 改成 9% 后，两段均返回 `wrong-verified-annual-volatility`。这是离线文本重审，不是本轮新发起的真实模型调用；固定 Pi/SSE 测试覆盖从声明、计算、压缩恢复到评测门槛的运行链路。单标的显式百分比以外、更多市场和跨模型解释质量仍待验收。

最终三文件定向 **77/77、489 次断言**；`bun run test` 全量 **1809/1809、222 文件、23163 次断言、227.82 秒**，日志 `%TEMP%/ohq-risk-answer-full-2026-09-19.log`。`bun run typecheck`、`bun run check:architecture`（0 baseline violations）、`bun run build`（3043 modules）和构建产物 `--help` 通过。可复跑：`bun test src/runtime/risk-answer-evidence.test.ts src/runtime/research-evaluation.test.ts src/app-runtime.test.ts`，随后执行上述四个工程命令。

## 2026-09-19：最新因子值与当前验收调用

固定股票任务的 `momentum(2)` 最新值由归档价格独立计算为 `139/137−1 = 0.014598540…`。此前将恢复回答的 `Latest 0.0146` 改为 `Latest 0.0946`，任务、工具和七项机械检查仍通过，[固定 Pi/SSE 回归](../src/runtime/research-evaluation.test.ts)先复现了这一漏检。原因是旧回答规则只拦截未经检验的均值回归判断，且 CLI 审计只按参数寻找任意已核验因子调用，未绑定本轮验收所选的调用 ID。

[当前因子证据核对](../src/runtime/factor-answer-evidence.ts)现在要求单标的任务中所有 `compute_factor` 条件指向同一次已核验操作，调用 ID、entry ID、参数、范围和有限的 `Latest` 数值必须一致；旧调用即使参数相同也不能替代本轮证据。[明确数值检查](../src/runtime/factor-answer-claims.ts)只比对 `Latest`/“最新值”后的数值，并按回答写出的十进制精度容许正常舍入；momentum、reversal、volatility、sma_deviation 的明确百分比写法按比例换算，RSI、成交量比的百分比写法不借此推定单位。CLI 对冲突回答保留原文、提示复核并暂停该轮自动报告，修正后的研究输入仍可生成报告。已有均值回归越界判断继续生效。

保存的[真实股票研究与恢复](../output/research-evaluation-stock-factor-boundary-final-2026-09-19.json)在当前解析器下均无冲突；把各自明确标注的 `Latest 0.014…` 改为 `0.0946` 后均返回 `wrong-verified-factor-latest`。这只是已有原文的离线重审；本轮未重新调用真实模型。未标注数字、多标的比较、因子解释与未来收益语义仍待更广验收，F12/F20 保持部分完成。

日期反例 `Latest 2026-02-09` 不当作因子值。最终四文件定向 **79/79、515 次断言**；`bun run test` 全量 **1811/1811、222 文件、23185 次断言、228.40 秒**，日志 `%TEMP%/ohq-factor-latest-full-final-2026-09-19.log`。`bun run typecheck`、`bun run check:architecture`（0 baseline violations）、`bun run build`（3043 modules）及构建产物 `--help` 通过。可复跑定向命令：`bun test src/runtime/factor-answer-claims.test.ts src/runtime/factor-answer-evidence.test.ts src/runtime/research-evaluation.test.ts src/app-runtime.test.ts`。

## 2026-10-11：六指标风险回答与非零回撤评测

此前股票/指数样本使用单调上涨价格，最大回撤为零；回答核对只比较年化波动率和最大回撤。本次新增独立 `risk` 案例，窗口固定为 AAPL、2026-01-01 至 2026-02-09，40 个连续日历日期上的合成收盘价为十次重复的 `100,110,88,99`。这不是实际交易日历或供应商行情；归档中的 financial-datasets 仅为 fixture 标签。

39 个相邻收益包含十次 +10%、十次 -20%、十次 +12.5% 和九次 `1/99`。期望值由这些计数独立计算：样本标准差除以 38 后按 252 期年化，下行偏差以全部 39 期为分母、零为目标；历史 VaR/CVaR 95% 均为 -20%，最大回撤为 -20%，最长连续低于既有峰值的观察为 3 期。VaR/CVaR 是有符号逐期收益，不年化，也不保证未来损失；回撤持续期不是日历天数或最深回撤峰谷跨度。工具和报告使用同一份 [口径说明](../src/quant/risk.ts)。

[当前风险证据核对](../src/runtime/risk-answer-evidence.ts)继续绑定 complete 单标的任务所选的 call ID、entry ID、参数和已核验操作，现在要求上述六项都存在、单位正确且数值有限。百分比容差仍为 0.05 个百分点，回撤深度接受幅度的两种符号写法；VaR/CVaR 按收益符号比对，持续期按整数期数精确比对。[文本解析](../src/runtime/risk-answer-claims.ts)只覆盖明确标签后的百分比/期数及有标的的对齐表行，保留空单元格以防列移位；不把 VaR 标签中的 95% 当结果。未标注叙述、多标的解释、损失幅度语义和未来保证仍需人工审阅。

`--case risk` 要求研究与有损恢复的两段回答正常结束且明确列出六项，连同原四项证据检查和恢复不重算，共九项；已知数值矛盾另外阻止通过。遗漏下行/VaR/CVaR/持续期，即使任务 complete 且数值检查未识别矛盾，也不能通过这个案例。固定 Pi/SSE 回归覆盖正常六指标、只在恢复中把逐期 VaR 年化、缺项以及 CLI 在 CVaR/持续期冲突时暂停自动报告，修正后允许生成。

本轮保留两份真实模型失败记录，连接为保存的 zai-coding-cn / glm-5.3-flash / high，预算均为 300 秒、最多 12 请求事件：

| 记录 | 耗时 / 请求事件 | 结果 |
|---|---|---|
| [首次运行](../output/research-evaluation-risk-six-metrics-2026-10-11.json) | 11.27 秒 / 1 | request-failed，0/6，未进入恢复 |
| [独立复跑](../output/research-evaluation-risk-six-metrics-retry-2026-10-11.json) | 10.29 秒 / 1 | request-failed，0/6，未进入恢复 |

首次文件 SHA-256 为 `1FBF972866E09556D63DB2EE8807001E33030144E8057A4E47D5448F36AF1AEC`；复跑为 `9B229552834704A2E550D45BB38D4EFEAC1C99A5775021096F09330C3205DBF6`。两份均无工具调用、任务声明或非空回答，上报 token 为零；不能据此推断实际请求未计费，也不能定位失败原因或认定模型语义通过。固定回归与真实失败分别记录。F12/F24 保持部分完成，F18/F20 已有本地契约验收不受这一外部失败改写。

随后用生产构建执行 `bun run dist/index.js --json doctor --phase model`，同一连接的独立最小请求返回 **502 status code (no body)**，model phase 为 fail，耗时 10267 ms。[诊断阶段导出](../output/model-doctor-risk-2026-10-11.json)只保留阶段结果，未导出凭证或端点字段。CLI 的进程退出码为 0，不能替代阶段成功判断；这一独立探测不能追溯证明前两次失败也返回了 502，更不能据此区分网关、代理或供应商故障。

复跑方式：

```powershell
bun test src/runtime/risk-answer-evidence.test.ts src/runtime/research-evaluation.test.ts src/app-runtime.test.ts
bun test src/tools/quant-tools.test.ts src/storage/test/archived-analysis.test.ts src/runtime/research-task-matrix.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
# 使用已有模型配置，会产生用量；每次选择新文件，禁止覆盖历史证据
bun run eval:research -- --case risk --timeout-ms 300000 --max-requests 12 --output output/research-evaluation-risk-next.json
```

本轮最终工程验证：六指标核对/评测/交互运行时专项 **84/84、536 次断言**，工具/归档/任务矩阵专项 **30/30、284 次断言**。`bun run test` 全量 **1899/1899、225 文件、25169 次断言、215.37 秒**，日志 `%TEMP%/whyj-risk-six-metrics-full-2026-10-11.log`；typecheck、architecture（0 baseline violations）、独立评测脚本严格类型检查、test fence 和生产构建通过，构建为 **2673 modules / 7.50 MB**，产物版本输出为 WhyJ 1.2.0 / Pi 1.1.0。文档相对文件链接及两份输出的凭证字段标记检查通过；该检查不代表完整敏感信息审计。
