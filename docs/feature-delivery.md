# 25 项功能实施记录

开始：2026-09-14。范围是 PRD F01–F25 全部验收条件；本记录跟踪实际实现，不以新增文件或 mock 成功代替端到端完成。原始盘点与历史反例保留在 prd-audit.md。

## 执行顺序与边界

按 roadmap 的依赖推进：数值/数据/存储 → 配置与 UI → 组合研究与 Harness → skills/扩展 → 情绪/年报/alpha → 执行。保持 F09/F14/F22 的既有流程。平台选择未确定前推进通用执行契约和模拟验证，真实下单不属于本次自动执行操作。

F01 文件互通采用显式预览与导入，失败保留 WhyJ 原设置；OAuth 登录另按 provider 支持实现。品牌以 DESIGN 为准，行情颜色提供市场语义。报告先基于观察组合研究，真实账户业绩需单独的数据契约，不推测用户资产。

## R01：回测与指标契约

状态：已完成本地回测与评分的数值契约验收（2026-09-14），不是实盘执行或全市场数据验收。

- 长仓目标权重为 [0,1]。上一根 bar 的信号在下一根收盘成交，不提前持有；首行是初始现金快照，收益首行 0 不是一个有效收益期间。
- 逐 bar 按当前价格对持仓估值，先计算交易前权益，再调整目标权重。交易金额和费用从现金扣除；全仓买入也为手续费预留现金。输出 cash、position、trade、cost、equity，满足 equity = cash + shares × close。
- commission 与 sell stamp duty 是显式模拟假设，不宣称等于真实券商/市场费率；调用方记录所用数值。禁止无意借款、非法权重/价格、非有限数据。
- CAGR 使用复利终值和实际时间跨度；无日期的纯收益序列使用显式年化频率（默认 252）。工具有日期时按实际天数 / 365.25；波动率和 Sharpe 仍用注明的 252 期间频率。
- Sharpe 用样本标准差；Sortino 用全部期间相对目标收益的负偏差平方均值，而非仅亏损样本自身标准差。分母为零的比率返回 null 并展示 N/A。
- Benchmark 复用同一指标模块。成对输入必须长度一致；有日期时严格相同、递增，不静默截断。训练/测试各用自身跨度。
- 参考核验：[Quantopian empyrical 源码](https://quantopian.github.io/empyrical/_modules/empyrical/stats.html) 的复利年化与下行偏差定义；本项目的成交和费用账本是独立定义，并非照搬其交易引擎。

验收先使用人工账本与独立公式，再覆盖工具和保存制品；不让实现自己生成测试期望值。市场限制、价格复权和滑点仍需在后续数据/执行阶段明确，不将本引擎描述成实盘成交模拟。

实现：`quant/backtest.ts` 负责交易账本，`quant/performance.ts` 统一回测/Benchmark 的指标；risk 与 dashboard 共用下行偏差和未定义值语义。默认 commission 为 0.0003、stamp_duty 为 0；无滑点、允许碎股，工具输出和评分制品记录假设。上涨期间比例和期间盈亏比不再称为交易胜率。

验证：新增 15 项独立数学/账本测试及 1 项真实工具入口 fixture；先复现原失败，再验证现金、再投资、费用、复利、日期对齐、Sortino、回撤恢复和 null 展示。`bun run test` 为 707 pass / 0 fail（81 文件、5664 断言）；typecheck、architecture、build 均通过。日志 `%TEMP%/whyj-r01-tests.log`。原权益反例末值现为 110000；两期间 +10%/-10% 累计为 -1%，年化按显式跨度复利计算。

## R02：原子缓存与数据版本

状态：前八阶段的本地实现已验证，完整 R02 继续进行；六类量化结果已绑定，实际 Overview 刷新已独立并建立分阶段基线。整体刷新预算仍未验收，真实矩阵尚有失败项。

- 保留本地 JSON 文件架构。单份 `snapshot.json` 同时包含 bars、meta 和内容校验；同目录唯一临时文件写入并 fsync 后 rename 提交，读者只接受完整快照。
- 成功提交前保存不可变 `revisions/<revision>.json`；DatasetRef 定位 source/symbol/revision 与所选区间，修订行情不改变旧研究所引用的数据。
- 使用 proper-lockfile 的进程间写锁包住读取、合并与提交；异步缓存写入有限重试，等待期间可取消。统一 lease 参数，崩溃遗留锁过期后恢复，不手工删除活跃锁。临界区只做同步本地 I/O，不执行网络或用户回调。
- Freshness 检查与数据读取使用同一个 snapshot。仅本次成功请求覆盖的范围获得新 freshness；合并进来的旧历史不因抓取少量新数据而续期。
- 旧 daily/meta 缓存只作 stale 迁移输入；损坏快照不退回旧文件冒充 fresh。取消在等待锁后与提交前复查。
- 配置和观察组合的原子写入/并发冲突、session/报告版本及分享边界继续属于本切片，完成后另记证据。

实现依据：[proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) 的锁生命周期与过期语义。此切片验收进程崩溃与并发，不将文件 fsync 描述为已证明所有文件系统的断电持久性。

第一阶段（2026-09-14）：以上行情快照/归档、source 原子读口和取消链已实现；DatasetRef 已进入行情/因子/回测/风险工具结果及 Benchmark JSON，评分制品也改为原子写入。新增六项快照测试覆盖八个独立进程写入、提交中途 kill、遗留锁恢复、迁移、损坏、修订和取消；另补 source 缓存取消及工具 signal 传播。专项 77 pass / 0 fail；首轮全量 715 pass / 0 fail，82 文件，5712 断言，日志 `%TEMP%/whyj-r02-snapshot-tests.log`。typecheck、architecture、build 通过。

报告链复核：当前 generator 从 session 文本序列派生指标，没有直接读取最新行情缓存。它仍有重复的年化/Sharpe 公式，本轮已复用共享指标，并按实际日期计算 CAGR；无效日期不生成伪年化，未定义 Sharpe 不生成零值卡片。周/月/季/年序列使用对应频率。新增生成器回归覆盖日历跨度和常值序列。后续需把 DatasetRef 接入报告的结构化输入，再验证跨对象/跨版本不混用；不能把“引用已保存”当作报告完整验收。

本阶段最终回归：**716 pass / 0 fail，82 文件、5717 断言**（`%TEMP%/whyj-r02-final-tests.log`）；typecheck、architecture（0 baseline violations）、build 和 `git diff --check` 全部通过。此次未调用真实市场或模型账户，未标记完整 F08/F21 已完成。

第二阶段（2026-09-14）：配置与观察组合的并发保护已实现并验证。设置和观察组合沿用 JSON，保存持锁、校验读取时的内容版本，再原子替换。版本只随内存草稿传递，不写入设置或组合字段；没有读取版本的对象仅允许创建不存在的文件。旧设置规范化在锁内重新读取后迁移。损坏 JSON 明确报错并保留原文件，不返回可误保存的默认值。组合命令在同一锁内读取、校验和修改最新内容。模型/密钥草稿冲突时保留编辑状态，不触发保存成功、刷新或网络验证；锁占用可原位重试，取消失败密钥草稿不会被其他开关顺带提交。CLI 在损坏设置下保留 JSON 错误协议与可用的 `--help`。

实现：新增 `storage/src/durable-json.ts`，设置/组合共用版本检查与提交；runtime 组合编辑改成锁内事务，PanelController 保存使用原始草稿版本。新增 8 项持久化回归和 5 项界面回归：包括八进程组合修改全部保留、八份同版本设置仅一份成功、外部编辑、迁移锁、损坏文件与 80×24 错误提示。组合文件损坏时 Settings 仍能渲染并显示不可用状态。四处旧测试数据准备调整为先读取版本再修改，原有行为断言保留。

验证：**729 pass / 0 fail，84 文件、5814 断言**，日志 `%TEMP%/whyj-r02-preferences-final.log`；typecheck、architecture（0 baseline violations）、build 和 `git diff --check` 通过。本阶段未运行真实账户调用。F21 仍为部分完成：session/报告版本、报告 DatasetRef 消费和分享过滤继续实施。

R02 第三阶段实施契约：报告的 HTML、元数据和研究来源组成带校验的单份快照，原子提交并保留不可变版本。列表选择携带具体版本，恢复打开该版本，不用最新会话覆盖选中的报告。后续研究仍可自动生成新版本。旧 HTML/sidecar 只作迁移读取；新快照损坏不退回旧副本。研究来源记录生成时的会话内容哈希、entry/leaf 与 DatasetRef，校验旧行情版本；报告图表与结构化研究状态的完整绑定继续逐入口验证，不能将来源记录等同于所有文本结论已被核验。

第三阶段（2026-09-14）实现：

- `storage/src/artifacts.ts` 将 HTML/meta/provenance 保存在单份校验快照中。持锁归档后原子更新 head，沿 previousRevision 只列已提交版本；归档后、提交前崩溃留下的文件不冒充已完成报告。旧格式首个新版本保存前会归档旧报告。HTML 视图损坏可从该版本修复，损坏 head 不退回旧格式。
- 选择器携带 `id@revision`，显示生成时间和版本；纯 CLI 文本及 JSON 列表也区分相同标题的版本。恢复验证原 entries 与分支一致后再切换真实 session；选中旧报告不会覆盖后来生成的 head，也不会重新生成 HTML。
- 来源丢失或变更时保留当前会话与报告文件；缺失来源只从可恢复列表隐藏。取消了读取列表时自动删除研究证据的行为。显式删除 listing 仍保留可定位的不可变归档，尚无自动回收策略。
- 新增 `artifact/src/report-input.ts`，读取完整 JSONL 后选择分支；记录文件/entry 哈希、ID 顺序、leaf 和工具 DatasetRef。拒绝截断、重复/缺失 ID、缺父项、循环及与报告不匹配的 leaf。允许后来追加研究，原 entries 改写则拒绝恢复。
- Research inputs 按归档 DatasetRef 绘制独立价格图，含标的、source、区间、观测时间及数据版本详情。缓存同日修订后仍显示旧价格；归档缺失显示 unavailable。补齐日期顺序、窗口、缺失 revision 与复权/可得性声明校验，不能用缺失版本字段读取当前 head。
- 文本检测的指标保留在 Session interpretation；若已有归档价格而没有文本指标，不再重复显示“没有价格”的空面板。浏览器验证发现并修复 Chart/Raw 切换受 CSS 默认隐藏影响的问题，并补上 CDN 不可用时 Raw/主题切换的保护。

第三阶段新增 13 项回归（相对第二阶段 729 项）：两组八进程/崩溃与历史版本测试、真实 Agent 分支恢复、行情修订后的实际图表数组、引用缺失、歧义 ID/错误 leaf、非法数据引用和 CLI 版本列表。先复现错误 leaf 被接受、日期顺序被忽略的反例，再验证修复。浏览器用 synthetic AAPL/MSFT 数据检查 1440×1000 与 390×844、独立 Chart/Raw、版本详情、Trajectory 切换；正常 CDN 无错误，模拟 CDN 503 时两张 SVG 回退及 Raw/主题可用，仅有预期的资源 503。

最终验证：**742 pass / 0 fail，86 文件、5899 断言**，日志 `%TEMP%/whyj-r02-reports-final.log`；typecheck、architecture（0 baseline violations）、build 与 `git diff --check` 通过。所改文档的 103 个本地链接无缺失。浏览器 fixture、HTML 和截图保存在 `output/playwright/report-preview.ts`、`whyj-report-versions.html` 及同名前缀 PNG；可用 `bun run output/playwright/report-preview.ts` 重建合成数据报告。临时服务与测试浏览器已关闭。

限制：本阶段锁定的是报告字节、来源分支和输入价格，不声称文本策略业绩全部验证，也没有完成结构化研究状态、JSONL writer 的崩溃/多进程契约或分享过滤。没有调用真实模型或市场账户；F21 继续为部分完成。

## R02 第四阶段：会话持久性

R02 第四阶段实施契约：保持 JSONL v3 的逻辑追加与旧文件可读，通过独立 SessionFilePort 读取字节版本并原子提交完整转录。持锁检查读取版本；外部追加、删除或改写后旧 writer 不自动合并研究上下文，明确冲突并保留内存/磁盘可恢复状态。完整 fork 一次提交，不展示半份分支。解析拒绝歧义 ID/父链，读口返回副本。文件事件订阅者不能将已成功写入伪装成失败。验证真实多进程争用、提交中 kill、失败重试与同一实例并发，另测大转录的写入开销；不将本机进程故障测试当成全部文件系统断电保证。

第四阶段（2026-09-14）实现：

- `types/session-file.ts` 定义字节版本端口，`storage/src/session-file.ts` 实现 UTF-8 严格读取、SHA-256 版本、持锁比较、原子替换与检查后删除。只允许基于读取版本增长文件；旧 writer 在外部追加/修改/删除后报冲突，重新打开才能继续。相同事务在提交确认丢失后重试可识别已提交字节。
- `jsonl-format.ts` 独立解析格式和树引用；`jsonl-storage.ts` 管理提交版本、内存索引和原子批次；`jsonl-repo.ts` 注入端口并一次提交完整 fork。Session 各种追加共享排队和 ID/parent/timestamp 构建，避免并发调用从旧 leaf 分叉；读口不暴露可修改的历史对象。
- leaf 移动和摘要写入同一事务，压缩/导航的取消信号贯通文件锁等待；失败不提前改内存。文件事件分别隔离同步异常、异步拒绝和订阅者对事件对象的修改，事件在会话提交锁释放后发出。
- 复核发现指定分支 fork 的标签可能指向其他分支：保留标签目标及其祖先作为引用记录，模型上下文仍只沿所选分支。新增反例先失败后修复。
- Resume 使用独立的 storage 摘要解析器；复核发现它原先跳过截断行，循环父链可能无限遍历。现在同样拒绝重复 ID、缺父项、无效 leaf 目标和截断记录；列表隐藏损坏文件但保留原字节，合法 JSONL 与 Markdown 预览继续可用。

相对第三阶段新增 22 项测试：11 项会话读写/分支回归，7 项真实子进程测试，2 项 Harness 锁等待取消，2 项 Resume 损坏文件回归。八个 writer 通过同步屏障读取同一版本后争用，仅一份提交、七份冲突；追加与 fork 分别在真实 write/fsync 之后、rename 前/后暂停并 kill，验证旧文件/新文件完整，只有确认进程终止后才模拟 lease 过期。故障注入只在子进程 preload 的文件系统边界，没有生产测试钩子。

最终回归额外暴露 Windows 读者/扫描器暂时占用目标时的 rename EPERM。原子写入现在仅对 Windows 的 EPERM/EACCES/EBUSY 在 250 ms 内重试 rename，始终保留原目标文件；持续拒绝仍报错并释放锁。两项隔离子进程注入分别验证三次临时失败后的成功和持续失败后的原文件保留/重试恢复。Resume UI 的五份旧手工 fixture 补上 JSONL v3 必需的根节点 `parentId: null`，原界面断言保留。

独立测量命令：`bun run scripts/measure-session-storage.ts`。Windows / Bun 1.3.14，合成用户文本每条约 500 字符，每种规模独立打开后追加 20 次，最后重新打开核对完整分支；没有使用模型或真实账户。

| 初始 entries | 追加后字节数 | 打开 ms | 追加 p50 ms | 追加 p95 ms | 最大 ms |
|---|---:|---:|---:|---:|---:|
| 1,000 | 680,206 | 2.77 | 5.15 | 6.43 | 6.63 |
| 20,000 | 13,640,227 | 40.23 | 48.75 | 65.85 | 68.43 |

以上是单机存储测量，不是模型性能、全局 UX 预算或跨设备基准。全文件替换仍为 O(转录字节数)，极大转录的长期写放大尚无分段日志方案；不得据此宣称任意大小文件都满足同样延迟。

最终验证：**764 pass / 0 fail，88 文件、6025 断言**，日志 `%TEMP%/whyj-r02-session-final.log`；typecheck、architecture（0 baseline violations）、build 与 `git diff --check` 通过。五份更新文档的 53 个本地链接无缺失；子进程均已退出，测试临时目录已清理。完整 F21 仍为部分完成：分享范围/过滤、结构化研究结果绑定及整体数据性能后续验收；未将此次存储完成等同于全部 25 项完成。

## R02 第五阶段：结构化结果与分享

R02 第五阶段实施契约：完整本地报告继续保存原始研究证据；分享使用单独生成的离线 HTML，不能通过隐藏 DOM 充当过滤。分享入口先预览，再由用户下载；不自动上传或发布。白名单只包含经归档校验的公开价格、研究对象/区间/来源/数据版本，以及从匹配工具调用参数和归档输入重新计算、与保存结果一致的量化指标。分享曲线以单位初值展示，排除资金金额、持仓数量、会话 ID、本地路径、凭证、用户/模型原文、thinking、任意工具原始返回和自定义标题。未绑定/不一致的结果标为不可核验；不从文本推断补齐。分享副本本身不携带原始转录或隐藏私密数据，不依赖 CDN；原始版本与分享内容随同一报告快照固定。首先覆盖已有归档 Bars 的因子、风险、SMA 回测和 Benchmark，基金 DCA 的 NAV 数据谱系须单独补齐，不能冒充已归档输入。

第五阶段（2026-09-14）实现：

- `research-input.ts` 负责公开字段投影、归档观测哈希核验和唯一工具调用/结果配对；`research-analysis.ts` 复用纯量化模块重算，检查参数、日期、标的、来源、指标和回测账本；`research-renderer.ts` 从公开 DTO 渲染已核对结果及独立分享文档。因子统计抽为纯 helper，工具与报告共用，未改变既有计算口径。
- 四类量化结果进入原报告的 Verified research results；其他文本保留在 Session interpretation/Trajectory。SMA 与 Benchmark 分享曲线以初值 1 展示，保存的绝对资金/数量不进入副本；DCA 与汇总 Dashboard 尚无完整输入绑定，计入未支持结果，不从文本补齐。
- Share preview 使用沙箱 iframe，Download HTML 下载相同字节；无可验证归档输入时禁用。副本作为 JSON 安全内嵌原报告，随同一快照版本固定，无独立可漂移 sidecar，也不自动改写旧版本或上传。独立文件使用内联 CSS/SVG/Raw 表及限制外部资源的 CSP。
- 先用反例复现并修复两处绑定缺口：重复 call/result ID 在顺序处理时可能先接受一份结果；改变请求日期或保存的标的/来源时旧计算仍可通过。现在预先检查 ID 唯一性，并核对显式日期与输入身份。

新增六项回归：四种实际工具入口、重复调用/结果、人工可算账本、参数/指标/账本/身份修改、行情修订/归档删除/源会话损坏后的固定分享字节，以及恶意元数据和私密 sentinel 过滤。人工 fixture 的 SMA(1,2) 在 101 产生信号、下一根 102 买入并持有到 113，分享末值为 113/102，累计收益 +10.78%，CAGR 独立按 13 天计算；没有用同一实现生成期望值。专项为 **6 pass / 0 fail、102 断言**。

浏览器实际检查 1440×1000 与 390×844：四类结果、两份公开数据集、四张 SVG、Raw 表、Close/Esc/焦点返回、浅色原报告均通过，无横向溢出。发现全局 margin reset 使原生 dialog 偏到左上角，已显式居中。实际下载的 97,628 字节与预览 SHA-256 一致；模拟 CDN 503 后预览可用，断网从下载文件打开仍能读取 180 行原始行情，0 HTTP 请求、0 页面脚本错误。

合成样例与检查脚本在 `output/playwright/report-share-preview.ts`、`report-share-server.ts`、`check-report-sharing.js`、`check-report-sharing-offline.js`；HTML 和 desktop/mobile/offline 截图使用 `whyj-report-sharing` / `whyj-public-research` 前缀。没有调用真实市场或模型账户。本阶段不提升完整 F21/F19 或全部 25 项的完成状态。

最终验证：**770 pass / 0 fail，89 文件、6127 断言**，日志 `%TEMP%/whyj-r02-share-final.log`；typecheck、architecture（0 baseline violations）、build（2628 modules）与仓库原配置下的 `git diff --check` 通过。六份文档的 61 个本地文件链接无缺失；临时服务与浏览器已关闭。下一步补基金 NAV/DCA 的不可变引用及结果核对，再完成分阶段数据刷新测量与跨市场真实服务矩阵；其余 R03–R13 保留完整 PRD 退出条件。

## R02 第六阶段：基金 NAV 与定投研究

R02 第六阶段实施契约：基金公开 NAV 使用独立 `fund-nav` 引用和不可变归档，保留 `.OF` 身份、实际 endpoint、日期/观测时点、内容校验及申购费观察（仅费率和来源，不保存用户金额）。不把 NAV 伪装成 OHLC，也不建立真实账户缓存；实时工具继续请求上游，历史报告只读固定 revision。DCA 工具贯通取消，费率缺失明确说明零费假设，当前公开费率不当成历史费率。报告从调用参数与归档输入重算计划、交易、账户曲线和摘要后才加入分享。分享只输出收益率、XIRR、剔除外部投入的时间加权序列/回撤和公开 NAV，原报告保留模拟账本。

发现的数值缺口：旧 DCA 回撤按账户市值计算，追加本金会掩盖损失。改用现金流发生前后分别估值的链式单位序列：先按当日 NAV 对旧份额估值，再加入当日投入、扣申购费并连接收益。申购前单位基准为 1，首个观察点包含首笔费用；本金收益率与 XIRR 独立保留。参考 [GIPS 的外部现金流/分段连接定义](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/)，本地仅为声明假设的研究计算，不声称符合完整 GIPS。使用单位 NAV，未含现金分红、拆分、赎回费用和历史申购可用性，不将结果标为基金总回报。需独立现金流样例、费用/日期/空数据与取消、同日修订、损坏/缺失归档及分享过滤验收。

第六阶段（2026-09-14）实现：

- `types/fund-data.ts` 定义公开 NAV 引用，`market/fund-nav.ts` 校验 `.OF`、日期和白名单字段；`storage/src/fund-nav.ts` 持锁原子保存不可变观察，不建立 latest head 或 TTL 缓存。历史修订形成新版本，旧报告固定读取旧版本，损坏/缺失不转用最新数据。
- `runtime/fund-data.ts` 编排实时 NAV 与可选的公开申购费观察；基金身份不符的 NAV 拒绝，费率身份不符明确降为不可用。观测时间取本地请求完成的 UTC，不把 Python 的无时区时间重新标成 UTC。`akshare_fund_nav` 保留四个既有候选端点，引用记录实际成功端点。DCA、NAV、费率与 Python 请求贯通取消，取消不继续回退或归档。
- `fund_purchase_em` 的手续费字段按百分数转换，例如 `0.03` 表示 `0.03%`；缺失/失败明确记录 `unavailable-assumed-zero`。当前公开费率只是恒定模拟假设，不证明历史费率。显式参数可指定 decimal/percent；未指定单位的既有自动解释保留。字段单位依据 [AKShare 基金接口文档](https://github.com/akfamily/akshare/blob/main/docs/data/fund/fund_public.md)。
- DCA `methodVersion: 2` 输出费用、本金收益率、XIRR 和 TWR/回撤。人工样例 NAV `[1, .5, .75]`、每月投入 1000、零费用，市值虽为 `[1000, 1500, 3250]`，TWR 仍是 `[1, .5, .75]`、最大回撤 `-50%`、本金收益率 `250/3000`。非零申购费从首笔起计入 TWR。
- 复核并修复 XIRR 的金额尺度、非法日期和固定搜索上限问题：按日合并现金流、校验有效日期，在 `log(1+r)` 上对缩放后的 NPV 求根；只有同日现金流或无法求解返回 null。独立核对 [Microsoft XIRR 示例](https://support.microsoft.com/en-us/excel/functions/xirr-function) 的 `0.373362535`，金额乘以 `1e-12`/`1e12` 保持结果，另覆盖一年 `1900%` 和接近 `-100%`。采用实际天数/365，不宣称所有非常规现金流多根都可唯一判定。
- 默认起点改为有效结束日期前五年，闰日回推到目标月末；不越过指定结束日期购买。无有效观察、重复日期、非法金额/日期及区间内无计划交易明确报错。
- `research-fund.ts` 从匹配的调用参数与归档输入重算并核对 NAV 明细/末值、计划、交易、账户曲线、摘要和费率依据。新 DCA 进入 Verified research results 与分享；旧方法结果显示未支持，不使用新算法重新解释旧报告。公开 NAV 独立画图，不伪造 OHLC。分享仅投影无金额的指标与 TWR，保留首点费用；完整报告继续保留模拟账本。

相对第五阶段新增 **20 项测试**：5 项数值/日期回归、4 项归档测试、7 项工具/取消测试、4 项报告绑定/分享测试。原 XIRR 小金额示例错误返回 `4.50005`、默认窗口和保存 NAV 修改反例先失败后修复。归档验证八个真实 Bun 进程同时写同一观察、修订、损坏、缺失与锁等待取消；工具测试通过真实入口与 mock provider，未调用市场或模型账户。

浏览器检查 1440×1000/390×844：一组 DCA 指标、独立 NAV、两张 SVG 与 Raw，首个 TWR 点为 `0.999700089973`，明确包含 `0.03%` 申购费假设；无横向溢出或私密 sentinel。7,408 字节下载与预览 SHA-256 相同；模拟 CDN 503 后预览可用，断网打开下载文件仍有 NAV 原始值，0 HTTP 请求、0 页面脚本错误。样例/脚本为 `output/playwright/report-fund-preview.ts`、`check-report-fund.js`，截图使用 `whyj-report-fund` / `whyj-fund-public` 前缀。

最终回归：**790 pass / 0 fail，92 文件、6287 断言**，日志 `%TEMP%/whyj-r02-fund-final.log`；typecheck、architecture（0 baseline violations）、build（2634 modules）和 `git diff --check` 通过。九份更新文档的 89 个本地链接/Markdown 锚点无缺失；测试浏览器和本地预览服务已关闭。真实服务覆盖、分阶段刷新测量及汇总 Dashboard 绑定继续实施，F08/F19/F21 仍为部分完成。

## R02 第七阶段：排行榜结果绑定与数据测量

R02 第七阶段实施契约：Dashboard 捕获一次读取到的完整评分集合（文件名、内容校验和评分字段），保存本次排序键、排名和汇总；报告按该集合恢复，不重新扫描当前评分目录。新评分记录保存重算所需的完整参数（含初始现金）与数据引用，旧记录保留可读但不冒充可重算结果。报告重算每个参与排名的策略，再核对汇总和顺序；私密策略标签、文件名、参数中的金额和原记录不进入分享。缺失数据/参数、改写分数、重复记录或排序不符时显示未核验，不用剩余条目冒充原完整集合。空目录、损坏文件、取消和缺失指标有明确行为；中位数使用通常的偶数样本两中间值平均，缺失指标为 N/A。下一步的数据性能测量按排队、provider、解码、缓存、本地展示分开记录，真实服务与合成测量区分。

第七阶段（2026-09-14）实现：

- `benchmark-results.ts` 提供可取消的一次扫描捕获，保存文件名、解析后 JSON 哈希和评分内容；每 32 项让出事件循环，损坏文件保留并计数。捕获是依次读到的文件集合，不声称全目录文件系统事务。评分第三版保存完整 SMA/现金/费用参数，算法沿用第二版。
- `quant/dashboard.ts` 修正偶数中位数，缺失收益/风险指标使用 null；无效记录不当作零分，排序同值稳定、缺失值最后。汇总覆盖全部有效行，展示只取前十。
- `research-dashboard.ts` 从捕获的全部评分、归档行情与参数重算，再核对分数、来源、费用、日期、汇总和顺序。`research-references.ts` 为报告及 provenance 收集嵌套数据引用。后续评分修改不影响旧报告；缺失参数的旧集合可读但未支持，归档丢失/结果修改不伪装为部分成功的完整排名。
- 分享排行榜仅显示公开标的、区间、SMA/费用假设、数据引用、分数和比率，排除策略标签、文件名、现金和原记录。表格区域可聚焦，支持键盘横向浏览。

相对第六阶段新增 **10 项回归**：三项人工聚合/排序测试、七项真实工具到报告/扫描取消测试，包含重新计算内容哈希后的分数/来源/成本改写，证明不是只检查哈希。独立 Dashboard 转录无需带此前 score 调用也可重算；旧文件改写/归档删除、损坏与外部取消有回归。

浏览器 1440×1000 / 390×844 检查排名、来源、分享过滤与键盘焦点；3 行排名、2 份去重数据集，CAGR 顺序 27.95%、27.30%、23.59%，无横向页面溢出。CDN 503 时预览可用，下载文件断网打开 0 HTTP 请求、0 页面脚本错误。46,745 字节下载与预览 SHA-256 相同。fixture/检查为 `output/playwright/report-dashboard-preview.ts`、`check-report-dashboard.js`，截图使用 `whyj-dashboard` 前缀。

`scripts/measure-data-refresh.ts` 建立每条件 10 次、1/10/50 标的、冷/热缓存/HTTP 503/超时的局部基线，包含排队、transport、解码、缓存和 Overview view 构造。50 标的冷/热缓存 batch p50 为 469.162/70.484 ms，热缓存 0 次 HTTP；保留长尾，不用它证明实际 Overview 的 live 刷新速度。完整分位数、失败率、环境和未覆盖范围见 [数据测量](./data-validation.md)。

最终工程回归：**800 pass / 0 fail，94 文件、6339 断言**，日志 `%TEMP%/whyj-r02-dashboard-final.log`；typecheck、architecture（0 baseline violations）、build（2636 modules）与 `git diff --check` 通过。两个测量脚本另作严格类型检查；九份文档的 97 个本地文件链接/Markdown 锚点无缺失。追加浏览器核验确认方向键实际改变排行榜的 scrollLeft，焦点保持；浏览器和预览服务已关闭。应用测试没有调用真实市场/模型；下面的独立市场检查确实发起了上游请求，结果分别记账。

R02 真实服务矩阵实施契约：独立脚本固定 A 股、指数、US、HK 和公开基金 NAV 样本及历史日期窗口，读取当前行情配置，直接经过现有 provider 编排，不以热缓存作为连接成功证据。输出市场、标的、请求窗口、实际 source/endpoint、观测时间、行数/实际日期、输入摘要校验和、失败/超时/缺凭证状态；不输出 key、配置内容或原始异常。逐项超时与用户取消贯通 HTTP/Python。此脚本验证固定窗口可取数，不推定实时性、全市场权限、复权正确性或无缺交易日；失败项保留，整体非零退出，不宣称矩阵已通过。

矩阵已由 `scripts/check-data-providers.ts` 执行：000001.SZ 与 000300.SH 成功，US 返回 401/402、HK 返回 401、基金 NAV 上游失败，整体退出 1。详见 [固定窗口记录](./data-validation.md#真实服务矩阵)。没有发送模型、账户或订单请求，未将局部成功计为完整 F08/F21 完成。

## R02 第八阶段：Overview 刷新模块与观测

R02 第八阶段实施契约：Overview 的周期/手动刷新、超时、代次隔离、状态和观测由独立 runtime 服务拥有，AppRuntime 只转发入口与展示回调。每轮行情与组合共用最多 8 个活跃请求，按规范化市场/证券身份去重，只在本轮内共享公开数据；不建立账户或报价缓存。手动更新时合并后续请求并取消旧轮，旧结果不能发布；后台重复触发不另排一轮。取消/超时立即释放调用者，忽略不服从取消的旧 provider 晚到结果，后续轮读取最新配置/组合。成功、部分可用、无数据、刷新失败并保留旧值、超时分别可见；价格行保留完整身份、实际 source/as-of 和窗口回退标识，观测时间取完成时刻，不把日线称为实时。live 路径保留 provider attempts，全部鉴权/网络失败不再用无日期请求重试；仅空窗口允许明确标记的 latest-available。记录唯一请求的排队/拉取耗时、整轮取数/构建/发布耗时及结果计数，指标回调失败不影响数据发布。用真实 AppRuntime 入口、可控 provider 和渲染器验证去重/并发、失败状态、取消、迟到隔离及多尺寸展示；局部基线与终端 flush 的范围分开。

第八阶段（2026-09-14）已接入 `overview-refresh.ts`、`overview-data.ts` 与共享 QuoteObservation 契约。AppRuntime 保留原公开入口，纯面板组装留在 `overview.ts`；source live 返回窗口状态和 attempts。渲染保留交易所/基金后缀，新增逐行来源/日期、覆盖计数和失败状态；comfortable 密度的内容高度与实际行数一致，长来源/日期按可用字符宽度裁剪。

相对第七阶段新增 **10 项回归**：4 项共享池的并发/去重/身份/取消测试、4 项真实 runtime 入口及迟到/失败状态测试、1 项全鉴权失败不重复请求测试、1 项多尺寸显示测试。原 AppRuntime 的周期触发、失败恢复和退出取消测试继续通过；compact/comfortable 的 28/40/60 列渲染均核验。无需启动模型，也未读取真实账户。

`scripts/measure-overview-refresh.ts` 以真实 AppRuntime 入口运行每条件 10 次的成功、部分失败和超时测量，首选源与回退 adapter 均固定回环服务，行情缓存端口禁止调用。1/10/50 行组合成功 total p95 为 27.393/42.463/121.281 ms；50 行 timeout p95 为 32.241 ms，每轮仅 8 个在途请求，其余排队项取消。脚本与阶段定义见 [数据测量](./data-validation.md#appruntime-overview-基线)，不以合成结果证明真实上游或终端 flush 的性能。

最终回归：**810 pass / 0 fail，96 文件、6416 断言**，日志 `%TEMP%/whyj-r02-overview-final.log`；typecheck、architecture（0 baseline violations）、build（2638 modules）通过。测量脚本另行严格类型检查，comfortable 专项为 3 pass。没有重新调用失败的真实服务。

## R03 第一阶段：数据诊断的可用性证据

状态：共享诊断服务与 Doctor 入口已实现、验证；完整 F02 的市场配置面板和逐工具能力映射继续实施。

先以真实本地 HTTP 复现反例：Financial Datasets 返回 `200 { prices: [] }`，原 Doctor 仍为 pass。原 AKShare Data probe 只导入包，没有请求行情。已删除 Doctor 内重复的四套 provider 请求逻辑，改由 `runtime/data-readiness.ts` 复用现有 adapter，规范化和窗口检查通过且至少一行有效观察才返回 ready；不借用缓存、其他源或窗口外数据证明连接。

请求明确 source/market/symbol/start/end，默认使用兼容市场样本及最近 30 天。凭证/端点和配置在开始时固定，保存值优先于进程环境；诊断只读，不保存或回滚设置。Python 检查和行情请求复用同一解释器发现路径，异步检查包，区别 missing-python/missing-package。401、402/403、空数据、超时和取消分别返回类别和恢复动作；结果保留行数/as-of/观测时间及依赖版本，不输出原响应、凭证或取消原因。

Doctor 文本/JSON 显示实际数据样本；样本变化使旧 seed 失效，局部重跑不会扩大探测范围。runtime 取消传入 HTTP/Python，并停止后续阶段；不服从取消的 provider 晚到不能改写已返回结果。模型/数据可注入 probe 同样收到超时和取消信号。成功只证明所测日线/单位 NAV，工具注册、财报/新闻权限与全市场覆盖不随之升级为 ready。

新增 **10 项回归**：7 项共享服务、3 项 Doctor 实际入口，覆盖 HTTP 200 空/非法数据、401/402/403/503、保存凭证/端点优先级、缺依赖、无回退、错误窗口/身份、迟到隔离、取消、只读快照和 seed 失效。真实 AKShare 检查另行执行：Python 3.14.3、AKShare 1.18.63，000001.SZ / 2025-01-06–17 取得 10 行，耗时 4400.552 ms；结果为 [data-readiness-akshare.json](../output/data-readiness-akshare.json)，观测时间 `2026-09-14T00:18:22.882Z`。没有模型、账户或订单调用；原 US/HK/基金失败矩阵不被这一个成功样本覆盖。

工程回归：**820 pass / 0 fail，98 文件、6500 断言**，日志 `%TEMP%/whyj-r03-data-readiness-final.log`；typecheck、architecture（0 baseline violations）、build（2639 modules）通过。F02 仍未完成：市场/源/凭证草稿、验证后保存和面板关闭取消还要组成完整交互；现有 Doctor 外层 Save & Verify 的保存顺序尚未改为新流程。

收尾检查：构建产物 `dist/index.js --help` 退出 0；三个独立测量/验收脚本严格类型检查通过；九份更新文档的 106 个本地链接/Markdown 锚点无缺失，`git diff --check` 通过。测试进程、回环服务和测量任务均已结束。

## R03 第二阶段：验证后保存与面板生命周期

2026-09-14 已接通 `Settings → Market Data / Data Token` 和 `Doctor → Configure → Market Data`。共享 Data connection 按市场列兼容源和依赖，编辑凭证/端点/标的/日期；Check data 只验证当前草稿，成功后显式 Save verified 才保存。新 `runtime/data-settings.ts` 管理草稿、有效环境连接绑定与取消；`tui/src/data-settings-panel.ts` 管理按键、焦点和脱敏展示，父 PanelController 经既有存储端口执行 CAS 保存。

移除两条绕过验证的旧路径：Settings 不再按一下 Source/提交 Token 就落盘，Doctor 外层不再先保存数据再验证。模型编辑器保留原有独立 Save/Save & Verify 行为；外层 Run diagnostics 检查已保存设置。市场/源/凭证/端点/样本任一编辑使成功证据失效，有效环境凭证或端点变化也需重检。失败、取消、外部版本冲突不覆盖原设置，遇锁可保留已验证草稿重试；取消后不能通过另一个设置开关偷带未保存凭证。

检查完成通过回调主动重绘，不依赖其他活动动画。Esc 先取消数据检查，第二次退出草稿；关闭/替换父面板或停止 TUI 同样取消。AppRuntime 持有每轮 Doctor 的 AbortController，经 CommandContext/handler 传入已有检查服务；关闭、进入 Configure 或新一轮诊断会取消旧轮，旧进度和结果不能重新打开面板或覆盖新结果。

新增 12 项行为回归：5 项草稿/环境/证据绑定、4 项数据面板、3 项 AppRuntime/Doctor 生命周期；更新原 Settings/Doctor 和持久化冲突测试以走新流程。真实回环 HTTP 证明 401/403/空数据/503 不保存、有效样本仅在显式保存时写入，等待响应时关闭和重试可立即完成。60×20、80×24、120×32 验证焦点滚动、依赖失败、光标移动及密钥遮蔽；另人工检查 60×20 的 frame-buffer 输出。没有发送真实模型/行情账户请求。

最终验收：**832 pass / 0 fail，101 文件、6829 断言**，日志 `%TEMP%/whyj-r03-data-settings-final.log`；typecheck、architecture（0 baseline violations）、build（2641 modules / 5.81 MB）、构建产物 `--help` 与 `git diff --check` 通过。7 份现行文档的 78 个本地链接/锚点有效。测试进程与回环 HTTP 服务均结束。

本阶段仍不提升完整 F02：逐工具能力清单、所需数据权限和探测映射尚缺；单个日线/单位 NAV 样本成功不能证明财报、新闻等能力可用。下一步补齐这部分并与 F24 注册表统一，不以测试数代替完整 PRD 验收。

## R03 第三阶段：逐工具能力与取消链

2026-09-14，95 个工具的名称、schema、display、领域和 requirements 从实际注册表投影，包含市场、路由、凭证、Python 依赖、所需端点及副作用。Doctor Tools 不再只看首选日线源：只要注册了 AKShare 工具，就检查解释器/包，并明确此阶段未验证每个端点的权限。只读能力列表可从 Data connection 或 Doctor 的 v 打开，搜索名称并查看完整要求。

修正 `search_symbols` 的显示 provider 和调用契约：实际为 Tushare stock_basic，仅 A 股；保存凭证优先于环境，权限失败不再变成“未找到”。所有 88 data 工具都能在参数处理/I/O 前响应取消；基金/指数 endpoint 和合并/回退链传递 signal，取消后不接受晚到值或继续下一端点。Sina 是指数报价的首条 HTTP 路由，缺 Python 只阻断 AKShare 路由；此阶段未改写历史 quote payload 的 source 标记，F08 的来源核验继续进行。

新增 12 项回归，覆盖真实 registry/schema 投影、依赖、限域样本、全部 data 工具预取消、合并中取消、回环 HTTP 搜索及多尺寸能力列表。最终 **844 pass / 0 fail，105 文件、7627 断言**，日志 `%TEMP%/whyj-r03-capabilities-full.log`。不将注册数视为已获权限数。

## R03 第四阶段：端点探测与 F02 验收

新增 `runtime/tool-probe.ts` 和 `tool-probe-draft.ts`：从选定工具的声明枚举兼容路由，固定配置/参数快照，只调用指定 source adapter。具名 AKShare 基金 endpoint 参数直接复用工具 schema，不接受输出过滤参数或凭证字段；通用指数沿用已有白名单/kwargs。Tushare 搜索、Sina 指数、具名基金/指数和已有日线样本路径分别检查，不执行计算、shell、缓存或研究写入。

Data connection / Doctor 的 Tool capabilities 详情按 p 打开 Endpoint check，选择端点、编辑 JSON 参数，再显式检查；有成功、缺输入、空响应、依赖/鉴权/权限失败、超时和取消状态。检查结果带端点/参数、非空行数和观测时刻，只限本次响应；不承诺字段语义、实时性或其他权限。父面板替换/关闭取消在途请求，迟到结果隔离；修改参数或有效连接使旧证据失效。端点结果不长期保存，也不替代日线草稿验证后的 Save verified。

CLI 入口为 `/doctor --tool …`，实际 one-shot JSON 在失败时保留 `data.status`，返回非零退出码；这和三阶段 Doctor 的“报告已生成”返回约定分开。独立子进程验证 403/空响应/成功、凭证脱敏和检查前后文件内容不变；普通 CLI 初始化生成的目录/内置 insight 先作为基线，不误归为探测写入。工具和 UI 的新增测试不依赖真实模型或账户。

| F02 原验收条件 | 证据 |
|---|---|
| 市场/对象 → 兼容源与依赖 → 凭证/端点 | `runtime/data-settings.test.ts`、`tui/test/data-settings-panel.test.ts`，覆盖 A/US/HK/Fund 与无 key 的 AKShare |
| 小范围数据检查、有效数据与失败分类 | `runtime/data-readiness.test.ts`、`cli/doctor-data.test.ts`；原 HTTP 200 空响应反例、Python/package 缺失、401/402/403、空数据、超时和取消 |
| 能力要求与所需权限分别可见 | `runtime/tool-readiness.test.ts`、`cli/doctor-tools.test.ts`；实际 95 工具 schema/metadata 与日线、搜索、指数/基金端点分开 |
| 所选端点实际探测 | `runtime/tool-probe.test.ts`、`cli/tool-probe-entry.test.ts`；真实 HTTP 与实际 CLI 子进程，schema、空行、权限、失败 JSON、无探测写入 |
| 失败/取消保留已有设置，成功后才保存 | `runtime/data-settings.test.ts`、`tui/test/settings-conflict.test.ts`；有效连接绑定、CAS 冲突、异步取消及成功后显式 Save verified |
| CLI/TUI 入口与多尺寸生命周期 | `tui/test/tool-capabilities-panel.test.ts`、`app-doctor.test.ts`；60×20/80×24/120×32、草稿与 Doctor 两个入口、父面板替换、实际 runtime 取消 |

真实服务证据：已有 [A 股日线样本](../output/data-readiness-akshare.json) 为 000001.SZ / 2025-01-06–17 的 10 行有效数据。本阶段真实 CLI 检查 [基金端点结果](../output/tool-probe-akshare.json)：`fund_open_fund_info_em`，symbol=270042、indicator=单位净值走势，返回 3391 个非空行，耗时 2410.679 ms，观测时间 `2026-09-14T02:12:26.445Z`，Python 3.14.3 / AKShare 1.18.63。这里只记录响应访问，不将它当作全部 NAV 的财务核验或全市场连通性证明。

本阶段新增 11 项行为回归。F02 的配置/诊断闭环已逐条件核验；F24 的按任务工具/skills 装配与效果评测仍未完成。完整目标继续推进，不替换成工具数量或测试通过率目标。

最终工程验收：**855 pass / 0 fail，107 文件、8031 断言**，日志 `%TEMP%/whyj-r03-endpoint-probes-final.log`；typecheck、architecture（0 baseline violations）、build（2648 modules / 5.84 MB）通过。构建产物 `--help` 退出 0；端点缺参数返回 `ok: false`、`data.status: invalid-input` 和退出码 1。原有模型、存储、数值和报告回归均保留，测试进程与回环服务已退出。修复了失败 one-shot JSON 丢失 data 的问题；新增界面 fixture 隔离旧测试的全局 mock，不以受污染的 mock 结果作为入口证明。

## R04 第一阶段：共享主题与行情语义

2026-09-14，共享主题按 DESIGN 统一为金色 #D4AF37，焦点 #E2BE4D；TUI 与 HTML 采用相同品牌层级。新增 Market Colors：默认红涨绿跌，可选绿涨红跌；混合市场按工作区统一约定显示。选择立即重绘缓存表格和 Overview，不重新拉行情；CAS 冲突时保留原配色。

行情 up/down 与风险/评分/命令 positive/negative 分离；回撤和 VaR 的金额不因正负记法或市场约定变成“利好”。显示精度下零变化、NaN/N/A、单一观察无比较基准、平 K、零 MACD 和均线使用中性语义。K 线读取报告 CSS 变量；模板展示约定图例，生成入口捕获保存选择，历史版本字节不改写。TUI 和 HTML 共享 metric-semantics，表格同时支持列标题与 key/value 行标签，缺失行不会让其他数值失去语义。

新增 10 项回归，包括真实 TUI 按键/重绘、60×20/80×24/120×40 设置、混合市场、冲突与报告历史保留。HTML 脚本在 VM 中检查实际生成的 ECharts option（含平 K、成交量、MACD）；这不是实际浏览器/ECharts 引擎视觉验收。该阶段完整 **865 pass / 0 fail，109 文件、8216 断言**，日志 `%TEMP%/whyj-r04-market-colors-final.log`。

浏览器连接返回 `nodeRepl.fetch request failed`，未完成真实视觉预览；只创建了合成数据 HTML，随后已停止本地预览服务器。F04/F06 保留部分完成，尚须逐面板与真实图表对照，不用 VM 或颜色断言代替视觉检查。

## R04 第二阶段：模型性能与 HUD

新增 `runtime/model-benchmark.ts` 与 `scripts/measure-model.ts`，入口 `bun run bench:model`。同一份固定 system/user 输入逐次发送真实 Pi 请求；记录 provider/model、requested/effective thinking、输入、工具声明开关/schema hash、输出限制、样本/预热次数、时间、Pi/Bun 版本与实际端点 hash。默认无工具，quant-schema 模式仅携带真实量化 schema，不执行工具；无会话/行情写入。

报告逐样本保留成功、空响应、缺认证、请求失败、超时和取消，预热分开记录；TTFT/TPOT 分别统计有效成功样本的 nearest-rank p50/p95。空 block start 不算首 token；Pi partial 是共享可变对象，不能用其中后来到达的文本倒推早先 start 时刻。单 token、缺 usage、仅最终消息及未测时段保留 null，不填 0。统计仅是应用侧模型请求观测，不是供应商纯推理指标或完整量化任务耗时。

HUD 使用相同首输出/TPOT 口径，按当前会话连接聚合成功响应；工具后的后续模型请求单独计时。清空、成功恢复/压缩同步及连接切换清除旧值，失败恢复和普通外观切换保留原值；运行中保存连接不混入当前请求，下一次 prompt/显式 skill 开始时重置。Settings 增加 full/context/off 的 Status HUD，以及校验窗口范围、支持 auto 的 Compact At；立即保存、冲突保留和重启恢复通过。

新增 13 项行为回归，另修正旧 HUD 用空 start 表示已输出的 fixture。验证包含真实 Pi SSE + 本地 HTTP、独立 CLI 子进程、取消/超时、warmup/失败统计、旧配置只读、输出拒绝覆盖、HUD 恢复与运行中切换、多尺寸按键与保存冲突。原有 session 自动压缩阈值测试继续保留。

| F03 原验收条件 | 当前证据 |
|---|---|
| 连接配置后独立性能测试 | `bench:model` 实际脚本入口、help 和退出码，复用 model-config/kernel；见 model-benchmark.test.ts |
| 固定输入/模型/thinking/工具开关/样本/时间 | 报告 config/results、schema/endpoint hash、requested/effective thinking 与只读快照 |
| 成功/失败与 TTFT/TPOT 样本口径/分位数 | 人工 nearest-rank 样例、SSE/usage fixture、失败/取消/跳过/预热及 null 边界 |
| 当前会话模型/上下文/延迟与恢复隔离 | app-hud.test.ts 的四项 AppRuntime 行为回归，以及现有真实 session 恢复测试 |
| 上下文阈值与显示设置入口 | hud-settings.test.ts、panel-service.test.ts，现有 session 自动压缩测试；60×20/80×24/120×32 |

真实连接于 `2026-09-14T03:32:25.987Z` 到 `03:32:58.797Z` 完成 5 个样本：zai-coding-cn / glm-5.3-flash，工具 off，maxTokens 1024，无 warmup，**5 成功 / 0 失败**。请求 thinking off，经 Pi 能力约束为 low；不能将其标为无 thinking 基准。原始结果：[最终模型基准](../output/model-benchmark-2026-09-14-r04-final.json)。

| 指标 | 有效样本 | p50 | p95 |
|---|---:|---:|---:|
| TTFT | 5 | 1624.43 ms | 5982.85 ms |
| TPOT | 5 | 25.92 ms/token | 30.64 ms/token |
| 单次总耗时 | 5 | 5087.27 ms | 10426.57 ms |

这是本机/当前连接/该固定问题的基线，5 样本 p95 等于最大值。首轮采样另保留为 model-benchmark-2026-09-14-r04.json，最终口径以以上文件为准；未以两次采样差异宣布优化效果。详细运行及统计边界见 [模型性能测试](./model-performance.md)。

最终工程验收：**878 pass / 0 fail，112 文件、8312 断言**，日志 `%TEMP%/whyj-r04-final.log`。typecheck、独立测量脚本的严格类型检查、architecture（0 baseline violations）、build（2650 modules / 5.85 MB）、构建产物 `--help`、`git diff --check` 通过；9 份更新文档的本地路径/锚点检查无缺失。首轮全量测试有一条旧 CLI 子进程检查超过默认 5 秒；该项单独复核通过，最终全量也通过，未修改其超时或断言。测试与真实基准进程均已退出。F03 的本地功能范围完成；F04/F06 的真实视觉检查仍未完成。

## R05：观察组合编辑与比较

2026-09-14，新四个 Agent 工具已接入实际 registry、显示标签、能力声明及 prompt：`list_portfolios`、`edit_portfolio`、`compare_portfolios`、`portfolio_comparisons`。十个 slash 命令保持不变，旧 compare handler 不作为新入口。

纯计算在 `quant/portfolio-comparison.ts`，请求快照、并发取数和恢复在 `runtime/portfolio-comparison.ts`，FX 在独立 source adapter，文件生命周期在 storage。编辑操作携带所见 revision，锁内再校验，返回 before/after；稳定组 ID 优先于名称。比较捕获当前组/设置，不改写观察配置；相同标的只取一次，最多并发四个请求，取消停止排队/传递至上游，不发布取消后的结果。

每个成员与基准必须明确报价币种，记录为研究假设，不按交易所猜测。先对齐公开收盘/NAV 与同日 FX，再计算共同期间收益；不填补缺失汇率。缺成员默认失败，显式 exclude 才剔除并重新归一化权重；基准缺失、全组空、FX 缺失和 provider 异常不生成伪收益。买入持有与共同估值日再平衡分别计算，保留原始组、归一化权重、共同/剔除日期、成员本币/基准币收益、来源、时间与风险。

比较使用初值 1、碎份额和零费用假设；CAGR 按日历跨度，风险按共同观测期间近似年化，VaR 不必然是一日 VaR。股票复权/基金分红与跨市场同步成交不由此保证。ECB 汇率经 Frankfurter v2 获取，固定 provider，适配层将 API 的 quote/base 取倒数保存为 base/quote；参考 [官方说明](https://frankfurter.dev/) 与 [OpenAPI](https://api.frankfurter.dev/v2/openapi.json)。

不可变 UUID 制品保存在 `benchmark/comparisons/portfolios`，含完整价格/FX 输入及既有 Bars/NAV 引用。原子写入/哈希检测损坏，加载时再重算全部输出，重新计算哈希但篡改指标仍会失败；损坏文件保留并计数。历史重算使用记录输入，不依赖当前缓存。该一致性检查不是外部数据真实性证明。

| F10 原验收条件 | 当前证据 |
|---|---|
| 选两组、日期、基准、权重，入口可达 | 实际四工具 registry/schema，`portfolio-tools.test.ts` 经创建/加标的/比较/历史加载的完整工具链 |
| 自动补数据、来源/时点与共同日期 | 默认价格/NAV adapter、FX adapter；真实固定基金/指数样本，缺日与跨币种 fixture |
| 人工双标的收益/风险与两种方法 | A `[100,200,100]`、B `[100,50,100]` 初始等权：持有 0%/-20% 回撤，再平衡 56.25%；独立计算样本方差/Sharpe/CAGR |
| 币种、FX 缺失、本币/基准币差异 | 本币价格不变、FX 7→8.4 得到本币 0%/基准币 +20%；缺同日剔除，缺整对失败，真实 USD/HKD 参考率成功 |
| 可审阅编辑和只读比较 | before/after、版本冲突、ID/名称碰撞、取消；比较前后观察文件逐字节一致 |
| 空组/缺失/失败/取消 | 空组、基准缺失、非重叠日期、显式剔除、非法价格、权重和数值范围；在途取消与兄弟请求取消，无结果落盘 |
| 保存/展示与恢复 | 工具文本含收益/风险/权重/日期/来源；UUID 列表、输入重算、路径穿越拒绝、损坏及伪造结果保留/拒绝 |

新增 23 项回归。首轮 FX 回环服务测试被本机代理转发成 502，按现有测试约定仅在该测试文件生命周期设置 localhost NO_PROXY，恢复后重跑通过；生产网络配置未改变。

真实 smoke：`scripts/check-portfolio-comparison.ts` 使用独立临时工作区，两组公开基金 270042.OF/110022.OF，对比 000300.SH，固定 2025-01-06–17、显式 CNY 假设，取得 10 个共同估值日。另请求 2025-01-06–10 的 USD/HKD 对 CNY 汇率 10 条。运行约 9992.656 ms，观测时间 `2026-09-14T04:07:12.035Z`，结果 [portfolio-comparison-2026-09-14-r05.json](../output/portfolio-comparison-2026-09-14-r05.json)。组文件未改，保存结果重算一致；临时工作区已清理，完整输入保存在输出 JSON。真实部分不覆盖跨币种组合、全部市场或模型选工具成功率，没有模型、账户或订单调用。

最终工程验收：**901 pass / 0 fail，116 文件、8492 断言**，日志 `%TEMP%/whyj-r05-final.log`。typecheck、独立 smoke 脚本严格类型检查、architecture（0 baseline violations）、build（2655 modules / 5.89 MB）、构建产物与 smoke 脚本的 `--help` 通过。9 份文档的 155 个本地路径/锚点、仓库原配置下的 `git diff --check` 及 13 个新增文件的行尾空白检查通过；测试与真实 smoke 进程已结束。F10 本地工具闭环完成；专门比较图表、报告结果绑定/分享与完整终端连续任务仍在 F05/F21 验收，不能把文本转录算作已核验报告卡片。

## R05 第二阶段：组合报告绑定与分享

2026-09-14，新比较保存原始组选择、日期、币种与权重假设；空权重槽固定为 null，工具返回和 JSON 归档可稳定往返。`research-comparison.ts` 依次核对唯一且顺序正确的调用、UUID 比较归档、原始请求、价格/NAV 引用及观测时间、FX 来源/范围和重算结果。历史工具按 ID 也可生成卡片；列出历史不会被误当作比较结果。旧比较缺原始请求时计为未支持，独立历史重算继续可用。

FX 保存在比较归档中，没有独立 FX DatasetRef；比较哈希检测归档损坏，报告来源 entry 哈希固定当次工具参数/结果。价格另按 Bars/NAV revision 校验，不能仅改价格并重新计算比较哈希就通过。该链路证明记录和计算一致，不证明供应商真实性、历史当时可得性或实际成交。

`research-comparison-renderer.ts` 展示同一日历轴上的 A/B/基准三条单位曲线、收益/风险表、假设权重和本币/基准币收益、缺失成员/日期与 FX 明细。分享 DTO 不接受任意原始字段：匿名 Portfolio A/B，排除自定义组名、组 ID、观察配置版本、原始请求、私密 sentinel 和任意缺失原因。表格与窄屏图表有可聚焦的滚动区域；静态 SVG/Raw 无外部资源。完整报告仍保存原始研究轨迹。

新增 **9 项报告回归**，经真实工具入口、实际归档、JSONL、生成器与保存版本验证：跨币种与同币种、显式权重、基金 NAV、空成员排除和同日 FX 缺失；调用/结果重复或错序、参数/指标/价格/FX/来源改动；重算哈希后的不一致、比较/价格归档缺失、缓存/组修改及旧请求。已保存分享字节固定，新生成报告缺证据时排除比较卡片。人工样例再平衡加 FX `[7,7.7,8.4]` 的末值为 `[1.875,1.2,1.452]`；同币种 70%/30% 配置末值独立为 `1.55 × 0.95 = 1.4725`。

合成样例脚本：[check-portfolio-report.ts](../scripts/check-portfolio-report.ts)。2026-09-14T04:33:18.788Z 的 [验证记录](../output/portfolio-report-2026-09-14-r05/evidence.json)、[完整报告](../output/portfolio-report-2026-09-14-r05/report.html) 与 [分享预览](../output/portfolio-report-2026-09-14-r05/share.html) 已生成，3 份输入归档通过，临时数据已清理。价格/FX 均为人工值，provider 标签用于测试契约；预览文件额外标明 synthetic，生产下载仍使用原报告内嵌的固定字节。本轮没有真实 provider、模型或账户调用。

浏览器尝试打开本地样例后，状态读取和重置重连均返回 `nodeRepl.fetch request failed`，没有得到可核验页面。因此新比较页面的宽屏/窄屏、键盘、下载与离线视觉仍未完成，不沿用前六类报告的旧浏览器成绩。

最终工程验收：**910 pass / 0 fail，117 文件、8579 断言**，日志 `%TEMP%/whyj-r05-report-final.log`；typecheck、architecture（0 baseline violations）、build（2657 modules / 5.90 MB）、独立样例脚本严格类型检查与 `--help` 通过。F05/F21 的报告实现前进，但完整连续任务、真实视觉和整体数据及时性尚未通过，保持部分完成。

收尾复核将组合 B/基准曲线绑定报告 ink/muted token，打印覆盖为深色，避免浅色页面使用固定白线。随后报告/配色专项 **13 pass / 0 fail、146 断言**，重新构建并生成 [最终样例](../output/portfolio-report-2026-09-14-r05-final/share.html) 与 [记录](../output/portfolio-report-2026-09-14-r05-final/evidence.json)。8 份文档的本地路径/锚点及 `git diff --check` 通过；测试进程和隔离预览服务均已退出。配色代码检查不替代未完成的浏览器视觉验收。

## R06 第一阶段：分支研究状态与证据恢复

2026-09-14，八个 Artifact 核验模块迁至 `src/research/`：input、analysis、fund、dashboard、comparison、references、match、types；历史记录中的 `research-*.ts` 指当时路径。报告和会话共用归档校验与计算绑定，新增 call/result entry ID 映射独立于公开 analysis DTO，架构 gate 禁止反向依赖和调用实时 provider。

`research/state.ts` 投影当前分支原始用户文本、参数、组版本/权重、引用、核验发现、报告引用和未完成调用；`QuantAgentSession.getResearchState()` 暴露完整状态，每次 Pi 请求注入带明确省略计数的精简版。组合管理只记为 recorded，工具结束或助手声称完成不升级整个任务。归档缺失撤销核验发现，保留原范围与原因，不替换为最新行情。正式 ResearchTask 验收声明、重试与待办解决关系继续实施。

新增 **14 项回归**：11 项投影/归档测试，3 项真实 Pi + JSONL + 本地 HTTP/SSE 恢复测试。人工回测按 `139/102` 校核；有损 compaction 确实从模型消息中去掉了原比较，下一轮请求仍含原组 revision、70%/30% 权重、SPY 基准、固定报告引用和未返回的风险调用。另验调用重复/错序、改写结果、缓存修订/归档丢失、DCA 费率单位、组合编辑前后版本、明确截断、取消摘要、失败 resume、空分支与切回、reset；原多 Agent 隔离继续通过。修正 facade 默认 displayText，避免恢复时把增强提示误认作用户原文。

工程验证：**924 pass / 0 fail，119 文件、8649 断言**，日志 `%TEMP%/whyj-r06-research-full.log`，用时 63.13 秒；typecheck、architecture（0 baseline violations）、build（2658 modules / 5.91 MB）通过。全部新增数据/HTTP 为隔离 fixture，没有真实模型、行情或账户调用。详细契约与复跑命令见 [研究状态与恢复](./research-state.md)。字段/请求保留测试不等于自然语言任务成功率，F18–F20 保持部分完成。

收尾：10 份更新文档的 170 个本地路径/锚点、原配置下的 `git diff --check` 与新增/迁移文件的行尾空白检查通过。测试进程已退出，本地 HTTP 服务和临时数据按 fixture 生命周期清理。

## R06 第二阶段：Session 端口与 F19 验收

2026-09-14，`QuantAgentDependencies` 接收完整模型连接、工具、skills、session repo、执行环境、prompt 与研究核验端口。默认 settings/发现/存储绑定迁至 `session-dependencies.ts`；`session.ts` 只消费端口和分支快照，新增 gate 禁止 facade 直接导入 storage/tools/source/tui，没有新增 baseline 例外。`applySessionContextState` 消费已解析模型状态，默认遗留恢复策略归连接组装所有。

工具描述/schema、模型与 skills 复制后消费；重复名称失败可见。恢复的活动工具与注入集合取交集，空集合不回退到内置工具，system prompt 与实际请求使用同一活动集合。运行中的工具循环及排队续问保持原模型/端点/凭证，后续独立请求才切换；默认配置及环境变量也在连接创建时捕获，延迟鉴权不混用新 key。

报告来源准备阶段失败的故障注入曾复现 leaf 从 `entry-4` 提前退回 `entry-2`。现先校验原记录并准备目标分支、skills、prompt、证据和模型，再提交 leaf 移动及状态替换；相同来源 session 的准备失败保留原 leaf 和全部 entries，成功恢复仍回到记录分支。该失败保留不是通过放宽断言实现。

| F19 原验收条件 | 当前证据与量化意义 |
|---|---|
| 会话模型、工具、skills、repo 注入 | [9 项注入回归](../src/agent/test/session-dependencies.test.ts)：真实 Pi/本地 HTTP，显式 `[1,2,9]` 均值为 4；独立内存 repo、skill 内容和模型连接替换，不修改 TUI |
| context 消费 snapshot | 工具/schema/skills 返回值修改隔离，运行中连接及默认环境快照；R06 第一阶段的完整分支研究参数/证据恢复继续回归 |
| Artifact load/normalize/derive/render 分开验证 | [4 项阶段测试](../src/artifact/test/report-pipeline.test.ts)：删除源文件不改变加载快照；注入乱序/多余字段观察；仅凭数据/参数核验人工动量值；仅凭序列化 DTO 渲染，无需 Agent 或完整生成器 |
| 模块迁移有具体研究收益 | 新增工具通过端口调用；Session/报告共用 research 核验器，替换归档 resolver 不改研究字段；缺档仍明确缺证据，不替换当前行情 |
| 架构 gate 与失败语义 | 0 baseline violations；空活动工具、重复名、加载/打开/证据失败、工具/鉴权取消、压缩/导航/恢复可继续使用 |

13 项新增测试仅使用隔离 TEMP、内存 repo、本地 HTTP/SSE 和人工观察，无真实模型、行情或账户调用。接口、接入示例与复跑命令见 [Session 依赖注入](./session-dependencies.md)。F19 的本地边界验收不扩展为可选 npm 包、Pi 扩展宿主、真实模型质量或完整 UI 研究任务完成；F18/F20 继续按原条件实施。

最终工程验证：**937 pass / 0 fail，121 文件、8727 断言**，日志 `%TEMP%/whyj-r06-injection-audit.log`，用时 61.82 秒；typecheck、architecture（0 baseline violations）、build（2659 modules / 5.92 MB）通过。前置全量 933 项后补入 4 项报告阶段测试，最终全量覆盖全部新增用例。F19 按上表完成本地范围验收。

收尾：11 份更新文档的 181 个本地路径/锚点、7 个新增源文件/文档的行尾空白、PRD 状态计数和原配置下 `git diff --check` 通过。测试与构建进程均已退出，隔离 HTTP 服务及临时数据随 fixture 清理。

## R06 第三阶段：结构化任务、验收与待办关联

2026-09-14，`types/research-task.ts` 定义声明/条件/版本/事件，`research/tasks.ts` 从分支重建 task 与 taskErrors；`runtime/quant-harness.ts` 提供 run/update/getState 和创建带范围守卫的 Agent。AppRuntime 默认使用新工厂，新增结构化宿主入口 submitResearch；普通聊天自动声明、任务审阅面板和更完整任务集尚未接入，F18/F20 保持部分完成。

任务固定原始 request、目标、对象/市场/日期、可选基准/组合版本、能力集合、输入引用和必需指标。只有任务开始后的匹配调用、核验结果及窗口/版本可满足条件；同对象的必需结果出现不同版本时不完成。数据权限与任意自然语言约束不由 allowedTools 代替，notes 只作为说明。显式任务范围覆盖旧最近对象提示，避免新任务沿用旧日期。

declare/resolve/cancel 追加在原 session 的 research_task note 中，没有第二份状态文件。修订携带已审阅 event ID；失败验证不追加新声明。显式 resolve 连接更晚的同工具/同参数核验结果，原失败保留；目标归档丢失或声明改变后关联失效、待办重新出现，事件 revision 仍保留。报告要求检查来源父链/哈希中包含当前任务 revision 与全部必需结果；固定 reportRef 的当前可打开性仍由 Artifact 服务另验。

新增 **14 项测试**：6 项真实归档/纯投影，8 项真实 Pi/JSONL/本地 HTTP runtime。固定回测人工末值 `139/102`；同一任务通过 headless 与 AppRuntime 回调/报告链，验证工具前范围拦截、缺能力/指标/版本、失败重试、过时声明、取消、输入对象修改、报告来源和任务范围隔离。有损恢复主动让 buildContext 丢掉原任务说明，重新打开后 state 与下一次请求恢复原条件；回到中断 leaf 重新显示未完成。

准备阶段取消的故障注入曾在预期 0 次模型请求时观察到 1 次。现将 signal 传入 Session prompt，并在等待初始化、连接刷新、自动压缩、上下文组装和正式请求边界检查；取消在底层操作开始前到达时不再发出迟到请求。输入 task 在异步开始前复制，避免声明与实际用户请求被调用方后续修改拆开。

接口与复跑方式见 [结构化研究任务](./research-tasks.md)。全部新增数据与模型响应为隔离 fixture，没有真实模型、行情或账户调用；不把一个固定 AppRuntime 用例当作完整键盘界面或真实模型研究质量验收。

全量回归曾在八进程行情合并中捕获 Windows `mkdir snapshot.json.lock` 的 EPERM，一个 writer 退出。异步锁获取现仅对确切锁目录的 mkdir 访问冲突有限重试，接受取消，不重复锁内写入；其他错误保留。新增 4 项隔离子进程故障注入，覆盖瞬态恢复、持续失败、取消及非 mkdir 错误，原八进程读写测试继续通过。

第三阶段最终工程验证：**955 pass / 0 fail，124 文件、8831 断言**，日志 `%TEMP%/whyj-r06-task-storage-final.log`，用时 70.09 秒；typecheck、architecture（0 baseline violations）、build（2661 modules / 5.94 MB）通过。失败日志 `%TEMP%/whyj-r06-task-audit.log` 保留；新增合计 14 项任务测试和 4 项锁故障测试，没有放宽原并发断言。

## R06 第四阶段：普通任务输入与只读任务面板

2026-09-14，`research-task-tool.ts` 提供 read/declare/resolve/cancel，registry 按会话注入分支读口，默认 Quant runtime 在 99 个静态业务/系统工具之外绑定一个控制工具。普通 prompt 与 AppRuntime.submit 可声明和推进任务；模型通过实际工具文本读取请求 ID、revision、条件及操作引用。原文由宿主绑定实际用户输入，结构校验不代表模型已经完整理解用户目标。

成功 toolResult 是原子提交事件，未完成调用、失败结果、重复/乱序配对或被改写的原文不声明任务。没有工具内等待自身 idle 或额外排队写 note。取消后仍能读取或重新声明任务；匹配的失败重试保留原记录，有损压缩和重启后仍从原分支恢复条件。

`/resume --task` 增加本地只读查看参数，不增加一级 slash。runtime 取得分支投影，经回调交给独立 `research-task-panel.ts`；纯文本投影由 `research-task-view.ts` 共用。展示目标、条件、证据、失败、重试和报告引用；方向键滚动、Enter 刷新、Esc 关闭。查看期间不调用模型/行情、不写任务或切换 session，无活动会话时不猜测历史文件。

本阶段新增 **18 项测试**：9 项 runtime/命令、3 项事件来源、6 项面板。模型未结束请求时连续查看/刷新，实际验证请求数、分支和对话不变；面板覆盖 60×20、80×24、120×32 的中文换行/滚动/底部操作、改键、尺寸变化、关闭和切换清理。固定 SSE 测试证明工具链，不代表真实模型语义评测；渲染单元格测试不替代真实终端视觉验收。没有真实模型、市场或账户调用。

最终工程验证：**973 pass / 0 fail，127 文件、9938 断言**，日志 `%TEMP%/whyj-r06-task-panel-final.log`，用时 92.00 秒；typecheck、architecture（0 baseline violations）、build（2665 modules / 5.96 MB）通过。复跑方式见 [研究任务](./research-tasks.md)。F18/F20 保持部分完成，完整交互、跨对象和真实模型任务集继续验收。

## R06 第五阶段：跨对象研究与失败续问

2026-09-14，新增 [固定任务矩阵](./research-task-evaluation.md)：股票、指数、基金和观察组合分别经普通 headless/AppRuntime 输入、实际工具、归档核验、报告生成、有损压缩与重启。源层只替换 provider 传输，仍执行数据编排/缓存和不可变归档；Pi 使用本地固定 SSE。测试不调用真实模型、市场或账户，不证明自然语言理解准确率。

初次矩阵四类全部失败，揭示实际契约缺口：因子没有历史日期参数及任务参数投影；基金裸代码被归为股票；完整 NAV 历史被当作实际计算窗口；组合版本被错误要求出现在成员风险结果中；组合收益/回撤只有 series 内指标，无法指定逐组验收。现逐项修复，并使用核验器实际计算日期及带组限定的指标检查条件，完整归档的身份/版本/哈希核验仍保留。

两类数据失败反例另揭示错误仅以文本返回，研究状态把它归为未核验且丢失具体原因。`err` 现保留结构化 code/message，投影记为 failed；分析准备在无可用数据且供应商失败时保留来源诊断。空数据与失败均经同参数真实计算重试，成功后仍需显式关联，原失败不删。合法 stale-cache 路径继续保留。

新增 **9 项测试**：6 项矩阵（四类分别执行两种入口，另含两类失败续问）、2 项证据/身份回归、1 项非法因子日期。人工值包括 momentum `139/137 - 1`、基金本金收益 25%/TWR 50%、组合 A/B 收益 31%/-50%；窗口外价格 999 不进入计算。修改窗口、组版本、组顺序或使用含糊指标不能完成任务。收尾反例还确认非法基金代码可保留为 blocked 状态，不使状态恢复抛错。

最终工程验证：**982 pass / 0 fail，128 文件、10073 断言**，日志 `%TEMP%/whyj-r06-task-matrix-reviewed.log`，用时 83.63 秒。typecheck、architecture（0 baseline violations）、build（2665 modules / 5.96 MB）通过；测试 HTTP 服务、测试与构建进程均已结束。F12/F18/F20 保持部分完成，真实模型的条件选择、解释/失效依据与完整终端任务继续验收。

## 2026-09-15：F16 显式本地模拟盘

通用执行契约原只用内存合成 fixture 演示幂等责任；现增加 [宿主显式本地 paper 服务](../src/app/paper-execution/index.ts)，将私有账户、订单和完整成交保存在调用方选择的绝对目录。通用 `src/execution/` 不读取凭证、不持久化，也不向默认 Agent 或 CLI 注册下单入口。文件锁串行化资金/可卖数量预检、提交、查单、撤单和宿主注入的合成成交；账本原子替换，相同 ID/摘要跨进程和重启复用原订单，冲突摘要拒绝。合成买卖成交以精确十进制更新现金/持仓，部分成交撤单保留原明细；账本损坏失败关闭。

[六项专项测试](../src/app/paper-execution/test/paper-execution.test.ts) 含两个真实 Bun 进程同 ID 并发、重启查单/重复提交、资源争用、买卖部分成交与重复成交拒绝、损坏账本、live/day/IOC 隔离，36 次断言、0 失败。最终全量 **1650 pass / 0 fail，195 文件、21945 断言，176.66 秒**；typecheck、architecture（0 baseline violations）、build（3001 modules / 6.86 MB）通过。这里只证明本机纸面账本，不是券商官方 sandbox 或实际行情撮合；F16 仍部分完成，外部服务选择、账户授权和实盘验收见 [执行契约](./execution.md)。

## 2026-09-16：F16 显式私有 paper Agent

在既有本地文件终端与 durable paper 服务之外，新增[显式私有 Agent 入口](./execution.md#显式私有-paper-agent2026-09-16)。用户先选择并初始化应用状态目录外的账户，再用 `whyj paper agent --root ABS --account ID` 启动另一条 Agent；它只拥有 `paper_account` 与 `paper_order`，不继承默认研究工具、shell、skills 或自动报告。模型提交/撤单的完整 GTC 限价意图经终端独立输入通道按动作、ID 和哈希短语审核，网关在审核后重新预检，账本锁内再复核现金/可卖数量。纸面订单无自动成交；账户与订单上下文发送给配置模型，转录只写所选私有根目录下的 `agent-sessions/`。

四文件新增专项 **10/10、72 次断言**：模型自授权/账户切换、错哈希/动作/时效与资金不足均不派单；重新打开同账本可查单，撤单另需审核；真实 Pi localhost SSE 工具调用发出一笔经审阅的纸面单并核对私有转录目录；真实 source CLI 子进程能启动/退出，JSON、缺参数和缺账户失败。全量 **1716 pass / 0 fail、204 文件、22357 次断言、255.64 秒**，日志 `%TEMP%/whyj-paper-agent-full-2026-09-16.log`；typecheck、architecture（0 baseline violations）、test fence 和 build（3015 modules / 6.93 MB）通过。此证据不证明真实券商、外部 paper 服务、物理终端视觉或 live 授权；F16 仍部分完成。

## 2026-09-16：F16 Alpaca Paper 外部适配器

[固定 paper 适配器](../src/app/alpaca-paper/adapter.ts)、[跨进程私有意图日志](../src/app/alpaca-paper/journal.ts)与[显式 CLI](../src/runtime/alpaca-paper-command.ts)已接通。独立 paper key 只在该入口读取；提交前按完整意图绑定客户端订单号，断线后只查原 ID，预留但查不到时需要人工对账。账户、仓位和资产可交易状态在预检及派单前核对。成交按订单 ID 完整分页，官方缺少逐笔费用字段时 `fee: null`；本地账本仍拒绝未知费用。撤单 204 保持 requested，查到 broker 终态后才 resolved。假 HTTP 服务覆盖 active 但不可交易标的、101 笔成交跨页、断线/重启、冲突 ID、账户错配、外部先占用订单号及取消状态；未对用户账户调用 paper API，live 服务也未接入。完整测试与验收结果见[执行文档](./execution.md#alpaca-paper-外部适配器2026-09-16)；F16 保持部分完成。

四文件专项 **38/38、478 次断言**；完整回归 **1728/1728、206 文件、22717 次断言、269.08 秒**，日志 `%TEMP%/whyj-alpaca-paper-asset-full-2026-09-16.log`。typecheck、architecture（0 baseline violations）、test fence 与 build（3021 modules / 6.96 MB）通过；构建版 CLI 的 help 和缺凭证退出路径见[执行文档](./execution.md#alpaca-paper-外部适配器2026-09-16)。

## 2026-09-16：F23/F24 Breadth 精选技能的实际脚本与归档复核

[固定文件清单](../src/skill/breadth-manifest.ts)把 market-breadth-analyzer 的 15 个入口/资源/导入文件绑定到目录提交。生产 `--check` 现在与原 `--check-network` 分别核对文件与公开 CSV，单独网络成功不会把变动后的脚本放进模型索引。当前本地安装 HEAD 比旧 catalog pin 更新，真实生产查询为 blocked；没有修改安装 checkout。固定版本在隔离目录实际运行，通过[独立综合分数审计](../src/skill/breadth-report-audit.ts)及[离线归档复核](../src/skill/breadth-bundle.ts)，完整输入/报告/历史见[验证包](../output/breadth-script-bundle-2026-09-16.json)。具体范围、命令和仍缺的终端/组件解释见[技能依赖](./skill-readiness.md#2026-09-16breadth-固定脚本闭包与公开效果复核)；F23/F24 保持部分完成。

同会话刷新回归通过注入式“已核验文件”回执检验网络状态的激活和撤销；真实文件哈希仍由生产探测与独立文件测试覆盖。本阶段六文件专项 **31/31、215 次断言**；最终全量 **1741/1741、209 文件、22774 次断言、272.22 秒**，日志 `%TEMP%/ohq-breadth-full-reviewed-2026-09-16.log`。typecheck、architecture（0 baseline violations）、test fence、build（3024 modules / 6.96 MB）、离线归档复核、246 个本地文档链接与 `git diff --check` 均通过。

## 2026-09-16：F23/F24 宏观公开报告离线复核

[宏观固定脚本验证器](../scripts/check-macro-skill.ts)现保存公开执行的完整 JSON/Markdown 和哈希；[独立算术审计](../src/skill/macro-report-audit.ts)以固定六项权重重算综合分数与区间，[离线包复核](../src/skill/macro-bundle.ts)核对原字节、固定版本、文件清单和九只 ETF 的行数回执。真实固定脚本九 ETF 各得到 600 条、报告 **58.5/100**；算术和离线完整性通过，同时回执暴露 Markdown 错写 `FMP API (0 calls)` 而 JSON 是 `yfinance_only`，原文件及新路径复跑见[技能依赖](./skill-readiness.md#2026-09-16宏观公开报告的独立算术与离线复核)。未保存 ETF 原价，不据此验收六项指标的源公式、供应商历史修订或模型解释；F23/F24 保持部分完成。

两文件专项 **8/8、12 次断言**；最终全量 **1752/1752、211 文件、22826 次断言、260.60 秒**，日志 `%TEMP%/ohq-macro-presentation-final-2026-09-16.log`。根与脚本 strict typecheck、architecture（0 baseline violations）、test fence、build（3026 modules / 6.97 MB）、334 个本地文档路径和 `git diff --check` 通过。

## 2026-09-16：F23/F24 宏观当次价格输入审计

[输入捕获器](../scripts/capture-macro-inputs.py)在不修改固定技能源码的运行中保存主程序实际返回的九份 ETF 价格；[独立统计复核](../src/skill/macro-input-audit.ts)从原价格重建六组月末比值及 6/12 月均值、3/12 月变化与百分位。[完整归档](../output/macro-input-capture-2026-09-16.json)含九只各 600 条，六组输入审计无问题；[离线复核](../src/skill/macro-bundle.ts)再读同一字节通过，并保留上游 Markdown 的 FMP 来源标签冲突。范围、命令和剩余打分/历史来源缺口见[技能依赖](./skill-readiness.md#2026-09-16同次宏观价格输入与六组月末指标复核)；F23/F24 状态不变。

本阶段三文件专项 **11/11、22 次断言**；最终全量 **1755/1755、212 文件、22836 次断言、291.26 秒**，日志 `%TEMP%/ohq-macro-input-final-2026-09-16.log`。根与脚本 strict typecheck、Python 捕获器语法检查、architecture（0 baseline violations）、test fence、build（3026 modules / 6.97 MB）、新旧包离线复核、271 个本地文档路径及 `git diff --check` 通过。

## 2026-09-18：F23/F24 宏观报告审计进入终端

新增[只读技能报告审计](../src/skill/macro-audit-command.ts) 的双文件与固定验证包模式，CLI/TUI 共用 `/skill audit macro-regime-detector`。上游 Markdown 错写 FMP 来源时，算术与原价归档仍可分别重审，但人类可读报告不会得到通过回执；真实单次 `--json -c` 在坏设置下也返回带来源与警告的结构化失败。固定技能的模型索引和显式调用说明同步提示 JSON 来源与 SHY/TLT 代理。用法和验收范围见[技能依赖](./skill-readiness.md#2026-09-18终端宏观报告来源核验)；F23/F24 保持部分完成。

最终全量 `bun run test` **1761/1761、213 文件、22858 次断言、411.21 秒**，日志 `%TEMP%/ohq-macro-cli-audit-stable-2026-09-18.log`；专项覆盖错误来源、错误算术、坏设置及超限归档。typecheck、architecture（0 baseline violations）、build、324 个本地文档路径及 `git diff --check` 通过。

## 2026-09-18：F11 公开新闻正文读取优先级

[真实 AAPL 与港股研究](./news-research.md#2026-09-18真实公开新闻的正文额度选择)发现 Yahoo 把主要讨论其他公司的文章作为目标 ticker 候选置于前列，有限正文额度因此漏读标题明确标注目标代码的文章。研究链现优先读取标题含目标代码的候选，保留原新闻时间顺序、所有候选和公司关联未核实边界。AAPL 第二次公开运行取得 29 条返回、20 条入窗，限额两篇均读到 AAPL 标题正文；港股 `00700.HK` 的 `SEHK:700` 标题也优先读取，两个市场价格均有 AKShare 归档，无后续收盘时仍阻止方向性调整。模型语义与更广市场覆盖尚未验收，F11 保持部分完成。

最终全量 **1764/1764、214 文件、22865 次断言、393.74 秒**；typecheck、architecture、build、文档链接与 diff 检查通过。原始日志与公开样本摘要见[新闻研究](./news-research.md#2026-09-18真实公开新闻的正文额度选择)。

## 2026-09-18：F11 目标公司标题情绪收口

[新闻研究](./news-research.md#2026-09-18标题主体线索与目标情绪范围)现从精确代码报价取得供应商所称公司名，A 股东方财富新闻与代码/简称报价并行，后者超时或失败仍保留新闻；标题代码与名称用于有限正文额度排序和目标情绪范围。确定性反例证明其他公司的方向性标题仍可见，却不进入目标 tone 或调整文章证据，并要求主体复核。公开 AAPL、港股与 A 股贵州茅台运行分别取得 7/20、10/19、2/9 条目标标题线索；平安银行本窗口 0/6 条，保留 unknown。全文语义、校准与更多市场样本仍是 F11 缺口，状态保持部分完成。

本次最终全量 **1770/1770、214 文件、22897 次断言、508.53 秒**；typecheck、architecture、build、文档本地链接及 diff 检查通过。记录与可复现命令见[新闻研究](./news-research.md#2026-09-18标题主体线索与目标情绪范围)。

## 2026-09-16：F08/F21/F24 常用研究工具的观察截止

[三项常用研究工具](../src/tools/quant-tools.ts)保持当前自动取数，显式 `observed_before` 则要求市场和价格起止日，只读一份本应用旧观察归档。共享 [分析数据端口](../src/runtime/analysis-data.ts)阻断归档分支的当前 provider；替换当前数据端口的宿主缺归档端口会得到专门的 `DATA_ARCHIVE_PORT_UNAVAILABLE` 和注入提示。[报告验证](../src/research/observation-boundary.ts)重新核对截止/抓取时刻/修订并重算指标，[任务验收](../src/research/tasks.ts)区分当前与历史模式。[真实源/存储/工具合成反例](../src/storage/test/archived-analysis.test.ts)在旧修订之后保存不同价格，三工具仍取旧修订，损坏/缺档不回退，伪造观察时刻不进入报告。详情与复跑命令见[数据验证](./data-validation.md#2026-09-16常用研究工具的显式观察截止)；供应商历史发布、复权、交易日全集及整轮及时性仍缺，F08/F21/F24 保持部分完成。

本阶段最终全量 **1744/1744、209 文件、22814 次断言、268.10 秒**，日志 `%TEMP%/ohq-ordinary-asof-final-2026-09-16.log`；专项 11/11。typecheck、architecture（0 baseline violations）、test fence、build（3026 modules / 6.97 MB）及 `git diff --check` 通过。

## 后续特性

2026-09-19，F12/F20 的[组合回答证据核对](./research-task-evaluation.md#2026-09-19组合回答数值与当前比较证据)按当前任务已验收的比较调用绑定两组收益和回撤；明确错误数字在终端提示并暂停本轮自动报告，正确回答继续。真实模型的首轮 180 秒恢复超时已保留；300 秒独立复跑为 complete、研究/恢复正常结束、7/7 机械检查。最终规则对保存的两段原文离线复核及分别改错均已验证；三文件定向 **74/74**。仍需跨模型、真实价格与完整解释验收，F12/F20 保持部分完成。

2026-09-19，F04/F05 的[窄屏状态栏修正](./terminal-workflow-audit.md#窄屏状态栏字段完整性2026-09-19)让长模型 ID 以省略号收缩，后续指标、数据源和观察组仅在字段完整可显示时绘制。60×20/80×24/120×32 重新生成 54 帧 QuantTui/ANSI，浏览器抽查 60/80 列；定向 HUD 回归 67/67，全量 **1800/1800、220 文件、23103 次断言**。typecheck、architecture、build 通过；原生终端字体和输入法仍待检查，F04/F05/F06 状态不变。

2026-09-19，F23/F24 的[JSON 审计摘录](./skill-readiness.md#2026-09-19冲突原报告之外的-json-审计摘录)让 `/skill audit` 在原 Markdown 来源错误时仍给出可读的六项结构化数值；只有 JSON 算术或固定包核验通过才出现，不转述原报告投资指导。生产 CLI 对公开包返回六组件与 58.5 总分，同时保持 `humanReadablePassed=false` 和退出码 1。定向 **18/18、45 次断言**；F23/F24 保持部分完成。

本次全量 **1799/1799、220 文件、23091 次断言**，日志 `%TEMP%/ohq-macro-readable-summary-full-2026-09-19.log`；typecheck、test fence、architecture（0 baseline violations）与 build（3039 modules）通过。

2026-09-19，F23/F24 的[宏观报告 V2 展示审计](./skill-readiness.md#2026-09-19宏观报告可见数值与旧回执兼容)把 Markdown 六组件分数/权重、总分、信号数和质量与 JSON 逐行核对；旧验证包继续按 V1 回执验真，并显示新规则发现的问题。新公开捕获经固定 17 文件、九 ETF 各 600 行和原 Python 脚本，输入/评分审计为空、综合 58.5；离线完整性通过，原 Markdown 的 FMP 来源标题依旧错误。三文件定向 **18/18、41 次断言**，记录与复跑命令见技能依赖；F23/F24 仍部分完成。

最终全量 **1799/1799、220 文件、23087 次断言**，日志 `%TEMP%/ohq-macro-presentation-full-final-2026-09-19.log`；typecheck、test fence、architecture（0 baseline violations）、build（3038 modules）及捕获脚本独立 strict typecheck 通过。

2026-09-19，F05 的[空配置键盘连续任务](./terminal-workflow-audit.md#空配置的首次研究键盘路径2026-09-19)在 80×24/120×32 两种视口验证模型与数据的检查后保存、建组、Pi 比较、自动报告和恢复。测试发现新模型保存后 Doctor HUD 被旧 agent 状态覆盖；AppRuntime 现显示已保存的下次请求模型，连接变更时清除旧上下文/延迟，并在真实 Pi fixture 请求后保持正确。运行中修改连接的延迟指标回归也已通过；四文件定向 **53/53、226 次断言**。旧 Doctor 异常测试的全局模块 mock 曾让后续两条流程误收模拟失败，改为实例注入后按实际文件顺序复跑 **21/21**。传输和价格为本地 fixture，真实账号/供应商/原生终端仍待验收，F05 保持部分完成。

本阶段最终全量 **1796/1796、220 文件、23078 次断言**，日志 `%TEMP%/ohq-first-run-full-verified-2026-09-19.log`；typecheck、architecture（0 baseline violations）、build（3037 modules）和构建产物 `--help` 通过。

2026-09-19，F11 的[角色伪装改写评测](./news-evaluation.md#2026-09-19角色伪装网页指令与供应商元数据)新增中英伪系统消息与供应商 ID 注入；模型可见新闻投影隔离文字和引用，原始证据仍可检查。真实模型隔离合成单例 8/8、两阶段无标记复述，不能代替真实网页的广泛语义与情绪校准验收；F11 保持部分完成。

2026-09-19，F12 的因子工具、研究重算、系统提示、固定回答回归与 CLI 复核共用[历史分位证据边界](./research-task-evaluation.md#2026-09-19历史因子分位与均值回归证据边界)。最小窗口的前期统计不再伪装成 0；真实模型独立复测的合成股票任务为 7/7、`passed=true`，原始错误样本与首次否定句误报样本均未覆盖。其它市场、模型、真实行情和完整语义验收仍待进行，F12 保持部分完成。

2026-09-16，F12/F20 基金回答新增当前任务证据核对及 CLI 可见复核提示，验收条件、工具值与报告流程的界限见[基金回答评测](./research-task-evaluation.md#2026-09-16基金回答数值与当前任务证据核对)。真实 glm-5.3-flash 单例的原始 7/7 流程检查、比较否定句误报与离线重审分别保留；基金之外的解释质量和完整交互尚未据此判完。基金阶段全量 **1735/1735、207 文件、22754 断言**，typecheck、architecture、test fence 与 build 均通过。

2026-09-19，F12/F20 [组合回答数值核对](./research-task-evaluation.md#2026-09-19组合回答数值与当前比较证据)将收益/回撤的显式百分比绑定到当前完成任务所核验的比较操作；错值会提示复核并暂停待生成的自动报告，纯 `TR`/`DD` 表格同样受检。300 秒真实模型独立复跑 7/7，最终解析器对保存回答的正确原文和改错反例均通过离线复核；最终代码全量 **1804/1804、221 文件、23133 次断言**，typecheck、architecture 与 build 通过。其它真实组合、自然语言解释和账户场景仍待验收，F12/F20 保持部分完成。

2026-09-19，F12/F20 [单标的风险数值核对](./research-task-evaluation.md#2026-09-19单标的风险回答数值与任务证据)在研究和恢复阶段把明确的年化波动率/最大回撤百分比对照本轮核验的 `check_risk` 调用；真实模型所用的两条风险条件共用一次调用也能正确绑定。固定 Pi/SSE 改错反例、CLI 提示与自动报告暂停、保存真实回答的离线原文及数字变异复核均已覆盖。最终全量 **1809/1809、222 文件、23163 次断言**，typecheck、architecture、build 通过。更多风险语义和跨市场样本仍待验收，F12/F20 保持部分完成。

2026-09-19，F12/F20 [最新因子值证据核对](./research-task-evaluation.md#2026-09-19最新因子值与当前验收调用)将明确标记的数值绑定到当前任务选中的 `compute_factor` 调用，恢复阶段的错误 `Latest` 数字使评测失败，CLI 提示复核并暂停该轮自动报告。保存的真实股票研究/恢复原文与改错文本经最终解析器离线复核；未发起新的真实模型调用。最终全量 **1811/1811、222 文件、23185 次断言**，typecheck、architecture、build 通过。完整解释质量仍待验收，F12/F20 保持部分完成。

2026-09-19，F08/F21 的[已配置来源复测](./data-validation.md#2026-09-19已配置来源固定窗口复测与生产门面归档)在固定历史窗口五项均经公开 AKShare 回退得到首末日期；Tushare 仍为权限拒绝，LLMQuant 仍为 401、Financial Datasets 为 402。实际 storage-backed `fetchBars` 对 A/US/HK 各两次新取数均完成不可变归档重读，随后六次 `auto` 请求均命中同修订缓存。两份原始 JSON 保留来源/端点/失败类别与耗时，不含凭证或原始供应商错误。最终全量 **1811/1811、222 文件、23185 次断言**，typecheck、独立脚本 strict typecheck、architecture（0 baseline violations）与 build（3043 modules）通过。付费权限、历史发布时间/交易日/复权、跨日和同步文件硬截止未通过，F08/F21 仍部分完成。

2026-09-19，F07/F24 的[探测日期声明与预检](./command-ux-audit.md#日线新闻与汇率探测日期声明2026-09-19)将日线、新闻和汇率的 `start` / `end` 从任意非空文本收紧为可查询的公历日期格式，并在真实端点检查前拒绝倒置窗口。专项 **23/23、1519 次断言**，隔离 one-shot CLI 的 schema、无效公历日期和倒置 FX 请求均核对通过；最终全量 **1812/1812、222 文件、23221 次断言**，typecheck、architecture、build 通过。对真实供应商时段覆盖和完整终端任务不作推断，两项仍部分完成。

继续 R04 全界面视觉/任务流程及 R06 完整终端交互、真实模型语义和解释依据评测，再按依赖完成 skills/扩展；R02 的完整终端刷新预算、真实服务矩阵和历史可得性仍需补齐。此段 R06 收尾时的快照是 **8 完成、13 部分完成、4 未实现**；2026-09-15 的现行 F01–F25 盘点以 [PRD](./PRD.md) 为准，不以局部实现代替完整 25 项目标。

## 2026-09-19：F13 跨市场基准评分的计价口径

`score_benchmark` 的默认沪深 300 基准在美股或港股策略上也可使用，算法直接比较各自 provider 收盘价的收益率，不请求汇率。现在单次评分、保存假设、独立研究投影和历史排行榜都明确说明这一点：跨币种的超额 CAGR 是两个报价价格 CAGR 之差，不是统一计价币种的投资者收益。统一币种比较仍需显式报价币种与同日 FX 的 `compare_portfolios`；此次未改变评分数值、默认基准或旧制品。

美股 AAPL 与沪深 300 的本地缓存反例核对市场来源、工具提示与不可变评分制品的 `priceBasis`；评分与分享报告专项 23/23。最终全量 `bun run test` **1846/1846、222 文件、23307 次断言**，日志 `%TEMP%/ohquant-full-test-final-20260919.log`；typecheck、architecture（0 baseline violations）和 build 通过。此项是 F13 已完成范围的解释准确性补充，不据此升级其它特性。

独立报告核验随后补齐 `priceBasis` 的显式值检查。篡改为 `fx-converted` 并重算快照 SHA-256 的反例在旧核验下进入 Dashboard 报告，新增测试先复现 **6 pass / 1 fail**；修正后该制品被计入未核验，旧版缺字段的可重算评分仍从价格路径推导未换汇口径。评分、Dashboard 与分享报告专项 **31/31**；最终全量 **1847/1847、222 文件、23311 次断言**，日志 `%TEMP%/ohquant-benchmark-basis-audit-full-20260919.log`。typecheck、architecture（0 baseline violations）、build 和 diff 检查通过。此项只收紧错误计价元数据的报告核验，不改变 F13/F21 状态。

## 2026-09-19：F18/F20 基准任务范围与默认参数

实际评分与归档反例声明 `scope.benchmark=SPY`，同时把 AAPL 和 `000300.SH` 列为研究标的；`score_benchmark` 省略 `benchmark_symbol` 后真实使用默认沪深 300，旧投影却将条件判为 `complete`。新增测试先复现 **10 pass / 1 fail**。现在工具 schema、执行器、独立研究重算和任务守卫共用 `DEFAULT_BENCHMARK_SYMBOL`；工具执行前校验实际默认基准，恢复验收也不接受错基准证据。任务基准明确为沪深 300 时，同一默认调用仍可判为 complete；模型可见研究任务指导要求选定基准显式传参。

研究任务、Pi 工具与系统提示专项 **49/49**；最终全量 `bun run test` **1848/1848、222 文件、23318 次断言**，日志 `%TEMP%/ohquant-scoped-benchmark-full-20260919.log`。typecheck、architecture（0 baseline violations）、build 和 diff 检查通过。该反例证明一个范围漏洞已关闭，不证明模型能正确拆解所有基准研究；F18/F20 保持部分完成。

## 2026-09-19：F18/F20 排行榜完整基准集合

真实保存评分反例让 SPY 和 QQQ 两种基准进入 `show_dashboard`，任务范围指定 SPY 且研究标的也包含 QQQ。排行榜已独立核验，但旧任务投影只检查对象与日期，将混合基准的结果误判为 `complete`；新增测试先复现 **11 pass / 1 fail**。现在 Dashboard 核验从全部有效评分提取基准集合并传到任务投影，任务验收要求集合内每一个基准与声明相同。测试另外确认：只有 SPY 有效评分时可完成；无效 QQQ 文件被排行榜排除后不误阻断；有效 QQQ 评分排在前十名之外仍会阻断。模型可见指导同时说明完整集合口径。

任务/报告/Pi 相关专项 **41/41**；最终全量 `bun run test` **1849/1849、222 文件、23325 次断言**，日志 `%TEMP%/ohquant-dashboard-scope-full-20260919.log`。typecheck、architecture（0 baseline violations）、build 与 diff 检查通过。这只关闭 F18/F20 的一个错验收路径，不将多基准排行榜解释为统一窗口或统一币种的投资绩效，两项继续部分完成。

随后发现相邻边界：无效评分文件虽未进入排行榜，研究输入提取却仍会读取其中伪造的 DatasetRef。实际 SPY 任务的无效 QQQ 文件只要指向缺失修订，旧状态就误变为 `blocked`；先用回归复现 **1 fail**。现在输入提取与 Dashboard 共用 `collectResults` 有效性判断：排除该文件的引用，不增加报告 `unavailableInputs`，同时有效评分的真实缺档仍按原逻辑拒绝。任务与独立报告专项 **21/21**；最终全量 **1850/1850、222 文件、23328 次断言**，日志 `%TEMP%/ohquant-dashboard-invalid-ref-full-20260919.log`。typecheck、architecture（0 baseline violations）、build 通过。F18/F20/F21 状态不因单个边界修复升级。

## 2026-09-19：F18/F20 可选基准的比较输入范围

`scope.benchmark` 原本可选，但只声明 AAPL 研究标的时，真实 `score_benchmark` 的默认沪深 300 引用会被误判为范围外；SPY/QQQ 混合 `show_dashboard` 在未声明单一基准时也会被误阻断。两个实际评分/归档反例先复现 **2 fail**。现在调用守卫与任务投影把经过独立核验的评分默认/显式基准、Dashboard 完整基准集合和组合比较基准作为比较输入；只有声明了单一 `scope.benchmark` 才要求其一致。额外保存 MSFT 策略的反例仍因研究标的越界被拒绝；组合任务的实际 Pi/报告/恢复测试确认移除单一基准范围后完整调用参数仍能验收。

任务/运行时相关专项 **32/32**；最终全量 `bun run test` **1850/1850、222 文件、23336 次断言**，日志 `%TEMP%/ohquant-optional-benchmark-full-20260919.log`。typecheck、architecture（0 baseline violations）和 build 通过。核对 npm 的 pi-agent-core/pi-ai 与当前精确依赖均为 0.85.1，没有可升级版本或依赖变更；本机 Pi auth 只有 API-key 条目，不将其当作真实 OAuth 验收。F01/F18/F20 状态不变。

## 2026-09-19：F18/F20 历史排行榜与数据修订

同一 AAPL 的两次真实保存评分先后使用不同的不可变价格修订，`show_dashboard` 将两者独立重算并核验，任务条件已 `satisfied`，旧任务总状态却因通用同对象版本冲突变成 `blocked`；反例先复现 **1 fail**。现在历史排行榜不参加跨独立计算的单版本约束：它本身仍逐项核验输入、评分和排名，`scope.benchmark` 与研究标的范围继续检查；若任务显式固定 AAPL `dataRefs`，包含其它修订的排行榜仍被阻断。两个独立回测条件使用冲突修订的既有回归继续通过。

研究任务专项 **13/13**；最终全量 `bun run test` **1851/1851、222 文件、23342 次断言**，日志 `%TEMP%/ohquant-dashboard-history-full-20260919.log`。typecheck、architecture（0 baseline violations）和 build 通过。F08/F21 的同步文件操作硬截止、真实供应商权限及历史发布时点没有因此完成；F18/F20 也继续部分完成。

## 2026-09-19：F08/F21 运行时请求预算上限

生产 `source-runtime` 原先先写入 60 秒预算再展开调用方 `providers`；显式 `budgetMs: undefined` 会把默认值覆盖成无计时器，合法较长值也能延长应用请求。新回归用计时器观察分别先复现两种失败，无须等待 60 秒。现在普通和实时取数共用同一合并规则：省略值使用 60 秒、合法短值保留、合法长值限制为 60 秒；超过计时器允许范围的值仍交由预算校验拒绝。通用 source facade 的显式预算契约未改。

数据源专项 **59/59**；最终固定工作区全量 `bun run test` **1852/1852、222 文件、23347 次断言**，日志 `%TEMP%/ohquant-source-budget-ceiling-final-20260919.log`。中途启动的一轮全量在文件修改过程中读到了新断言与旧实现，记录为 1851 pass / 1 fail，不作为最终状态；最终重跑、typecheck、architecture（0 baseline violations）和 build 均通过。此修复确保异步预算不会因可选字段合并而消失或延长，不提供同步文件读取/锁内提交的硬 60 秒抢占，也不补足真实供应商权限、历史发布与跨日时效。F08/F21 仍部分完成。

## 2026-10-09：R02 普通取数异步存储边界

F08/F21 的 storage-backed 普通取数已将来源偏好与凭证快照、Bars cache/archive、proper-lockfile 获取、临时文件、fsync、rename 和清理移到异步 I/O，并把共享 AbortSignal 传到各端口。同步配置编辑与不可变 DatasetRef 精确读取继续保留，不参与 provider 刷新期限；宿主自行注入的同步 JavaScript 也仍只能在返回后检查单调期限。实现与限制见 [数据验证](./data-validation.md#2026-10-09普通取数的异步本地-io-与取消边界)。专项 **104/104、499 次断言**，source 模块 **185/185、517 次断言**；最终全量 `bun run test` **1877/1877、224 个文件、23773 次断言、383.72 秒**，typecheck、architecture（0 baseline violations）、test fence 与生产构建均通过。构建产物为 **3052 modules、7.1 MB**。F08/F21 因真实付费权限、长期延迟、历史发布/复权/交易日和跨日稳定性仍为部分完成。

## 2026-10-09：R06 第六阶段，真实 TUI 与结构化恢复收口

同一固定 AAPL 风险任务现在分别从 headless 与真实 TUI 键盘/Composer 进入 AppRuntime 和 Pi 循环，在隔离数据根中逐项比较任务声明、验收状态、核验工具和指标。既有 80/120 列键盘流程同时覆盖首次模型/行情配置、组合编辑、比较、自动报告、清屏与恢复；四类任务矩阵和恢复回归覆盖缺数据、供应商失败、取消、同参重试、报告绑定、缺档、有损压缩、分支及会话隔离。专项六文件 **51/51、497 次断言**通过。

这组证据满足 PRD 对 F18 Quant Harness 和 F20 结构化恢复的本地验收条件，两项更新为已完成。固定 SSE/单例真实模型不代表任意解释都正确；研究文本与工具选择质量继续在 F12/F24 中评测，供应商与数据及时性仍由 F08/F21 承担。新增测试后的最终全量 `bun run test` **1878/1878、224 个文件、23789 次断言、323.72 秒**；typecheck、architecture（0 baseline violations）、test fence 和生产构建通过，构建为 **3052 modules、7.1 MB**。一轮全量因机器长时间挂起使三个 5 秒用例超时并在清理后触发锁心跳错误；两个失败文件独立 **20/20**、**40/40** 通过，上述完整重跑也通过，因此该中断不作为代码状态。

## 2026-10-09：F05/F06/F07/F15 本地验收边界收口

按 PRD 已声明的“可调用入口、实现及相关验证”本地完成口径，重新核对了此前由跨项外部条件阻塞的四项状态。F05 的空配置连续任务、多尺寸收缩、生产 PTY 研究/比较/报告/恢复与状态区分已经满足终端布局流程；F06 的共享语义颜色覆盖 TUI、Overview、图表、报告与静态回退；F07 的十个公开命令覆盖帮助、建议、词法、预检、schema 与实际安装签名；F15 的公开/私有年度报告、决策冻结、证据恢复、CLI 与双确认 TUI 导出形成完整本地年报路径。因此四项更新为已完成。

状态调整不扩展证据边界：真实终端字体/像素/输入法继续归 F04，供应商权限与时效归 F08/F21，模型解释和工具选择质量归 F11/F12/F24，真实券商账单、账户授权及订单执行归 F16。完整依据分别见[终端研究流程验收](./terminal-workflow-audit.md#f05f07-本地验收收口2026-10-09)与[年度研究报告](./annual-reports.md#f15-本地验收收口2026-10-09)。本次仅修改状态与证据说明；沿用同日已通过的工程基线 **1878/1878、224 个文件、23789 次断言**、typecheck、architecture（0 baseline violations）、test fence 和 **3052 modules / 7.1 MB** 生产构建。

## 2026-10-11：F08/F21 复权口径与跨响应隔离

补齐公开 Bars 的实际请求口径，修复前复权抓取基准变化时累积历史可能拼出虚假跳价的反例。来源标注、存储匹配、缓存/离线回退、归档截止、新闻价格证据、因子/回测/风险工具及评分/组合/Alpha 报告共同保留原引用口径。Alpha 严格输入同时接受合法端点，输入哈希包含口径；缺失或篡改归档不转用新行情。旧未知口径修订保持原字节、原标签和原值。

[验证与复跑方式](./data-validation.md#2026-10-11复权口径与跨响应缓存隔离)包含模拟复权重算、同模式/换模式保存、未知 adapter、旧快照、报告重审以及 `adjClose` 不替换计算收盘价的回归。最终 **1893/1893、225 文件、25131 次断言**，typecheck、architecture、build 通过。真实公开五标的门面测量本轮全部未取得可验收响应，失败结果保留，不能用本地绿测推断服务已通过。F08/F21 仍部分完成，25 项状态仍为 **16 完成、9 部分完成**；公司行为独立校准、完整交易日和历史发布时间仍待验收。

## 2026-10-11：F12/F24 六指标风险回答与非零回撤

风险文本核对从两项扩充到年化波动率、下行波动率、历史 VaR/CVaR 95%、最大回撤及观察期持续数，全部绑定当前验收选择的已核验调用；空表格单元格不再造成列移位。CLI 对仅 CVaR 或持续期冲突的回答也保留原文、提示复核并暂停自动报告，更正后恢复生成。工具和报告共用口径说明，明确年化范围、有符号逐期收益、历史尾部分位与持续期的含义。

新增 `eval:research --case risk` 使用十次 `100,110,88,99` 的隔离合成观察，独立检查非零下行/尾部/回撤，研究与压缩恢复都须明确引用六项。漏项与把恢复 VaR 错误年化的固定 Pi/SSE 反例不能通过。两次真实模型均在首次请求失败，无工具或回答，保留原始记录，详见 [评测与复跑方式](./research-task-evaluation.md#2026-10-11六指标风险回答与非零回撤评测)。因此 F12/F24 仍部分完成，25 项仍为 **16 完成、9 部分完成**。

同一连接的独立生产 model Doctor 最小请求返回 HTTP 502，阶段 fail；已保留不含凭证/端点的阶段导出。该探测不定位网关/代理/供应商原因，也不把进程退出码 0 当成连接就绪。

最终风险专项 **84/84、536 次断言**，工具/归档/任务矩阵 **30/30、284 次断言**；全量 **1899/1899、225 文件、25169 次断言、215.37 秒**，日志 `%TEMP%/whyj-risk-six-metrics-full-2026-10-11.log`。typecheck、architecture（0 baseline violations）、评测脚本严格类型检查、test fence、whitespace 与构建通过；生产构建 **2673 modules / 7.50 MB**，版本 WhyJ 1.2.0 / Pi 1.1.0。真实语义、跨市场/模型解释及外部服务验收继续按 PRD 的各项范围跟踪。

## 2026-10-11：F11/F24 隐藏字符与标题指令隔离

先复现隐藏字符绕过文本隔离，以及恶意标题仍贡献方向性情绪的两条失败。检测仅规范化匹配视图，原文、指纹和段落号保留；修复 DOM 折叠换行后句中角色指令再次泄漏的反例。模型可读行、JSON 和有损恢复共用隔离投影，对应段落不能引用。纯标题初筛接收编排提供的隔离 ID，`headlineWithheld=true` 的 item 为 unknown、无方向词组，不进入目标 tone/调整证据；可疑标题也不优先占用正文预算，调整状态显式 insufficient。

新 `news-obfuscated` 固定案例使用实际 DOM、工具、价格归档、Pi 和恢复路径，分别核对模型请求不含测试标记、原始证据保留、可疑标题不贡献方向及非法引用拒绝。[评测过程和复跑](./news-evaluation.md#2026-10-11隐藏字符与标题指令的证据门槛)保留失败转通过记录。真实模型首次请求失败，没有工具或非空回答；不以空回答未含标记作为语义通过。F11/F24 仍部分完成，25 项保持 **16 完成、9 部分完成**。

三文件专项 **65/65、511 次断言**；最终 `bun run test` **1904/1904、225 文件、25238 次断言、241.78 秒**，日志 `%TEMP%/whyj-news-invisible-full-2026-10-11.log`。typecheck、architecture（0 baseline violations）、评测脚本严格类型检查、test fence、whitespace 和 build 通过，构建 **2673 modules / 7.50 MB**，产物 WhyJ 1.2.0 / Pi 1.1.0。新闻案例扩展为六个，全部评测发现目录为 33 例；目录数量不证明真实任务总体准确率。规则过滤、跨市场语义、情绪校准和真实服务验收继续按 PRD 跟踪。
