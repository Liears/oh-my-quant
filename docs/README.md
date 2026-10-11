# WhyJ Quant 文档导航

更新：2026-09-14。按 **产品与交付、Quant Harness、Quant UI/UX** 三类组织。GOALS 原文列出后两类，第一类承载需求、路线、验收和项目表达。状态只在 [PRD](./PRD.md) 维护；代码、测试和带日期的运行证据优先于旧设计中的完成声明。

## 1. 产品与交付

| 文档 | 用途 / 阅读边界 |
|---|---|
| [项目 README](../README.md) | 启动、使用示例和项目简介 |
| [GOALS](./GOALS.md) | 目标来源与稳定特性 ID，不重复状态表 |
| [PRD](./PRD.md) | 27 项特性的已有、缺口、验收及依赖；含本次文档交付 |
| [Roadmap](./roadmap.md) | 下一轮实施切片，非已交付清单 |
| [功能实施记录](./feature-delivery.md) | F01–F25 的实施决策、已完成切片与验证证据 |
| [Slides](./slides.html) | 产品、技术决策和踩坑分享；参考图与规划有标记 |
| [本轮核验](./prd-audit.md) | GOALS 映射、代码反例、文档合并和验证范围 |
| [数据验收](./core-data-audit.md) | 2026-09-13 的数据/组合/内核证据，真实 AKShare 仅限记录的样本 |
| [模型验收](./model-config-audit.md) | 2026-09-14 的 API-key 引导与请求隔离；不代表真实账户或 OAuth 已验收 |
| [Pi 配置导入](./pi-config-import.md) | 选定 API-key 连接的预览/版本核对/导入，原生与自定义模型映射；OAuth 和完整字段兼容待补 |
| [模型性能测试](./model-performance.md) | 固定输入基准、TTFT/TPOT 与分位数、HUD/压缩阈值设置；区别请求时延与完整研究任务 |
| [Pi 量化生态](./pi-quant-ecosystem.md) | 外部插件功能、CLI 对比和开发参考；不代表已安装进本产品，本轮未刷新外部来源 |
| [投资笔记](../notes/README.md) | 投资原则与 insight 素材，不能当成年度报告引擎 |
| [变更记录](../CHANGELOG.md) | 按版本追溯发布说明；当前工作区不等于发布版本 |

## 2. Quant Harness

从 [Quant Harness 设计](./quant-harness.md) 开始，覆盖 loop、研究 goal、context、tool、skill、data 和扩展边界；待实施契约单独标注。

| 专题 | 用途 / 阅读边界 |
|---|---|
| [模块架构](./module-architecture.md) | 代码地图、依赖方向和入口 |
| [Pi 内核与会话适配](./pi-agent-loop-harness.md) | 精确依赖、操作生命周期、取消、恢复与升级检查 |
| [研究状态与恢复](./research-state.md) | 分支参数/证据投影、压缩后恢复、未完成项与复跑方式 |
| [结构化研究任务](./research-tasks.md) | 宿主/普通输入声明、证据验收、重试关联与只读任务面板 |
| [研究任务评测](./research-task-evaluation.md) | 四类固定工具链矩阵、真实模型加合成数据的评测入口、失败样本和回答审阅；自动检查不替代完整语义验收 |
| [LLMQuant Skill 评测](./skill-evaluation.md) | 五个真实 Pi 显式 skill 入口、21 个 reviewed workflow 选择、受限用户证据与时间边界；受限模式不等于完整插件质量 |
| [Session 依赖注入](./session-dependencies.md) | 模型、工具、skills、repo 与 prompt/证据端口，连接快照及独立替换测试 |
| [扩展宿主](./extensions.md) | WhyJ API 1、默认 CLI 管理、启停持久化、开发接入、动态工具/skills/capabilities；静态模块分发 |
| [执行接口](./execution.md) | paper/live、账户/订单/成交端口、预检/授权/幂等及取消契约；合成验证，实际执行服务待接入 |
| [Alpha / AKQuant](./alpha-backtest.md) | 默认三工具、固定 Bars、外部引擎、成交/净值核验、归档及报告恢复；真实 Pi + wheel 合成链路与测试方法 |
| [工具注册表](./builtin-tool-registry.md) | 当前静态内置 registry；不等于插件宿主 |
| [量化工具设计](./quant-tools-design.md) | 工具输入输出、回测账本与指标假设；数值验收见实施记录 R01 |
| [观察组合比较](./portfolio-comparison.md) | Agent 组合编辑、币种/权重/同日对齐、历史重算与离线/真实服务验证 |
| [年度研究报告](./annual-reports.md) | 年度/YTD 区间、组合版本、原始数据核对、观点出处及离线历史报告；真实账户业绩和决策历史尚未接入 |
| [新闻研究](./news-research.md) | 新闻来源/时间/去重、标题情绪初筛、价格证据与条件化建议；测试及真实市场覆盖边界 |
| [存储策略](./ohquant-storage-policy.md) | 配置、公开缓存、制品、组合元数据与私有状态边界 |
| [数据源](./source-data-providers.md) | provider 实现与外部资源索引；附录列名不等于已接入 |
| [Skill 系统](./trader-skills.md) | 发现/安装机制和候选生态；安装、发现和依赖可用分别判断 |
| [Artifact 历史详细设计](./artifacts-design.md) | 混合已实现和拟议的 recorder/DAG/插件接口；现行链路以 Quant Harness、配置/命令参考和代码为准 |
| [Agent 模块](../src/agent/README.md) / [Source 模块](../src/source/README.md) / [Storage 模块](../src/storage/README.md) / [Artifact 模块](../src/artifact/README.md) | 代码附近的模块指南，不维护产品完成状态 |

## 3. Quant UI/UX

从 [Quant UI/UX 设计](./quant-uiux.md) 开始，覆盖场景、布局、命令边界、数据状态与报告体验。

| 专题 | 用途 / 阅读边界 |
|---|---|
| [配置参考](./configuration.md) | 当前字段、默认值、模型引导、保存与验证 |
| [Slash 命令参考](./slash-commands.md) | 当前命令、参数、TUI/非 TUI 结果；命令行为唯一正文 |
| [DESIGN](../DESIGN.md) / [终端参考图](./assets/terminal.png) | 品牌与视觉依据；共享 token 已统一，全界面视觉验收状态见 PRD F04/F06 |
| [表格与图表渲染](./tui-table-chart-render.md) | 输出结构与渲染细节，不能证明模型每次都遵守提示 |
| [Doctor 历史详细设计](./doctor-design-and-hints.md) | 历史交互与方案细节；当前字段/行为以配置和命令参考为准 |
| [TUI 模块](../src/tui/README.md) | frame-buffer 代码与测试入口 |

## 合并与历史记录

四份重复设计正文已退出现行规范，只保留短导航页以维持旧链接：

| 旧入口 | 当前归属 | 历史快照 |
|---|---|---|
| agent-system-spec.md | Quant Harness | [原系统规格](./archive/agent-system-spec-before-prd.md) |
| agent-loop-context.md | Quant Harness | [原上下文](./archive/agent-loop-context-before-prd.md) |
| interactive-cli-design.md | Quant UI/UX + Slash 参考 | [原 CLI 设计](./archive/interactive-cli-design-before-prd.md) |
| tui-layout-design.md | Quant UI/UX | [原布局](./archive/tui-layout-design-before-prd.md) |
| roadmap.md 旧重构计划 | PRD + 当前 roadmap | [原路线](./archive/refactor-roadmap-before-prd.md) |
| GOALS 原始记录 | 整理后的 GOALS + PRD | [初始输入](./archive/goals-original-2026-09-14.md)、[补充后输入](./archive/goals-input-2026-09-14.md) |

只读历史中的代码行号、旧版依赖、测试数和完成勾选不代表当前状态。保留历史证据，不复制为新规范；未实现但仍有价值的要求进入 PRD，而不是在清理时丢失。

## 更新规则

产品范围/状态改 PRD，实施顺序改 roadmap，用户字段/命令改各自参考，技术边界改对应 Harness/UIUX 专题。修改行为时附相关代码与测试/运行证据，再更新完成度。文件合并先迁移有效契约、修正失效声明，再维护链接；验收记录保留原日期和验证范围。
