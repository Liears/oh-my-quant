# Quant UI/UX：终端、工作流与报告

更新：2026-09-14。合并原 CLI 设计与 TUI 布局的现行契约，移出历史 phase 清单。视觉真源为 [DESIGN.md](../DESIGN.md)，命令/配置字段分别由 [Slash 参考](./slash-commands.md)、[配置参考](./configuration.md) 维护，完成度见 [PRD F01–F15](./PRD.md)。

## 产品任务与当前边界

目标任务是“配置 → 建观察组合 → 查看数据状态 → 分析 → 比较 → 报告 → 恢复”。当前模型配置、组合 CRUD、分析工具、报告、恢复及独立模型性能基准已有本地流程；组合比较提供自然语言工具入口，新闻与年度研究的剩余范围见 PRD。

Portfolio 当前是标的/分组，不能把公开行情展示解释成真实账户业绩。界面出现最新刷新时间，也不能说明上游行情已更新到此刻。

## 信息布局

```text
Header：品牌 / 活动
┌ Analyzing：研究与工具结果 ┬ Overview：组合 / 行情 / 来源 ┐
└────────────────────────┴─────────────────────────────┘
Composer：输入 / 一级建议 / 队列
Status / HUD：模型 / 来源 / 上下文与延迟
Modal：Settings、Model、Doctor、Portfolio、Resume、Research task、Artifact
```

布局与绘制代码在 [render.ts](../src/tui/src/render.ts)，输入/面板分别由 input.ts、PanelController 管理。TUI 负责输入和展示，runtime 负责动作与数据，不能直接选 provider 或读写 storage。

现有实现按终端宽度隐藏 Overview，也可通过配置关闭；关闭后主区扩大。密度由 `WHYJ_UI_DENSITY` 控制，compact 默认，comfortable 增加纵向空间。具体行列常量以代码为准，不复制容易漂移的像素/行数表。

## 视觉与字体

[terminal.png](./assets/terminal.png) 是风格参考，不是本轮实际截图：黑底、克制金色、主次分区和清楚的组合行。网页字号不直接对应 TUI 字号；字体由用户终端控制，产品负责 cell 宽度、中文对齐、截断、留白和密度。

| 项 | 当前差异 | 待验收要求 |
|---|---|---|
| 主金色 | 共享主题已按 DESIGN 统一为 #D4AF37，焦点 #E2BE4D | 继续全部面板和报告的真实视觉对照 |
| 行情语义 | Market Colors 默认红涨绿跌，可选绿涨红跌；混合市场统一 | TUI/表格/Overview 与报告配色及零值回归已通过；真实图表视觉待补 |
| 成功/风险 | positive/negative 与 marketUp/Down 是不同语义 | 不复用品牌金色表达行情涨跌，带正负号或文字 |
| 字体与间距 | 代码已有共用 styles 和密度 | 宽字符对齐，长模型 ID/key 输入横向滚动，焦点可见 |

## 配置与诊断

Settings 分为 Agent Runtime、Research Data、Workspace Experience。Model 与 Doctor 共用连接编辑器；搜索 Provider/模型、填写 key 或 Provider setup、Thinking、Save/Save & Verify。草稿可取消，key 输入遮蔽，保存后新请求生效且历史保留。

Settings 的导航提示常驻，编辑时切换为保存/取消提示；列表、草稿与校验状态分行显示。Resume/Artifact 的空态指引在正文换行，数量和状态留在页脚；有数据时按实际剩余高度显示列表，方向键选择保持可见。三尺寸按键回归与渲染截图见 [小屏验收](./terminal-workflow-audit.md#小屏空态设置与长列表2026-09-15)。

配置提交和行情刷新分开通知：模型保存、External Skills、Auto Artifacts 不附带行情请求；模型 Save & Verify 只执行 model phase。数据 Save verified 刷新一次，退出父面板不重复。取消或冲突不发布成功通知，见 [终端流程验证](./terminal-workflow-audit.md)。

OAuth 使用同一 Model 编辑器中的 Sign in & Save，也可在审阅 Pi 配置后链接 Pi 已登录的账号。授权链接/设备码单独展示，Ctrl+O 打开浏览器、PgUp/PgDn 滚动，手动授权码遮蔽；登录中 Esc 返回编辑器，父面板关闭也取消。成功即保存并同步父面板版本，后续 Esc 不撤销；Sign out 删除本地登录或链接，保留 Pi 账号，Use API key 仍是可取消草稿。真实账号及默认浏览器验收边界见 [OAuth](./model-oauth.md)。

Market Data 与 Data Token 打开共享 Data connection 编辑器，后者聚焦密钥。选择兼容市场/源、凭证/端点、标的和日期，Check data 只验证草稿；有效样本返回后才能 Save verified。AKShare 明示 Python/package 要求；其他源明示 key/权限。失败不写入，修改输入使旧成功失效，冲突保留草稿。Tool capabilities 按实际 registry 显示逐工具要求；详情按 p 打开所选端点/参数的检查，成功只证明该响应，不能把工具已注册视为权限齐备。

Doctor 的共享数据诊断区分缺凭证/依赖、鉴权/权限、空数据、超时与取消；必须实际取得所选源的有效窗口内行情才通过。结果明确标的、时段和有限能力范围。数据检查完成主动重绘，Esc 取消检查，再按 Esc 丢弃草稿；父面板关闭/替换会取消检查。Doctor 的 Configure 共用模型和数据编辑器，Run diagnostics 只检查已保存设置；关闭、配置或重试取消旧诊断，迟到结果不重开面板。

Doctor 报告生成成功不等于外部连接成功；查看指定 phase 的 status。Save & Verify 会发出小型模型请求。独立性能测试使用 `bun run bench:model`，固定输入、thinking、工具声明和样本数，保留失败并统计 p50/p95。Status HUD 控制 full/context/off；Compact At 编辑上下文压缩阈值，两者均持久化且不触发行情刷新。指标定义与限制见 [模型性能测试](./model-performance.md)。

Doctor 长报告使用独立可滚动视口：↑/↓ 逐行，PageUp/PageDown 翻页，Home/End 到首尾，Esc 关闭。摘要与重试/配置操作固定显示，错误、warning、修复建议和日志信息完整换行；读取不会重新执行检查。三尺寸回归和渲染器画面见 [终端验收](./terminal-workflow-audit.md#doctor-长报告与渲染画面2026-09-15)。

Market Colors 对当前 TUI 立即生效；每份新报告捕获其生成时约定并显示图例，历史版本不改写。行情变化使用可切换语义，风险金额/评分/命令结果使用稳定语义；零变化、平 K 和缺失值为中性灰。改变外观不会触发额外数据请求。

## 命令与输入契约

Shell 处理启动、one-shot 和 JSON；slash 处理应用动作；自然语言进入 Agent。一级 catalog 是 `src/runtime/command-catalog.ts`，CLI/TUI/help 同源。当前十个命令的完整行为只在 Slash 参考维护，不另复制表格。

- Composer 建议保持一级列表；Tab 接受建议，精确命令 Enter 提交，裸 slash 不作为业务命令执行。
- 忙碌输入由 harness 的 steer/followUp 队列控制；Composer 只显示快照，原文不显示注入的研究元数据。
- ↑/↓/Enter/Esc 在面板中保持一致；有子编辑草稿时先返回或取消草稿，不误保存其他设置。
- Help 采用全宽的 Commands / Hotkeys 列表，Tab/Shift+Tab 切换并保留选择位置；方向键移动时选中项保持可见。Commands 中 Enter 执行、`?` 查询用法；Hotkeys 仅供阅读，Esc 关闭。
- 键位以项目 keybinding 定义与输入测试为准；特殊命令边界以 Slash 参考为准。

2026-09-15 的命名核对保留 compact/resume/config 等易识别动词，将目录描述明确为 research session、observation portfolios、research reports 和 market data readiness；不机械地给每个命令添加 quant 前缀。`/help COMMAND` 或 `/COMMAND --help` 提供详细用法，在执行目标动作之前返回；Help 的查询键走同一入口。60×20、80×24、120×32 的原始按键测试覆盖十条命令、全部快捷键及 Composer→Help→用法→继续输入，实际字体/终端视觉仍待验收。没有安装技能时，/ski 仍能补全 /skill。通用参数预检在活动切换前返回 Composer 错误提示，不刷新行情或初始化模型；Doctor 的非法 phase 不再回退默认诊断范围。逐项证据与子模式验证边界见 [命令核验](./command-ux-audit.md)。未接通功能不得先显示成命令；旧 /compare 不是当前可用入口。

`/resume --task` 打开当前分支的只读任务快照，目标、验收条件、证据与失败原因共用研究状态投影。方向键滚动，Enter 本地刷新核验，Esc 关闭；模型输出期间可查看，对话内容不被面板覆盖。继续、修订与结束仍在 Composer 输入。三种终端尺寸、按键和忙时查看已有自动化测试，完整连续任务与真实终端视觉仍待验收，详见 [研究任务](./research-tasks.md)。

## 分析、组合与数据状态

Analyzing 显示用户原文、assistant、thinking、工具动作与结果。工具展示元数据来自统一 registry；长结果换行/裁剪、结构化数值保留，控制字符不得泄漏。渲染机制详见 [表格与图表](./tui-table-chart-render.md)，不把提示偏好当成模型输出保证。

Overview 读取观察组合元数据，由独立 OverviewRefresh 管理刷新。每轮行情和组合共用最多 8 个请求，规范化身份去重；手动更新取消旧轮并合并后续请求，晚到结果不能发布。价格行保留 .SH/.SZ/.OF 身份，第二行显示实际来源、数据日期和旧窗口/回退标识，无有效报价显示 --。刷新中、部分可用、无数据、失败和超时分别显示；整轮失败保留旧值时明确标记 stale，Source 增加可用行数。观察时刻取完成时间，不能解释为上游实时行情。

渐进刷新：慢标的不阻挡已经返回的报价，首批结果及时显示，后续按 16 ms 合并更新；显示本轮已返回行数。2026-10-14 更新保留策略：刷新时继续展示上次可用的公开观测，逐标的标记“刷新中”及原来源/数据日期；失败或超时标记 stale，新标的没有旧数据时显示 --。Source“更新”指结果发布时刻，不代表上游行情时刻；“覆盖”排除保留旧数据并另列旧数据数量。Ctrl+R 仅重试失败标的，研究计算仍遵循原核验规则，见 [中断与刷新](./research-interruption-and-refresh.md)。固定 HTTP 基线见 [渐进刷新记录](./data-validation.md#2026-09-15渐进刷新与慢请求隔离)。

刷新验收分开测 UI 响应、provider 请求、解码和渲染耗时；按组合规模统计分位数与失败率，再制定阈值。[数据测量](./data-validation.md) 包含研究路径的冷/热缓存基线，以及真实 AppRuntime 入口的 1/10/50 行组合成功、部分失败和超时基线。尚未测终端实际输出或真实跨市场刷新预算。提高刷新频率不应重复请求、掩盖上游休市或把陈旧净值写成实时价格。

终端输出流返回背压时，[Screen](../src/tui/src/buffer.ts) 在 `drain` 前只保留最新画面，恢复后一次性写入完整同步帧；退出时丢弃待发送画面并排入原有光标/鼠标/备用屏幕恢复序列。该处理避免活动动画和渐进刷新继续排队旧帧，见 [终端输出回归](./terminal-workflow-audit.md#终端输出背压与整帧合并2026-09-15)。`drain` 只表明写入流恢复容量，不代表用户终端已经绘制完画面；终端端到端延迟仍需独立实测。

整轮默认 120 秒取消期限同时由定时器和单调时钟截止检查执行。即使同步响应处理延后定时器，队列恢复时也不能继续派发过期请求；整批结果先检查期限再接收，超时面板仅保留此前已接收的行。此约束不承诺抢占同步 JavaScript 或终端输出的严格时限，复现及范围见 [截止时间验证](./data-validation.md#2026-09-15整轮截止时间与迟到结果)。

比较流程显示两组、时段、基准、权重和缺失成员，并核验共同日期与收益口径。F10 的本地工具闭环已有验收；80×24 和 120×32 的键盘建组→比较→自动报告→恢复已通过固定传输验证，完整真实模型和终端视觉继续在 F05 验收。

## 报告与研究恢复

Auto Artifacts 仅在 Settings 开启，默认关闭。量化 turn 完整落盘后自动生成并打开浏览器；Artifact 面板浏览、恢复和打开已有报告。恢复应先确认来源 session 有效，错误保留可用状态。

Artifact 列表逐版本显示时间与 revision，选择携带固定版本引用。Enter 恢复生成时的来源分支并打开原 HTML，不用后来研究覆盖旧报告。缺失来源的报告隐藏并保留文件；原 entries 改变时恢复失败且当前会话保持。价格图的 Source & revision 可展开查看观测时间、区间和版本，Raw 显示对应观测；不同对象/窗口不混为同一条曲线。

Dashboard 的 Verified research results 展示通过参数/归档输入重算且匹配保存结果的因子、风险、SMA 回测、Benchmark、DCA 和保存的排行榜；Research inputs 分别展示归档价格或基金 NAV，Session interpretation 展示文本检测结果。排行榜重算全部捕获评分后核对汇总/排序，显示公开标的、区间、SMA/费用假设与数据引用；缺参数的旧集合明确未支持，窄屏表格可聚焦后用方向键横向浏览。文本与模型叙述不被标为已核验。Trajectory 关联用户输入、工具、结果与摘要。年度报告的周期、组合版本、基准/币种、策略变化和引用模板尚未完成。

新报告的 Share preview 打开独立分享副本，检查标的/区间后用 Download HTML 下载；无可验证输入时禁用。副本只保留公开行情/NAV 和核对通过的量化结果；SMA/Benchmark 净值初值为 1，DCA 为剔除外部投入的 TWR，申购前基准 1、首点含费用。不带资金金额、会话/路径/凭证、模型叙述或轨迹。预览使用沙箱 iframe，支持 Close、Esc 与焦点返回；下载与预览字节相同，不上传或发布。

完整报告的交互图仍使用 ECharts CDN，并可能包含用户私密输入。分享副本使用无外部依赖的 CSS/SVG/Raw 表，可离线打开；二者随同一版本固定，旧版本不自动改写。1440×1000/390×844、CDN 503、实际下载与断网打开已核验，见 [R02 第五阶段](./feature-delivery.md#r02-第五阶段结构化结果与分享)。

2026-09-15 的 [组合报告 Chrome 验收](./report-browser-audit.md) 另覆盖 1440/390/320px：组合 SVG 不再继承表格高度上限，小屏页头不挤出主题按钮，长叙述可换行；分享预览在弹窗打开后挂载新沙箱 iframe，避免内容存在却不绘制。实际下载字节与预览一致，CDN 失败静态 K 线及下载内容的 offline 浏览器渲染通过；此轮没有验证系统双击文件或完整真实终端任务。

## UI 验收任务

| 任务 | 当前证据 / 待补 |
|---|---|
| 首次配置到验证 | 模型面板、本地 HTTP、错误恢复测试已有；真实账号单独验收 |
| 创建空组/跨市场加标的/重启 | 组合服务、存储、面板与 CLI 记录已有 |
| 持续研究到比较再报告 | 两尺寸键盘建组、自然语言比较、自动报告和 Artifact 恢复通过固定 Pi/SSE 与合成行情；首次配置到研究的真实终端/模型验收仍待补齐 |
| 取消、恢复、压缩后继续 | 生命周期测试已有；研究字段语义保留待补 |
| 视觉统一 | Buffer/裁剪/多尺寸面板测试已有；全界面对照参考图待补 |

至少覆盖 80×24 与宽屏；模型面板已有 60×20/80×24/120×32 检查，不能扩展为整个终端已经完成小屏验收。另检查中文宽度、长文本、空态/失败、选中项与输入光标、Tab 顺序和复制。界面测试不替代金融数字正确性测试。

历史原文：[CLI 设计](./archive/interactive-cli-design-before-prd.md)、[TUI 布局](./archive/tui-layout-design-before-prd.md)。演示稿 [slides.html](./slides.html) 用于产品与技术分享，不作为应用 UI 已改版的证据。
