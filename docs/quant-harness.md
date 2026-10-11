# Quant Harness：运行时、上下文与扩展

更新：2026-09-15。本文合并原 Agent 系统规格与上下文说明，作为量化运行时设计入口。**当前实现**与**待实施契约**分开描述；完成度唯一来源为 [PRD F17–F25](./PRD.md)。底层生命周期细节留在 [Pi 会话适配](./pi-agent-loop-harness.md)，模块依赖规则见 [模块架构](./module-architecture.md)。

## 当前执行链

```text
CLI / TUI → AppRuntime
  ├─ slash → CLI registry → handler / runtime service → effect / result
  └─ 自然语言 → dispatch → QuantAgentSession → WhyJ session-runtime
       → kernel/loop → Pi runAgentLoop
         ├─ kernel/llm → Pi provider
         └─ built-in tools → runtime → source / quant / storage
```

Pi AI/Agent Core 精确锁定 1.1.0。Pi 拥有低层循环、模型目录和协议；WhyJ 拥有 JSONL v3 tree、队列、压缩、导航、应用上下文与 UI 事件映射。系统提示词和工具声明通过 Pi transcript 的 system 消息传递，具体迁移见 [Pi 会话适配](./pi-agent-loop-harness.md)。没有迁移到上游新版 durable Harness/lane，也没有 Pi ExtensionAPI 宿主。

Shell 参数与 slash 分开解析。CLI catalog 的唯一来源是 `runtime/command-catalog.ts`；业务计算通过 Agent tools，命令契约见 [Slash 参考](./slash-commands.md)。Doctor 的显式网络检查及 compact 会调用模型，“slash 一律无 LLM”不成立。

## 所有者与量化意义

| 所有者 | 当前职责 / 入口 | 对量化场景的意义 |
|---|---|---|
| Pi kernel | [loop.ts](../src/agent/src/kernel/loop.ts) / [llm.ts](../src/agent/src/kernel/llm.ts) 适配 | 升级真实运行依赖，不维护重复协议 |
| 会话 facade | [session.ts](../src/agent/src/session.ts)、session-state | 研究切换后旧事件不污染新对象 |
| 会话 runtime | operation、harness/session、compaction | 取消涵盖准备/执行/落盘；恢复和摘要有一致的操作边界 |
| 研究上下文 | [context.ts](../src/agent/src/context.ts) | 后续“继续”关联最近对象和结果形状 |
| 数据编排 | [analysis-data.ts](../src/runtime/analysis-data.ts)、source-runtime | 指标工具获取所需区间并传递来源/陈旧状态 |
| Overview 刷新 | [overview-refresh.ts](../src/runtime/overview-refresh.ts)、[overview-data.ts](../src/runtime/overview-data.ts) | 独立生命周期与可注入请求池；行情/组合共享并发上限和本轮去重，模型会话不参与刷新 |
| 纯计算 | [quant](../src/quant/backtest.ts) | 现金/股数账本与共享指标已通过独立反例回归，见实施记录 R01 |
| 存储 | [存储策略](./ohquant-storage-policy.md) | 区分观察配置、公开数据、研究制品和私有资产 |
| 报告 | [artifact-reports.ts](../src/runtime/artifact-reports.ts) | 完整 turn 落盘后才形成可恢复研究报告 |

Session 通过 [QuantAgentDependencies](./session-dependencies.md) 接收模型连接、工具、skills、repo、prompt 和证据核验端口。默认本地组装位于 `session-dependencies.ts`；独立内存 repo 与自定义量化工具已经过真实 Pi 循环验证。架构 gate 禁止 facade 直接绑定 storage/tools/source/tui，但不证明模块已经可选安装。

## 模型连接与操作快照

Settings、Doctor、Agent 共用 [model-config.ts](../src/agent/src/model-config.ts)。Provider、实际模型 ID、凭证和能力覆盖按归属保存；目录与 API-key 引导复用 Pi。[Pi 配置导入](./pi-config-import.md) 已支持选定连接的显式预览与版本核对，所选有效 OAuth 账号可共享 Pi auth.json 链接和刷新锁；合成目录与四进程已验证，真实账号及跨终端同时请求仍待验收。所有字段与优先级只在 [配置参考](./configuration.md) 维护。

新 prompt/skill/手动压缩读取连接；正在运行的分析与排队续问保持其连接快照。更换 key 和 endpoint 不清空历史，也不得把新 key 发到旧 endpoint。协议与 URL 分别选择，不根据 URL 后缀推断协议。

## 模型上下文与用户原文

```text
AppRuntime 原始 input / displayText
 → dispatch: idle=prompt；工具中=steer；其余流式期间=followUp
 → Session facade 注入 SessionCtx / turn 引导
 → displayUser { content: 模型文本, displayText: 用户原文 }
 → convertToLlm → provider 标准 user 消息
```

`displayUser` 是本地扩展消息，不直接发送给 provider。TUI 与 Composer 使用 displayText；模型使用增强后的 content，避免研究元数据渗入用户输入显示。队列真源在 harness，Composer 订阅 queue_update，不维护另一份待处理输入账本。

SessionCtx 保留最近对象/窗口/结果形状作为轻量提示；R06 的 [ResearchState](./research-state.md) 从当前分支原始 entries 重建用户原文、研究参数、组合版本、数据引用、核验发现、报告引用及未完成调用。工具结果后每次 Pi 请求重新注入精简投影；[ResearchTask](./research-tasks.md) 提供显式目标/条件、重试关联和报告绑定，第四阶段通过 research_task 工具接通普通输入的声明/查看/取消。`/resume --task` 本地只读面板显示同一投影，完整任务交互与真实模型的语义覆盖仍待验收。

System prompt 由 [system-prompt.ts](../src/agent/src/system-prompt.ts) 纯函数组装基础量化约束、本次活动工具名、缓存观察摘要、skills 名称/描述/路径索引与额外文本；默认本地缓存读取留在 context.ts。工具描述和参数直接使用实际 Pi schema，不维护第二份手写工具目录。Shell 平台说明仅在 bash 活动时加入；缓存观察不被解释为工具可用性。显式 skill 运行加载对应内容。

2026-09-15 的流程提示改为遵守显式任务和已启用能力，不再无条件追加固定因子/风险调用或扩大日期。较完整的技术分析仍保留因子、风险与展示建议；任务参数优先，结果行、来源、缺项和证据要求继续保留。实际 Pi/SSE 验证受限回测和动态自定义工具的说明与 schema 一致；提示约束不等于模型必然遵守。[研究任务评测](./research-task-evaluation.md) 保留四类固定矩阵和真实模型的逐例结果，尚无总体成功率或完整解释质量通过结论。F12/F24 继续验收。

## 生命周期、恢复与压缩

单一 HarnessOperation 管理 turn、compaction、branch_summary。只有 idle 开始独占操作；waitForIdle 等待监听器和 flush，不能从正在被 awaited 的同一监听器里等待自己。

abort 清空 steer/followUp/nextTurn，向准备、模型、工具和摘要 hook 传递 signal；提交摘要或移动 leaf 前再次检查取消。失败与取消不应留下永久 busy 或半份摘要。

JSONL v3 是 append-only tree；parentId 与 leaf 决定分支，compaction/branch_summary 是显式 entry。恢复先等待/取消旧操作，目标成功打开后替换；失败保留旧会话。navigateTree 在同一树中移动，resume 切整个文件，两者都经 facade。

报告恢复另带生成时的 provenance：验证原 entry 内容、顺序和 leaf/parent 链后准备目标分支；skills、prompt、证据和模型准备全部成功才移动 leaf 并替换状态。允许源文件追加后续研究，拒绝改变旧记录或把同一份报告指向其他 leaf；准备失败保留原分支和活动 session。ResearchState 重建该分支中的报告引用和核验参数；要求报告的任务还通过宿主端口读取固定不可变版本并比对来源元数据，缺档时保留引用但撤销 `complete`。其它历史 `reportRef` 只表示记录，实际打开仍经报告服务验证。

压缩会调用模型生成摘要，不是零调用成本的启发式截断。自动压缩在新 prompt 前按阈值触发，手动 compact 先等待 idle。R06 的真实 Pi/JSONL fixture 故意让摘要遗漏组合、参数、报告和待办，下一轮请求仍从完整分支重建这些字段；摘要内容不作为核验事实。UI 的旧压缩回执只检查摘要文本，不能替代结构化状态或研究质量评测。

活动 HUD 与离线 session 列表当前使用不同的窗口来源：前者使用模型连接能力，后者使用存储层本地表/回退估计。统一和恢复准确性属于 F03/F20，不能把两者等同。

## 数据、计算与报告链

`loadAnalysisBars` 统一自动取数与窗口校验，source 选择市场兼容 provider 并回退，storage 保存公开日线与来源元数据。刷新时间与数据 as-of 日期不同；日线/净值不代表逐笔实时行情。合成刷新分阶段基线与固定窗口真实服务矩阵见 [数据测量](./data-validation.md)，后者仍有失败项，整体刷新预算尚未验收。

R02 已提供单次快照读取、进程间写锁和不可变数据版本。Bars 的 DatasetRef/`loadDataset()` 与独立 FundNavDatasetRef/`loadFundNavDataset()` 固定公开观察；报告 Research inputs 按类型读取归档并独立绘图，缺失版本不使用最新行情。因子、风险、SMA、Benchmark 和新方法 DCA 已按匹配参数重算并核对保存结果，DCA 包括 NAV/费率依据和完整模拟账本。Dashboard 按当次捕获的完整评分集合重算与核对排名，不重新扫描现有评分目录。引用固定本地观测，不证明历史当时可得性、复权或分红总回报；R06 的研究状态共用这些核验器。

目前 108 个内置工具为 89 data、18 quant、1 system，另按会话绑定 research_task，详见 [注册表](./builtin-tool-registry.md)。这不是用户实际可用权限数，也不是插件数量。观察组合 list/edit/compare/history 工具使用快照、版本校验、价格/同日 FX 对齐与独立历史重算，契约见 [组合比较](./portfolio-comparison.md)。比较报告已绑定原始调用、价格版本和比较归档中的 FX，再核对完整结果；分享使用匿名组、单位曲线和假设权重。真实浏览器视觉验收仍待补。

[新闻研究](./news-research.md) 通过 research_news 查询 Yahoo/东方财富，按市场时间窗过滤和去重，结合归档核对后的价格因子返回条件化建议。标题初筛不具备校准概率，新闻观察随原分支恢复但不升为 verified 金融事实；缺证据保留 unresolved。

新新闻研究结果 version 2 将出版方主张、抓取页面观察和未评估的命名价格形态分别写入 `evidenceBoundary`；纯窗口返回 `patternAssessment.rule=null`，计算出的发表前后收益不能被当作已核验“反转/利好出尽”形态。工具与 ResearchState 的有损恢复使用同一状态，旧 version 1 会话不自动补写。执行/恢复回归已通过，模型语义仍按 [真实评测](./news-evaluation.md) 逐份审阅，F11/F20/F24 未完成。

新闻工具还展示逐段可复制的 `[citationId/pN]` 或受限正文 `[citationId/restricted]`，并将价格来源与 A/US/HK 的 provider 支持矩阵核对。合成四例评测曾出现裸段落键和港股错误来源标签；自动检查保留原失败，修订后的模型回答仍须单独核对“缺关联证据”是否被误说为否定。

`evidenceBoundary.targetCompanyRelation=unassessed` 进一步标记新闻候选路由与正文数字缺失不能判定公司关联；ResearchState 恢复带同样说明。四例自动通过仍出现港股未知/否定混淆和文章级 `[citationId]`，后者已加入评测拒绝条件。结果不会把主体匹配自动升级为 verified；新的模型复测仍按人工审阅判定。

第三份四例评测确认港股未知/否定措辞改善，但正文研究末尾仍单独用了 `[citationId]`；反转研究 6/6 又对未检验窗口作假设性命名。工具现区分映射键和可引用段落 token，纯价格窗口删除形态名称示例，显式要求只报告观察收益。相关确定性回归通过，真实模型的改善范围仍见 [评测记录](./news-evaluation.md#2026-09-15公司关联未知与文章级伪引用复测)。

最新港股与反转单例的研究/恢复各通过 6/6，前者保留公司关联未知，后者未再命名价格形态；反转研究仍把 p1 的合成数字声明错引到 p2。段落 token 有效不能代替逐句主张核对，最终证据与工程门槛见 [新闻评测](./news-evaluation.md#2026-09-15未检验形态单例与段落语义)，三项状态不升级。

为减少模型对末尾 JSON 的段落键误配，新闻引用的模型可读行由独立纯模块生成：每个 `[citationId/pN]` 紧挨转义后的网页原文，并标明这是不可信页面观察。完整结构化结果和恢复引用保持原格式；这只是证据呈现改进，不能充当语义验收，复测见 [逐段呈现](./news-research.md#逐段原文与引用同屏2026-09-15)。

最新反转合成单例中 p1/p2 主张对应未再错位，工程回归与模型原始记录见 [评测](./news-evaluation.md#2026-09-15段落与引用并列的反转单例)。网页正文更容易阅读也使恶意段落可见，格式模块以引号转义且标明不可信；恶意页面单例仍需模型复核，未据此宣布普遍的指令隔离或语义通过。

固定冲突单例实模复核显示 p3 被两阶段作为不可信正文引用并忽略，没有服从页面输出标记；原始回答与限制见 [记录](./news-evaluation.md#2026-09-15可读恶意网页段落的冲突单例)。这一观察不扩大为第三方网页或所有注入输入的保障，新闻工具仍只把页面作为待核实证据。

Auto Artifacts 默认关闭。开启后量化 turn 完成并写入 JSONL，再按当前分支生成 Dashboard/Trajectory。HTML/meta/provenance 原子保存为不可变版本，恢复打开选中的旧版本；新研究另生成新版本。独立分享 HTML 仅含公开观察和核对后的无金额结果，预览/下载与原报告同版本固定；完整报告仍可能复制私密输入。轨迹仍从 session 派生，没有独立实时 DAG recorder。原报告交互图依赖 ECharts CDN，K 线有静态回退，归档 NAV/分享使用无外部依赖的 SVG/Raw。

[年度研究报告](./annual-reports.md) 由两个默认工具生成和恢复，直接选择比较 ID 而不构造虚拟 session。research 共用 Bars/NAV 和比较核验器，artifact 渲染离线文档，storage 保存原始 HTML 与内容绑定。research_decisions 记录显式研究选择、理由及声明/实际时间，年报可通过 decision_ids 绑定选定记录；重复请求幂等，恢复重查比较/日志/公开数据。ResearchState 保留参数和引用为 recorded，不提升为用户批准、真实成交或账户业绩；完整年度覆盖、真实账户与模型语义仍待验收。

## 待实施：Quant Harness 与 extensions 契约

以下包含部分已实现端口与后续设计目标；只有明确标注的入口可调用，具体退出条件见 PRD 和 [roadmap](./roadmap.md)。

| 端口 / 状态 | 输入与输出建议 | 量化收益 / 验收 |
|---|---|---|
| ResearchTask / Goal（部分已实现） | `runtime/quant-harness.ts` 接收结构化目标/范围/版本/能力和条件，投影状态/证据/待办；默认 AppRuntime 接入工具范围守卫与会话绑定的 research_task 工具 | 宿主入口、普通输入、只读面板及股票/指数/基金/组合固定任务已验证；完整交互与真实模型评测待补 |
| DataPort / DatasetRef（部分已实现） | 已有 source 原子 cache port 和 Bars/NAV 版本引用；复权/历史可得性尚未规范 | 工具、评分、报告输入和七类量化结果已消费引用；比较另外绑定含原始请求/FX 的不可变归档，缺失证据不使用最新值 |
| CapabilityRegistry（部分已实现） | 已有实际 tool schema/display/requirements 投影、逐工具依赖及独立端点响应检查；[按任务装配](./research-tasks.md#按任务装配2026-09-15) 将请求工具收缩为 allowedTools 与宿主交集，并收缩技能模式 | 既有真实 Pi/SSE 样本验证当时 107→2；本轮本地 Pi 工具消息回归覆盖 109→2、取消/切换/恢复。新增工具的真实模型选用、第三方技能相关性和完整解释质量待评测 |
| Evidence / Evaluation | 工具值、参数、数据引用、假设 → 可核验结论和缺项 | 指标或引用缺失时保留“未完成”，不是编造结论 |
| ContextStore | 研究状态 snapshot 与证据引用 → 恢复后的任务上下文 | 压缩后保留对象、参数、已验证发现与开放问题 |
| ExtensionHost（已接入默认应用） | WhyJ API 1，manifest、加载/禁用/重载、冲突、取消和诊断；动态工具/技能会话端口 | 默认启动、`/config --extensions` 与启停持久化接通；内置扩展与独立 fixture 经真实 Pi 验证，静态分发边界见 [扩展宿主](./extensions.md) |
| ExecutionPort（接口阶段） | paper/live 目标、精确限价意图、预检/授权摘要、幂等服务契约 → 订单/成交或待核对状态 | [调用边界](./execution.md) 经合成服务验证，无默认下单工具或真实账户适配；真实服务仍须单独验收 |

当前扩展选择 WhyJ Extension API 1，复用 Pi 工具/技能类型，通过静态 import 显式加载；不实现 Pi 原生 ExtensionAPI，不能直接安装生态 npm 扩展。Pi 插件研究见 [生态分析](./pi-quant-ecosystem.md)，属于外部参考。

Skills 默认仓库和白名单见 [Skill 系统](./trader-skills.md)。[独立安装器](./skill-installation.md) 已实现更新失败保留、临时发布、来源与本地修改检查，以及后台安装、失败回执和退出取消。[精选 catalog](./curated-skills.md) 固定默认版本并声明分模式依赖。安装结果在空闲查看列表或下一次独立请求时载入同一会话，循环和排队续问保留原快照；[依赖判定](./skill-readiness.md) 已联动活动工具、本地 Python 观察、固定 CSV/ETF 网络观察、逆向/宏观脚本内容核对、模型索引和显式调用。宏观主程序已有一次公开九 ETF、无 FMP key 的隔离执行及报告形状检查；评分/结论、其他第三方脚本、FMP 权限、私有输出与完整任务仍待核验。[Alpha/AKQuant](./alpha-backtest.md) 已接入默认三工具、配置依赖检查、固定数据/UUID 归档和报告/历史核验。独立模块负责计算与回执核验，runtime 负责数据和存储；真实 Pi + AKQuant 合成链路通过，不代表真实模型语义或市场交易规则已验收。

## 验证与维护

研究/新闻/年报评测共用 [最终回答收集器](../src/runtime/evaluation-answers.ts)，按本次 prompt 事件保存文本与结束状态；证据完成和回答正常结束分别检查，恢复成功不能覆盖前段失败。基金工具、研究投影和新报告消费 [同一收益说明](../src/quant/fund-dca-notes.ts)，从实际申购/估值日期区分本金收益、TWR 和年化 XIRR；旧数值归档与 HTML 保留。[逐例评测](./research-task-evaluation.md#2026-09-15最终回答与基金收益口径) 仍单独审阅真实模型解释。

- kernel/session：真实 Pi 循环配合确定性传输、本地 HTTP、取消/隔离/恢复测试。
- quant/data：人工账本、独立参考、日期/费用/来源 fixtures；真实账户与真实市场单独验收。
- harness：固定量化任务检查能力选择、必要指标、引用和压缩后字段保留；尚无总体成功率基线。
- 工程门槛：typecheck、architecture、test fence + tests、build。R01 的数值反例已单独回归；工程通过不替代真实服务和研究任务验收。

历史细节见 [原系统规格](./archive/agent-system-spec-before-prd.md)、[原上下文说明](./archive/agent-loop-context-before-prd.md)，它们不再定义当前状态。
