# Changelog

## [1.3.1] - 2026-10-12

- 修复桌面窗口缩小或调整字号后，终端底部状态栏可能被裁切的问题；安装验收新增终端边界检查。

## [1.3.0] - 2026-10-12

- 新增 Electron Windows x64 桌面版与当前用户一键 NSIS 安装包，共用 CLI 的 TUI、命令、配置、报告及研究运行时。
- 内置独立 Bun CLI、Python 3.13.12、AKShare 1.18.63、AKQuant、精选技能的 Python 依赖和 MinGit；运行包与个人数据分开存放，升级保留数据。
- 支持中文剪贴板、多行粘贴、字号调整、窗口状态保存和退出时的子进程清理。
- 修复多行粘贴会立即执行换行内容的问题；粘贴先进入 Composer，按 Enter 才提交。
- 修复从任意工作目录启动时的版本号读取，以及干净安装缺少 yaml/ignore 依赖的问题。
- 新增 Windows 构建、实际安装包交互验收和 SHA-256 产物工作流。完整验收证据随 Release 记录。

## [1.2.0] - 2026-07-15

### Added

- 新增量化研究 Dashboard：内置 K 线/成交量/MACD、NAV 与收益曲线、风险收益指标、因子图、数据覆盖度和会话统计；图表颜色与 WhyJ TUI 主题 token 保持一致。
- 新增完整 Trajectory 复原：按 Turn 统计 calls、returns、skills 和 outputs，保留用户/模型输入、assistant 输出、thinking、compact、Tool/Bash/Skill 名称、Call ID、调用参数、完整返回与源 JSONL 定位信息。
- 新增 Artifact 自动生成配置。`/config` 中开启 `Auto Artifacts` 后，量化分析 turn 在 `agent_end` 持久化完成后生成 Dashboard + Trajectory，并自动打开浏览器预览。
- 新增研究对象标题推断，报告标题优先使用名称与证券/基金代码；无法识别时使用中性的“量化研究报告”。
- 新增 Artifact 恢复索引和上下文 note，使恢复后的 agent 能继续理解“这个报告”或“刚才的 artifact”。

### Changed

- `/artifact` 收敛为无参数的一级命令，只负责浏览、恢复和打开已有报告；生成模式不再作为 Slash Command 的二级选项。
- Settings 按 `Agent Runtime`、`Research Data`、`Workspace Experience` 三组规整；面板说明与操作提示进一步精简并增加可读间距。
- Codex、Claude、Agents 与 pi 的用户级 skill 集成合并为单一 `External Skills` 开关，项目量化 skills 始终可用。
- Slash command 目录、Composer 建议、Help 与 CLI 帮助共享统一 catalog，公开描述保持短而一致。
- Agent 的证券、基金与组合研究流程内置技术因子和风险指标要求；有有效收益序列时保留波动率、VaR/CVaR、最大回撤、偏度、峰度与风险调整收益，供 Dashboard 解析。
- Source provider 改为可注入 adapter 和分层 fallback；AKShare 普通 A 股日线依次尝试东方财富、新浪、腾讯，上层仍可继续降级到 Tushare。

### Fixed

- 修复 Overview 刷新失败或超时后长期停留在 `refreshing` 的问题；刷新状态可恢复，过期请求结果不会覆盖较新的数据，并保留最近一次成功面板。
- 修复组合中的开放式基金被误判为交易所证券、只得到全零行情的问题；基金代码会保留 `.OF` provider 语义，无有效数据时显示 `--`。
- 修复 Artifact 恢复时来源 session 已不存在仍继续打开的问题；报告列表和恢复前都会校验并删除孤立 HTML/metadata。
- 修复 resume 后 TUI 结构化表格和工具输出丢失，以及 Artifact Trajectory 未完整展示 Tool、Bash、Skill 调用及返回细节的问题。
- 修复报告标题沿用用户第一句话、K 线缺失或误用 Trajectory 数据生成金融图表等问题。

### Verification

- 覆盖 Artifact 生成/恢复/孤立报告清理、Trajectory schema 兼容、K 线渲染、开放式基金报价、Overview 超时恢复与竞态保护的回归测试。
- 发布前执行 `bun run test`、`bun run typecheck`、`bun run check:architecture`、`bun run build` 与 npm pack dry-run。

## [1.1.2] - 2026-07-10

### Changed

- 底部 HUD 简化为 Ctx、TTFT、TPOT、T 四项核心指标，移除冗长的阶段级 trace 展示。
- TTFT 与 TPOT 统计口径调整为跨会话多轮的平均值，不再按单轮重新计数。
- HUD 文案间距与分隔符收紧，整体观感更接近专业终端状态栏。

### Removed

- 移除详细链路状态行及其配置开关，不再显示 Ctx/Sys/LLM/Auth/Pack/Net/1st/HTTP 等内部阶段占位。
- 清理与阶段级 latency trace 相关的运行时状态、渲染逻辑和测试分支。

## [0.1.0] - 2026-06-25

首个重新梳理后的 WhyJ Quant 版本。本版本按当前 TypeScript/Bun 代码线重新定义为新的 `v0.1.0`，旧发布记录不再作为当前发布口径。

### Added

- 交互式量化分析终端：`whyj` 启动全屏 TUI，支持自然语言提问、slash commands、状态栏、组合面板、历史会话恢复和结构化输出渲染。
- Shell 入口与 one-shot 模式：支持 `whyj --help`、`whyj -c "/help"`、`whyj --json doctor` 和 `whyj --json -c "/portfolio"`。
- `.ohquant/` 本地存储体系：统一管理 settings、行情缓存、组合状态、session JSONL、artifact 输出和恢复索引。
- AI Agent runtime：接入 pi agent core/harness，支持 streaming、工具调用展示、session 持久化、resume、compact、system prompt skills block 和本地 skill runtime。
- Provider 与认证体系：支持 Anthropic Messages、OpenAI-compatible 等模型 provider 路由，并统一 API key、base URL、auth token 与行情 source credential 的读取逻辑。
- 数据源模块：提供 AKShare、Tushare、Financial Datasets、LLMQuant 等 source adapters，以及显式 source 参数、fallback flow 和 provider smoke test。
- 内置量化工具：注册 `Quant.Factor`、`Quant.Backtest`、`Quant.Risk`、`Quant.Benchmark` 与数据工具，覆盖因子、回测、风险、benchmark 和组合对比工作流。
- Portfolio 与 Insight 工作流：支持本地组合面板、基金分组、自动分类、组合对比、投资格言生成与思考区提示。
- Artifact 模块：可从 session JSONL 生成双栏 HTML 分析 dashboard，并包含敏感信息 redaction、轨迹渲染和测试样例。
- Doctor 诊断：新增 `/doctor` 和 `whyj --json doctor`，检查 runtime、配置目录、auth 来源，并输出安全的修复 hints。
- 文档体系：补充 agent loop、CLI、doctor、storage policy、source providers、built-in tool registry、quant tools、TUI layout/table/chart render、artifact design 等设计文档。

### Changed

- 代码线重新定义为 TypeScript + Bun + frame-buffer TUI，旧 Python/skills 原型和旧 Ink/React UI 不再作为当前发布基础。
- CLI command registry、TUI panel、storage、source、quant、agent harness 按模块边界重构，减少 legacy bridge、MCP adapter 和旧 service implementation。
- 配置从散落的 `.env`/旧 config 口径收敛到 `.ohquant/settings.json`，同时支持配置面板与 JSON 输出中的 secret redaction。
- TUI 渲染契约更新为结构化 text/table/chart/skill-call 展示，改善 CJK 宽度、分隔线表格、图表颜色、工具调用预览和面板 loading 状态。
- README 与中文文档改为描述当前可用的 `whyj` 安装、启动、配置、commands、JSON policy 与架构入口。

### Fixed

- 修复 provider routing：显式 source 参数不再被 fallback chain 覆盖，Anthropic/OpenAI-compatible endpoint 路由和认证来源保持一致。
- 修复 session persistence 与 resume 进度同步，减少恢复历史会话时的状态错乱。
- 修复 TUI doctor 输出、panel rendering、divider-only table parsing、figure/chart rendering、组合状态栏数据源标签和 agent busy guard 等交互问题。
- 修复 one-shot 与 TUI doctor 输出不一致，统一 JSON envelope 和人类可读输出路径。

### Release Notes

- npm 包名：`whyj-quant`
- CLI binary：`whyj`
- 首发版本：`0.1.0`
