# 终端研究流程验收

更新：2026-10-09。对应 F04–F07，并支持 F14/F20。证据来自当前工作区，未发布；物理终端字体、像素与输入法差异继续由 F04 跟踪。

## 已修复的配置刷新问题

通过 QuantTui 的键盘处理器复现：保存 External Skills 或 Auto Artifacts 后关闭 Settings，各请求一次行情刷新；模型 Save 再关闭 Settings 则请求两次。它们与行情无关，却共用了 refreshPanel 信号。初次三项失败记录保留在 `%TEMP%/whyj-settings-refresh-before.log`。

现在 [PanelController](../src/tui/src/panel.ts) 在设置提交成功后发出 onConfigurationChange，经 [QuantTui](../src/tui/src/tui.ts) 转交 [app.ts](../src/app.ts) 的运行时配置刷新；行情刷新仍由 onPanelRefresh 独立发起。模型与非行情开关不再标记行情 dirty；数据 Save verified 当场刷新，退出父面板不再重复。OAuth 提交也使用配置通知。正常启动、首次失败后重新初始化以及定时行情轮询保持各自生命周期，此修改不承诺应用永不自动取数。

| 操作 | 配置通知 | 行情行为 |
|---|---|---|
| 模型 Save、External Skills、Auto Artifacts | 提交后通知运行时 | 不因该操作刷新 |
| 模型 Save & Verify | 提交后通知，随后执行 `/doctor --phase model` | 不附带 Overview 刷新 |
| Data Check | 不保存、不通知 | 仅显式样本检查 |
| Data Save verified | 保存后通知 | 刷新一次，关闭 Settings 不追加 |
| 浏览、取消草稿、保存冲突 | 不发布成功通知 | 不刷新 |
| 组合编辑 | 原组合持久化与刷新信号 | 保留保存后刷新 |

[settings-refresh.test.ts](../src/tui/test/settings-refresh.test.ts) 的 13 项测试包括 60×20、80×24、120×32 的可见字段选择、Enter/Esc、取消/冲突、模型限定诊断、真实 loopback HTTP 数据验证，以及 AppRuntime 联动。运行时样本确认设置通知更新模型显示并通知技能重新发现，保持已有非空 session ID 和完整分支，行情 fetcher 调用数不增加。技能重新扫描内容与真实账号认证分别由原专项负责。

## 连续研究路径

[research-workflow.test.ts](../src/tui/test/research-workflow.test.ts) 在 **80×24、120×32** 执行同一条路径：

1. `/config` 中通过方向键选择 Auto Artifacts，Enter 开启并退出。
2. `/port` 加 Tab 补全并打开 Portfolio，通过可见编辑器创建 Core/AAPL 与 Stable/MSFT。
3. Composer 输入明确日期、SPY 基准、USD 和买入持有的比较请求。
4. 真实 Pi 循环调用 compare_portfolios，实际 source 编排、计算、数据归档和研究结果核验完成。
5. turn 完整提交后自动生成报告；断言两组收益分别为 39% 和 0%，仅代表固定合成价格样本。
6. `/clear` 清空当前显示，再通过 `/artifact` 和 Enter 恢复；核对原 session ID、verified 研究结果和报告字节，恢复未再次调用研究数据适配器。

原始按键字节先由 nextInputAction 解码，再进入真实 QuantTui 处理器；方向键、Tab、Enter 和独立的 Esc 按键均在路径中。测试不直接修改组合文件、不直接调用比较工具、不手动触发自动导出。模型响应是 localhost 的固定 SSE，provider transport 返回 40 天合成行情，Overview 返回空 fixture，浏览器打开回调只记录本地路径；因此不证明真实模型选择质量、上游权限、实际终端字体/光标、浏览器页面视觉或首次凭证配置闭环。

最初连续测试把两次 Esc 拼成同一输入块，并在恢复时误查 Composer 状态而非对话回执；分别修正为独立按键和实际输出位置，原始失败日志保留为 `whyj-tui-workflow-targeted.log`、`whyj-tui-workflow-reviewed.log`。这两处是测试输入/断言问题，没有据此改写产品按键或回执语义。

## 复跑与剩余验收

```powershell
bun test src/tui/test/settings-refresh.test.ts src/tui/test/research-workflow.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

两文件专项 **15 pass / 0 fail、105 断言、2.17 秒**；全量 **1388 pass / 0 fail、171 文件、17720 断言、106.58 秒**。typecheck、architecture（0 baseline violations）、build（2958 modules / 6.70 MB）通过；日志分别为 `%TEMP%/whyj-tui-workflow-final-targeted.log`、`whyj-tui-workflow-final.log`、`whyj-tui-workflow-checks.log`。

F05 继续保持部分完成：首次模型/数据配置与连续研究的整体验收、真实终端视觉、浏览器报告检查及真实模型完整任务仍需补齐。此记录证明键盘到持久化/恢复的固定比较流程，不将两种尺寸的一条成功路径扩展为全产品验收。

## Doctor 长报告与渲染画面（2026-09-15）

原 Doctor 视图按面板高度直接停止绘制。模型阶段有较多 warning 时，后面的数据失败、修复建议、日志和快捷操作无法看到，方向键也不会滚动。60×20、80×24、120×32 的复现均失败，记录 `%TEMP%/whyj-doctor-scroll-before.log`；这不是网络请求失败，而是已有报告内容不可达。

诊断报告现由 [DoctorPanel](../src/tui/src/doctor-panel.ts) 独立管理换行和视口，PanelController 继续负责检查、配置和取消。方向键逐行、PageUp/PageDown 翻页、Home/End 到首尾；阶段摘要及操作区固定显示，控制标签在小屏按完整操作换行。先展示诊断阶段，再展示连接信息、日志与 hints。更新较短报告和改变尺寸会限制滚动位置，重试/关闭/重开会重置。浏览和滚动不发起模型/数据请求，不保存设置。

新增 [doctor-navigation.test.ts](../src/tui/test/doctor-navigation.test.ts) 五项回归覆盖三尺寸内容可达、逐页/首尾/边界、更新/重试/重开及改键。已有端点编辑测试发现新增独立 Home/End 绑定会抢占 JSON 编辑器按键，已改用现有 DEFAULT_EDITOR_KEYBINDINGS；原端点测试保持通过。专项 **31 pass / 0 fail，645 断言**；全量 **1442 pass / 0 fail，176 文件、18911 断言、111.10 秒**，日志 `%TEMP%/whyj-doctor-scroll-targeted.log`、`whyj-doctor-scroll-full.log`。typecheck、architecture（0 baseline violations）、独立导出脚本 strict typecheck 和 build（2967 modules / 6.73 MB）通过。

### 可复查画面

[画面索引](../output/terminal-audit-2026-09-15-v2/index.html) 和 [生成记录](../output/terminal-audit-2026-09-15-v2/evidence.json) 包含 39 帧：三种尺寸各 13 帧，覆盖研究主界面两种涨跌色、Settings、Model、Portfolio/Resume/Artifact 空态、Help，以及 Doctor 加载、顶部、翻页、底部和关闭。画面经真实 QuantTui paint、Screen/Buffer 和原始按键解码产生；注入只读合成 PanelDataService，没有读取用户配置、账户、真实模型或行情。

每帧保留 ANSI 流和 SVG 单元格投影，Chrome `152.0.7977.84` 成功加载全部 39 张并输出 PNG，位于 `output/playwright/terminal-audit-2026-09-15/`。视觉复核了以下十张：60×20 的 config/model/help/artifact、Doctor 顶部/底部，80×24 的 Doctor 顶部，120×32 的 Doctor 底部和两种涨跌色。Doctor 修复建议可滚动到达，固定操作区清楚；宽屏 red-up/green-up 正负色交换、零变化保持中性。截图是浏览器中的字符网格投影，不证明原生终端字形宽度、ANSI 解释、输入法或全流程实时输出。

复核还看到小屏 Artifact 空态的长说明被截断，Settings 底部未提供常驻导航提示。这两项随后按下一节复现并修复；未以成功导出图片视为全界面完成，F04–F07 保持部分完成。

```powershell
bun test src/tui/test/doctor-navigation.test.ts src/tui/test/panel.test.ts src/tui/test/tool-capabilities-panel.test.ts
bun run scripts/render-terminal-audit.ts --output output/terminal-audit-new
```

导出目录必须为新路径；离线打开生成的 index.html 可看 SVG，ANSI 文件供终端侧继续复核。PNG 截图另由 Playwright 经本地 HTTP 取得。浏览器连接工具最初连接失败，Playwright 的 file 协议不可用，改用本地只读 HTTP 服务完成；favicon 的 404 不影响图像加载。

## 小屏空态、设置与长列表（2026-09-15）

Artifact 与 Resume 原先将完整空态指引放在单行页脚，窄屏丢失后半句；列表高度又从已扣除顶部区域的 contentH 中重复扣除全部元信息行。60×20 中带完整预览的会话列表原先只显示两行，报告列表只显示四行。现在空态正文经共用渲染函数换行，页脚独立保留数量或状态；列表按实际起点到内容底边计算容量，相同数据分别可见五行和八行，选中项保持在视口内。上下文用量条也限制在面板宽度内。

Settings 和共用配置向导增加常驻操作提示；编辑时显示 Enter save / Esc cancel。设置列表、最多两行草稿、操作提示与校验状态各自预留位置，错误保留输入，不覆盖选中字段。这一轮未新增按键或改变保存、取消、恢复的执行路径。

[panel-small-screen.test.ts](../src/tui/test/panel-small-screen.test.ts) 新增九项回归，覆盖 60×20、80×24、120×32：两种空态的完整指引、十个设置字段逐项导航、无效压缩阈值的输入/错误/取消、30 条中文会话及报告逐项选择、末项 Enter 恢复意图与循环选择。服务使用内存 fixture，意外保存或组合编辑会报错。复现为 **0 pass / 9 fail**；修复后相关五文件 **39 pass / 0 fail、789 断言**。全量 **1451 pass / 0 fail、177 文件、19565 断言、119.91 秒**；日志 `%TEMP%/whyj-panel-small-before.log`、`whyj-panel-small-targeted.log`、`whyj-panel-small-full.log`。typecheck、architecture（0 baseline violations）、导出脚本独立 strict typecheck、build（2967 modules / 6.73 MB）及 diff whitespace 检查通过。

[更新后的画面索引](../output/terminal-audit-2026-09-15-v3/index.html) 和 [生成记录](../output/terminal-audit-2026-09-15-v3/evidence.json) 共 54 帧。在原有 39 帧基础上，每个尺寸增加设置末项、编辑、校验错误、会话末项和报告末项。Chrome `152.0.7977.84` 加载全部图片，截图并复核十张：60×20 的 Settings 初始/末项/编辑/校验、Artifact/Resume 空态与末项，80×24 的会话末项和 120×32 的设置校验。PNG 保存在 `output/playwright/terminal-small-2026-09-15/`；图像无文本覆盖，空态换行及选中项清晰。验证后关闭浏览器和本地只读服务器。

画面仍是生产 QuantTui/Screen/Buffer 的 SVG 单元格投影，不能替代原生终端字体、ANSI 解释、输入法或真实模型连续研究验收；F04–F07 不因此改为完成。

```powershell
bun test src/tui/test/panel-small-screen.test.ts src/tui/test/panel-views.test.ts src/tui/test/panel-models.test.ts src/tui/test/panel.test.ts src/tui/test/hud-settings.test.ts
bun run scripts/render-terminal-audit.ts --output output/terminal-audit-new
bun run test
```

## 终端输出背压与整帧合并（2026-09-15）

实际 QuantTui 的 `paint()` 每次完成全屏 Buffer 后调用 `Screen.flush()`。旧实现即使 `out.write()` 返回 false，仍按活动动画与逐步行情回调排入每一个完整帧；慢输出流会先消费过时画面，当前数据在后面等待。两条行为测试先复现三次绘制产生三次写入，以及退出后待发送旧画面继续占用队列。

[Screen](../src/tui/src/buffer.ts) 现在在背压期间只记录“有最新画面待发送”，不提前序列化每个中间 Buffer；收到 `drain` 时按当前 Buffer 写一个包含 `syncOn/syncOff` 的完整帧。初始化控制序列若发生背压也等待，反复背压可再次合并。退出移除监听并丢弃待发送画面，随后排入恢复光标、鼠标和备用屏幕的控制序列。没有改变 QuantTui 的输入、组合或模型事件流程。

[buffer.test.ts](../src/tui/test/buffer.test.ts) 的行为回归使用受控输出流和实际 Node Writable（低 highWaterMark、延后写回调），验证中间帧不入队、恢复后只交付最新帧、重复背压与退出恢复。专项复跑：

```powershell
bun test src/tui/test/buffer.test.ts src/tui/test/research-workflow.test.ts src/tui/test/settings-refresh.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

最终全量 **1610 pass / 0 fail、191 文件、21286 次 expect、202.98 秒**，日志 `%TEMP%/whyj-output-backpressure-full-2026-09-15.log`；根 typecheck、architecture（0 baseline violations）、build（2983 modules / 6.78 MB）和 whitespace 检查通过。背压与相邻终端流程专项 **21 pass / 0 fail、126 次 expect**；实际 Writable 用例也在其中通过。

Writable 测试证明 Node 输出流背压后的帧合并，不代表真实终端字形、ANSI 解释、系统 PTY 的接收/绘制时延，亦不把 `drain` 时间冒充屏幕可见时间。F05/F21 的原生终端与全链路刷新预算仍需实测。

## 原生 PTY 帧写入与 ANSI 回送计时（2026-09-15）

[测量脚本](../scripts/measure-terminal-refresh.ts) 在真实 Windows PTY 中运行生产 `QuantTui` 的完整 `paint()` → `Screen.flush()` 路径，并通过实际 `AppRuntime`、实时请求池与回环行情 adapter 刷新。首个可用帧写入回调后按输出顺序发送 `ESC[6n`，读取终端光标位置响应，分别记录 Node 写入完成和终端处理到查询指令的时间。输出宽高为 80×24；临时 `OHQUANT_DIR` 包含合成观察组合，未请求外部行情、模型或账户，也未写入用户配置。脚本要求 stdout 是 TTY 且终端支持光标位置回送；`--output` 必须指向尚不存在的新文件，避免重定向或覆盖改变测量条件。

五轮重复、每条件 1/10/50 个组合标的 × 成功/单慢请求/部分超时，共 **45 轮结果、完整可用帧及 ANSI 响应均符合预期**。原始结果及各条件 p50/p95、帧数、字节数在 [PTY 测量 JSON](../output/terminal-refresh-pty-ansi-2026-09-15.json)，SHA-256 `3b37845c64c46939a0b9b41a2edae9a09f265b1198f88e4ad167530237da85f0`。成功 fixture 的其余请求延迟 8 ms；单慢请求 150 ms；部分超时的慢请求 500 ms、刷新期限 250 ms。五样本 p95 为最大值，不能当作长期分布。

| 组合标的 | 条件 | 首个可用面板回调 p50 ms | 首帧写入回调 p50 ms | 首帧后 ANSI 响应 p50 / p95 ms | 最后完整帧写入回调 p95 ms |
|---:|---|---:|---:|---:|---:|
| 1 | 成功 | 26.61 | 28.77 | 31.99 / 53.88 | 52.54 |
| 1 | 单慢请求 | 23.27 | 23.21 | 24.33 / 99.64 | 171.42 |
| 1 | 部分超时 | 24.18 | 24.15 | 25.50 / 33.47 | 269.01 |
| 10 | 成功 | 21.99 | 21.94 | 30.39 / 33.81 | 60.46 |
| 10 | 单慢请求 | 23.65 | 23.61 | 25.68 / 39.06 | 179.62 |
| 10 | 部分超时 | 28.49 | 28.35 | 29.88 / 37.30 | 266.03 |
| 50 | 成功 | 20.57 | 20.51 | 22.42 / 31.99 | 191.96 |
| 50 | 单慢请求 | 16.07 | 15.86 | 17.52 / 30.36 | 178.65 |
| 50 | 部分超时 | 15.56 | 15.48 | 17.31 / 35.92 | 269.41 |

`firstPanelMs` 包含 TUI 同步绘制和 `Screen.flush()` 调用；`firstFrameWriteCallbackMs` 记录 `process.stdout.write(frame, callback)` 完成，回调偶尔在面板回调结束前发生。`firstFrameAnsiReplyMs` 是该帧之后发出的光标位置查询得到回复的时间，按有序流可确认终端已处理先前 ANSI 字节，但终端可能在像素绘制完成前回应。50 行在 80×24 视口会滚出可见范围，首个可用面板引用的报价未逐帧证明肉眼可见。最后帧时间包含剩余请求及最终状态，与首个可用时间不可相加。未测 Python 冷启动、真实供应商、用户配置、60 秒自动刷新、输入法或不同终端；F05/F21 仍是部分完成。

在 PowerShell 等原生交互终端复跑，确保新输出文件不存在：

```powershell
bun run scripts/measure-terminal-refresh.ts --output output/terminal-refresh-pty-new.json --samples 5
bun run tsc --noEmit --target ESNext --module ESNext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --strict --types bun-types scripts/measure-terminal-refresh.ts
```

独立 strict typecheck 通过。此切片仅增加测量脚本与证据，生产代码未再变更；上一节的 **1610 pass / 0 fail** 全量回归仍是最近一次生产工程验证。

## 生产 CLI 的隔离 PTY 连续路径（2026-09-18）

在 80×24 Windows PTY 中启动生产源码 CLI，`OHQUANT_DIR` 指向独立 TEMP 目录。实际键盘路径为 `/config` → A 股 AKShare → 对 `000001.SZ` 的 2026-08-19 至 09-18 日线执行 Check data → Save verified；返回 Composer 后用 `/portfolio` 创建 `PTY-Audit` 并加入 `000001.SZ`、`600519.SH`，落盘文件仅保存这两个观察标的。随后 `/doctor --tool fetch_bars --market A --schema` 可只读查询声明，`/doctor --phase data` 再次取得 23 条有效行、截至 09-18。单阶段检查的原结构化 `overall=all_pass` 只指所选 data，但 PTY 顶部曾显示 `WhyJ Doctor · all_pass`，同屏 model/tools 为 pending，容易误读成全部检查通过。

[Doctor 面板映射](../src/tui/src/panel.ts)现将这种已完成的局部通过显示为 `data pass · model+tools untested`；结构化 `overall` 和 `requestedPhases` 保持原契约。修复后的同一生产 PTY 再次显示该标题，80×24 面板测试同时覆盖局部通过和三阶段全部通过。完整 `/doctor --phase model,tools,data` 的结果为 model fail（隔离目录缺模型凭证）、tools pass（依赖检查，不代表逐端点权限）、data pass（同一公开样本），顶栏为 `partial_fail`。

向这个隔离会话提交两股 5 日动量/波动率的只读研究请求后，模型在凭证检查处返回 `Configure credentials for deepseek in /config → Model.`；JSONL 记录 `stopReason=error`、上报 0 token、0 工具调用。它验证了 Composer 到错误回执的路径，**没有**验证真实模型选工具、数值解释或完整研究任务。PTY 只确认生产 ANSI 字节和键盘行为，不证明字体像素、输入法或真实用户屏幕可见性。[脱敏运行摘要](../output/terminal-live-pty-2026-09-18.json)保存步骤、源日志 SHA-256 与边界，不复制会话原文或凭证。F04–F07 的完整视觉及有凭证研究验收继续保持部分完成。

复测局部 Doctor 面板：`bun test src/tui/test/panel.test.ts src/tui/test/doctor-navigation.test.ts src/cli/doctor.test.ts`。三文件 **42/42、490 次断言**；最终 `bun run test` **1771/1771、214 文件、22899 次断言、282.95 秒**，日志 `%TEMP%/whyj-pty-doctor-full.log`。typecheck、architecture（0 baseline violations）、build、改动文档的 205 个本地链接和 `git diff --check` 通过。仍需用有权限的模型连接复跑完整 PTY 研究与恢复，并按真实终端视觉验收 F04–F06。

## 有模型连接的生产 PTY 研究、压缩与重启恢复（2026-09-18）

沿用上一节的 80×24 Windows PTY 隔离目录和本地 `PTY-Audit` 观察组，只把工作区已保存的模型连接带入该目录。`/doctor --phase model` 在实际终端得到 **model pass，tools/data pending**。通过 Composer 输入 000001.SZ 的公开 A 股日线研究：2026-07-01 至 09-18，momentum(5)、年化波动率及最大回撤；明确当前观察、不用 `observed_before`、无账户/交易/报告。模型先用过期 `requestEntryId` 声明，被宿主拒绝，随后读取最新任务并更正声明。`compute_factor` 和 `check_risk` 各调用一次，前者从 `akshare:stock_zh_a_daily` 获得公开响应，后者复用同一不可变 revision 的缓存；`/resume --task` 在原进程显示 **complete、3 条 satisfied**。两项工具的 latest momentum 为 -0.003407155、年化波动率 0.162082437、最大回撤 -0.049871023；模型正文与核验值相符。

随后在同一 TUI 中运行 `/compact`，会话 JSONL 留下一条 compaction；用 `/exit` 正常退出、重启生产 CLI，在 `/resume` 列表选择该会话。重启后的 `/resume --task` 仍显示 complete。续问原标的、窗口、三项数值和依据时，模型正常结束并引用原 AkShare endpoint、观测时间、revision/contentHash；**续问没有新工具调用**，整份会话中因子和风险依旧各一次。退出后已从隔离目录 settings 移除临时复制的模型 API key，保留脱敏会话和[运行摘要](../output/terminal-model-recovery-2026-09-18.json)；JSONL SHA-256 为 `05E0D91772F558378CC51A3C578A5AE82A74A8800131CA9591568165366EE9A5`。

人工审阅还发现原风险工具把最长处于回撤中的 **17 个观察期**紧接最大回撤写作 `days`，模型误读为最大回撤本身持续 17 个交易日。工具文本现将最大深度与 `Longest underwater` 分行，并注明观察期口径；独立合成路径（最大深度与最长回撤持续期不同）有定向测试。这项显示修正发生在 PTY 运行之后，尚无新的真实模型回答验证措辞。回答还称 momentum(5) “适合流动性好的大盘股短线筛选”，本次只核验指标，没有验证该策略适用性。单次公开价格响应不能证明供应商长期可用或财务准确；PTY 可证明 ANSI 输出和键盘路径，不能证明目标终端的最终像素/输入法。首次配置到比较/报告的有模型完整连续流程、其它市场/模型仍未覆盖，F04–F06/F12/F18/F20 保持部分完成。

显示修正后最终 `bun run test` 为 **1774/1774、214 文件、22913 次断言、213.81 秒**；定向 59/59、类型检查、架构检查（0 baseline violations）和构建（3031 modules）通过。四份改动文档的 276 个相对文件链接可解析；隔离设置与会话文件未检出本次复制的模型 key。

## 生产 PTY 的双组合比较、自动报告与恢复（2026-09-18）

在新的 80×24 Windows PTY 和独立 `OHQUANT_DIR` 中启动生产源码 CLI，把工作区已保存的模型连接临时复制到隔离设置。通过实际 `/config` 键盘操作选择 A 股 AKShare，对 `000001.SZ` 的 2026-08-19 至 09-18 日线检查得到 23 条有效记录并保存；同一界面开启 Auto Artifacts。随后用 `/portfolio` 分别建立 Core（`000001.SZ`）和 Stable（`600519.SH`）两个观察组，关闭外部 Skills，以便只检验内建路径。请求明确指定 2026-07-01 至 09-18、`000300.SH` 基准、三者报价币种均按 CNY、买入持有、各组等权和缺成员失败；不读取账户或提交交易。

模型读取组合清单和任务状态，第一次把 goal/scope/criteria 放错 schema 层级而被拒绝，第二次更正并声明研究任务。`compare_portfolios` **只调用一次且成功**：三组共有 58 个估值日，缺失成员和日期均为 0。归档结果 Core 总收益 +15.16%、最大回撤 -4.99%；Stable +5.37%、-7.68%；基准 -9.11%、-10.26%。这些数值是这一窗口、归档样本和显式假设下的结果，不是用户持仓收益。模型最终 `stop` 并解释端点、观测时点、57 个相邻收益区间、费用/公司行动未计入等边界；正常 turn 结束后应用自动生成报告，`/resume --task` 显示 complete 和 5/5 验收项。`/clear` 后从 `/artifact` 选择该已保存版本并按 Enter，终端显示已恢复报告且上下文更新；报告 HTML 和报告 JSON 的 SHA-256 在恢复前后未改变。

浏览器用真实会话派生的报告检查 1440px 和 390px。原生成器根据标题中的首个六位代码及全局“指数/基金”文字，错误地把股票 `000001.SZ` 指到 `000001.OF` 基金页面；这不是归档的价格证据。现改为仅依据已核验数据集的标的类型与 provider endpoint 生成查阅入口；真实报告的重新生成预览显示两只 A 股的股票页面，指数不被猜成个股，390px 页面 `scrollWidth=clientWidth=390`，分享预览在手机尺寸实际可见。原保存版本保持原字节、不自动改写；修复适用于新生成的报告。细节、截图和复跑见[浏览器记录](./report-browser-audit.md#真实双组合报告的外部查阅入口2026-09-18)及[脱敏运行摘要](../output/terminal-comparison-2026-09-18.json)。浏览器唯一控制台错误是本地静态服务器的 `favicon.ico` 404。

这条连续路径涵盖实际键盘配置、公开行情、真实模型选用组合工具、自动报告和恢复，仍使用临时复制的模型连接，未验证首次账号开通和目标终端像素/输入法，也只覆盖这一个市场、模型与任务。退出后已清除隔离设置中的临时 API key，保存的会话与报告文件未检出该 key；F05/F12/F18/F20/F24 继续按 PRD 的完整验收范围保持部分完成。

外部查阅入口修复后的专项测试 **42/42、290 次断言**，全量 `bun run test` **1777/1777、215 文件、22922 次断言、227.52 秒**；typecheck、architecture（0 baseline violations）、build（3032 modules）、四份相关 Markdown 的 249 个本地文件链接与 `git diff --check` 均通过。全量日志 `%TEMP%/whyj-full-pty-comparison-full.log`。浏览器会话和本次 localhost 服务器均已关闭。

## 空配置的首次研究键盘路径（2026-09-19）

[连续任务回归](../src/tui/test/research-workflow.test.ts)从全新的隔离 `OHQUANT_DIR` 开始，在 80×24 和 120×32 两种视口通过真实按键解码、Settings 面板和 AppRuntime 依次完成：`/config` 选择自定义模型，填写模型 ID、凭证和回环端点，执行 Save & Verify；再次进入 `/config`，选择 US 市场的 financial-datasets，填写凭证/端点，Check data 得到一行有效样本后 Save verified；开启 Auto Artifacts，创建 Core/Stable 两组观察标的，提交比较请求，检查自动报告，再通过 `/clear` 和 `/artifact` 恢复同一会话。Pi 请求与数据检查走本地 HTTP/SSE fixture，组合比较使用确定性价格 adapter；模型选择、工具调用、研究状态和报告归档走生产路径。

测试先暴露一个配置反馈错误：保存新模型后 `/doctor` 的 HUD 刷新从尚未切换的 agent 状态读回旧模型 ID，界面显示与持久化配置不一致。[AppRuntime](../src/app-runtime.ts)现在记录已保存的选择；空闲时显示下一次请求将使用的模型，并在连接变更时清除旧连接的上下文/延迟指标。若运行中保存连接变更，清理延至下次请求开始。连续任务分别检查 Save & Verify 之后和实际 Pi 比较请求之后的模型显示，既有 HUD 回归覆盖运行中连接修改和后续请求。模型 Doctor 不会触发行情刷新；数据检查成功仍需要显式 Save verified。

复跑：`bun test src/app-hud.test.ts src/tui/test/research-workflow.test.ts src/tui/test/settings-refresh.test.ts src/app-runtime.test.ts`。四文件 **53/53、226 次断言**；两种视口的首次配置、比较和恢复各跑一次。全量测试还暴露旧 Doctor 异常测试的 `mock.module` 覆盖会泄漏到后续文件，使这两条流程误收模拟失败；[Doctor handler](../src/cli/handlers/system.ts)现可按实例注入诊断函数，异常测试不再修改全局模块。按旧测试文件→连续任务文件的顺序复跑 **21/21、142 次断言**。此测试证明应用内从空设置完成键盘路径，尚不证明真实账户开通、真实供应商长期可用、目标终端像素或输入法；F05 保持部分完成。

最终 `bun run test` **1796/1796、220 文件、23078 次断言**，日志 `%TEMP%/ohq-first-run-full-verified-2026-09-19.log`；`bun run typecheck`、`bun run check:architecture`（0 baseline violations）、`bun run build`（3037 modules）及构建产物 `--help` 通过。

## 窄屏状态栏字段完整性（2026-09-19）

对照 [terminal.png](./assets/terminal.png) 与 60×20、80×24、120×32 的实际 QuantTui 缓冲区，发现原状态栏按字符顺序裁剪，60 列旧样本末尾把 `No portfolios` 画成 `No p…`，长模型 ID 还会挤掉上下文和延迟指标。[状态栏绘制](../src/tui/src/chrome.ts)现在先限制模型标签的最大宽度并明确用省略号表示，再按完整字段决定是否展示上下文、TTFT、TPOT、轮次、数据源和观察组；不足一整个字段的内容不落笔。窄屏可优先读到会话状态，宽屏仍保留完整来源/观察组。

[新画面与原始 ANSI](../output/terminal-audit-hud-2026-09-19/index.html)包含 54 帧、三种尺寸和各面板状态；[60 列研究画面](../output/playwright/terminal-audit-hud-2026-09-19/60x20-research-red-up.png)与[80 列研究画面](../output/playwright/terminal-audit-hud-2026-09-19/80x24-research-red-up.png)用本地浏览器检查了截断结果。60 列示例展示完整的 `fixture` 数据源而不出现半个观察组；80 列同时展示完整的 `No portfolios`。运行 `bun test src/tui/test/render.test.ts src/tui/test/hud-settings.test.ts`，定向 **67/67**，覆盖 60 列指标与超长模型 ID。SVG/浏览器是单元格投影，尚未核对目标终端的字体、像素和输入法；F04/F05/F06 继续保持部分完成。

最终 `bun run test` **1800/1800、220 文件、23103 次断言**，日志 `%TEMP%/ohq-status-responsive-full-2026-09-19.log`；typecheck、architecture（0 baseline violations）、build（3039 modules）、构建产物 `--help`、改动文档的本地文件链接及 `git diff --check` 通过。本地预览服务和浏览器进程均已关闭。

## F05–F07 本地验收收口（2026-10-09）

按 [PRD 的完成度口径](./PRD.md#2-完成度口径)重新核对后，F05、F06、F07 更新为已完成。F05 已覆盖空配置下 80×24/120×32 的模型与数据验证、建组、比较、自动报告和恢复，60×20 有固定收缩策略；生产 PTY 另覆盖公开行情、真实模型研究、压缩重启、双组合比较和报告恢复。获取中、陈旧、失败、空数据、局部结果与慢输出整帧合并均有独立状态或回归。

F06 的品牌金色、涨跌约定、风险/状态色、零值与缺失值已经由共享语义 token 驱动；TUI、Overview、报告、K 线/ECharts 和静态回退均有两套涨跌约定、深浅主题或多尺寸覆盖，数字仍保留符号或文字。F07 的十个公开 slash 命令已统一名称、说明、参数、空态、Tab 建议与帮助，词法、预检、子模式、版本、离线帮助、schema 查询、安装版签名差异和生产 PTY 路径均有验证。

物理终端的字体渲染、像素对照与输入法仍是 F04 的独立视觉验收范围；真实供应商权限和模型解释质量分别由 F08/F12/F24 跟踪，不再重复作为布局、颜色或命令契约的未完成条件。当前工程基线为 `bun run test` **1878/1878、224 个文件、23789 次断言**；typecheck、architecture（0 baseline violations）、test fence 与生产构建通过，构建为 **3052 modules、7.1 MB**。
