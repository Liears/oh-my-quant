# GOALS → PRD 核验记录

> 历史盘点：以下记录修复前的现场。后续 R01 已修复回测权益和 CAGR，并通过独立账本回归；当前状态见 [实施记录](./feature-delivery.md)，下文原始输出不改写。

日期：2026-09-14。对象：当前 Windows/Bun 工作区，包含未提交代码。本次交付是需求细化、功能盘点、文档整理与项目演示；未在本轮实现 PRD 中尚缺的量化功能。

## 来源与范围

核对 [最新原始 GOALS](./archive/goals-input-2026-09-14.md)，并保留 [更早输入](./archive/goals-original-2026-09-14.md) 和 [旧路线](./archive/refactor-roadmap-before-prd.md)。最新输入新增了刷新及时性、文档分类与 slides；均纳入本次交付，不被旧稿覆盖。

PRD 按用户目标拆为 F01–F24，F25 保留旧路线的 alpha/akquant，F26/F27 是文档与演示。采用“已完成 / 部分完成 / 有缺陷 / 未实现”，不使用未经定义的整体完成百分比。

## 原始要求覆盖

| GOALS 中的要求 | PRD 定位 | 当前判断依据 |
|---|---|---|
| 交互选 model/key、Pi 引导和同一配置 | F01 | model-config、ModelSettingsPanel、模型验收；API-key 引导已交付，OAuth/文件互通未交付 |
| 金融 tools/API key 引导 | F02 | Settings 已有数据源/token；未完成市场/依赖/权限全流程 |
| 自动 perf、TTFT/TPOT、context HUD 设置 | F03 | hud.ts、perf.ts；已有观测，无自动固定基准 |
| terminal.png、皮肤、面板、字体 | F04 | 参考图、DESIGN、theme-colors；全界面一致性未验收 |
| quant 日常工作布局 | F05 | Analyzing/Overview/Composer；比较入口阻断完整任务 |
| 金色、间隔、淡色和涨跌红绿 | F06 | 共用 styles；设计金色与代码不同，行情红绿约定未统一 |
| slash 简化，每个与 quant 术语相关 | F07 | 10 个 catalog 命令；命名范围仍需决定，未接通能力不能先公开 |
| 可靠、分级、自动取数 | F08 | analysis-data、source/runtime、缓存；线上跨市场矩阵仍缺 |
| 更快刷新、来源追溯、及时且无错误信息 | F08、F21 | 同日修订/TTL/窗口/代次/取消已覆盖；速度与规模基线、快照一致性待补 |
| 自动组合管理与对比 | F09–F10 | CRUD 已交付；比较函数存在，入口实测 Unknown |
| yhoo 情绪与走势、针对性调整 | F11 | 暂按 Yahoo 理解并保留来源决策；无已接通链路 |
| 典型因子和技术指标、针对性调整 | F12–F13 | 六类因子和风险工具；任务效果未基线化，数值反例已复现 |
| 自动 artifacts、分析师年报、大师观点 | F14–F15 | 本地报告恢复已接入；周期/年度模板/引用核验仍缺 |
| 拓展实盘工具 | F16 | 注册表无订单/账户适配；提出模拟、幂等和授权验收 |
| extensions、可选插件、内聚与插拔 | F17、F19 | 当前静态 registry 与部分依赖注入；无扩展宿主 |
| 参考 coding harness，强化 quant runtime | F18 | 当前 Pi loop + WhyJ session-runtime；独立任务/证据契约待实施 |
| loop/goal/tool/skill/data 的 Harness | F18、F20、F23–F24 | Quant Harness 分别定义所有者、研究完成判据、能力装配与数据引用 |
| 每个模块改进说明 quant 场景意义 | F18–F24 | PRD 验收及 Harness“所有者与量化意义”“待实施契约”两表 |
| 持久化、及时性、context、portfolio 关键性 | F20–F22 | JSONL、公开缓存、观察组合白名单；语义恢复/并发写入待补 |
| 自动嵌入著名 quant skills | F23 | 两个默认 repo、10 个白名单名称；静默失败、同步 clone、无锁版仍有缺口 |
| system prompt、工具管理注册、明确 tools/skills 功能 | F24 | 静态 registry、skill 索引、手写 prompt；依赖就绪/任务装配和效果评测待补 |
| 合并重复文档、移出过时设计、三类组织 | F26 | README 三类入口；两个合并设计；四份旧正文归档与导航页 |
| 有吸引力的 slides：产品、决策、实现、认知与错误 | F27 | slides.html 12 页，含参考图、边界图、数值反例、规划标记和证据链接 |
| 旧路线的 alpha/akquant | F25 | 单列历史来源；没有 src/alpha，不误称当前内置能力 |

## 实测反例与能力盘点

以下为本轮再次执行的无外部请求探针，直接导入当前函数：

```powershell
@'
import { vectorizedBacktest, report } from './src/quant/backtest.ts';
import { listBuiltinToolRegistrations } from './src/tools/registry.ts';
import { executeCommand, parseCommand } from './src/cli/registry.ts';
console.log(vectorizedBacktest([1,1,1], [100,100,110], 100000, 0, 0).equity);
console.log(report([0.1,-0.1]));
console.log(['data','quant','system'].map(d => [d,listBuiltinToolRegistrations(d).length]));
console.log(await executeCommand(parseCommand('/compare run --rule volatility --threshold 0.25')));
'@ | bun run -
```

| 探针 | 本轮输出 | 判断 |
|---|---|---|
| 回测权益 | [100000,100000,111000.00000000001] | 零费用，1000 股从 100 涨至 110 应增加 10000，末值 110000；F13 有缺陷 |
| +10% / -10% | totalReturn 约 -0.01，cagr 0 | 算术平均收益年化不能充当复利 CAGR；需定义时长与独立账本 |
| 内置工具 | data 88、quant 6、system 1 | 静态注册共 95 项，不等于插件数或依赖已齐备 |
| /compare | success false，Unknown /compare | compareHandler 文件与纯计算核心存在不能证明公开入口完成 |

本次仅记录 F13 缺陷与优先级，未改回测实现。示例不是收益承诺。相关源码：[回测](../src/quant/backtest.ts)、[工具注册](../src/tools/registry.ts)、[命令注册](../src/cli/registry.ts)、[比较核心](../src/quant/comparison.ts)。

## 文档合并与纠偏

| 旧问题 | 本次处理 |
|---|---|
| 系统规格与 context 文档重复讲执行路径、队列、压缩 | 合并为 quant-harness.md；底层生命周期仍由 pi-agent-loop-harness.md 维护 |
| CLI 设计重复命令表，旧 phase 与当前一级 catalog 冲突 | 合并设计到 quant-uiux.md，完整行为只维护 slash-commands.md |
| TUI 布局旧字段与当前统一设置不一致 | 合并现行布局/数据状态契约，行列常量指向代码，历史正文归档 |
| 旧 roadmap 混用历史完成记录与当前待办 | 原稿归档；当前 roadmap 只列实施切片与依赖 |
| 存储文档说 key 为“脱敏认证引用” | 改为保存明文凭证、展示脱敏；不误称加密存储 |
| 组合比较被称为 Quant.Benchmark 已接通功能 | 改为存储 API 存在、公开比较入口缺失 |
| 离线 session 窗口被说成来自 Pi getModels | 改为 storage 本地表/回退；与活动连接窗口不同 |
| 报告被说成固定最近 50 条、完全幂等、无私密内容 | 改为实际 entries 派生，可用缓存影响重建，生成元数据可变，可能复制用户私密输入 |
| 旧设计“启发式 compact 不消耗 LLM” | 新规范明确压缩调用模型，历史说法不再定义当前行为 |

历史文件保留以免丢失设计缘由和未提交改动；四个旧入口仅保留短导航，不继续维护第二份规范。Artifact/Doctor 的长篇历史详细设计在索引中标明混合方案属性；当前行为以合并设计及配置/命令参考为准。

## 本轮验证

- 已重跑默认测试：初次 690 pass / 1 fail，失败为目录测试仍要求旧 CLI 设计重复全部命令。调整其被检查文档为 README 与现行 slash-commands，保留每个命令名称/描述和 Artifact 参数边界的断言。
- 调整后 `bun run test`：**691 pass / 0 fail，80 文件，5590 次断言**，包含 test fence。本机日志为 `%TEMP%/whyj-prd-tests-final.log`。
- 数值、注册数量和未知比较命令探针结果如上。全量测试通过不抵消独立数值反例。
- 文档路径检查覆盖 README、docs 下 Markdown/HTML 与归档，共 35 个文件，未发现不存在的本地链接目标；页内导航另由浏览器交互检查，不把路径存在当成外部链接有效。
- 独立读者按 8 个问题复核原始目标、当前能力、Pi 兼容、组合边界、数值证据、优先级、文档所有权及 slides。发现并补齐数据分级、Pi 互通验收、跨币种口径和依赖，第二次复核通过。
- slides 在 Chromium 检查 1440×900 和 390×844 的全部 12 页：每次仅显示一页，无横向溢出，图片加载正常；窄屏纵向滚动。按钮、选择器、方向键、Home/End 与 N/备注开关符合预期。检查封面、反例页和窄屏截图，移除 favicon 404 请求。
- 打印模式显示全部 12 页；生成 PDF 并核对实际 12 个 page 对象。演示稿自身内联 CSS/JS，参考图随 docs/assets 保存；这份演示稿不依赖 ECharts，与产品生成的金融报告区别开。
- 本地浏览器检查经 localhost 静态预览服务完成，结束后关闭服务与浏览器。自动化工具阻止 file 协议导航，因此未声称完成本地 file URL 的自动化检查。检查产物保留于 `output/playwright/`：封面、数值反例、窄屏截图及 12 页 PDF；浏览器记录位于 `.playwright-cli/`。
- `git diff --check` 通过。本轮仅变更文档/演示稿及命令目录测试的文档引用，未改产品运行代码。

此前类型/架构/构建证据见 [模型验收](./model-config-audit.md)，此前真实 AKShare 样本见 [数据验收](./core-data-audit.md)。不将旧日期、旧测试数或样本结果改称本轮线上验证。本轮未调用真实模型账户或真实市场数据。
