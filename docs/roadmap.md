# WhyJ Quant Refactor Roadmap

本文档记录当前代码库按模块分析后的简化、解耦和多 agent 协作路线。目标不是重写系统，而是用小 PR 逐步降低冲突面、反向依赖和单文件复杂度。

## 优先级定义

- P0: 先收紧模块边界和 public API，阻止新增反向依赖、跨层 import 和 `.ohquant` 路径散落；这些是后续单模块维护的前置条件。
- P1: 把核心功能代码抽到可单测的 service/core 模块，让 CLI/TUI/Agent tools 变成薄 adapter；这些是近期主要重构。
- P2: 在边界稳定后拆大文件内部结构、收窄测试辅助、整理 barrel exports；目标是降低长期冲突面。
- P3: 可暂缓；只有当对应模块继续增长、性能瓶颈出现或新需求真正落地时再动。

## 当前证据

- 最大冲突文件集中在 `src/source/src/akshare.ts`、`src/app-runtime.ts`、`src/tools/akshare-fund-tools.ts`、`src/tools/data-tools.ts`、`src/tools/quant-tools.ts`、`src/tui/src/render-lines.ts`、`src/tui/src/panel.ts`。
- 已有架构文档要求 `.ohquant` 文件系统规则由 `storage` 持有，但 `tools/quant-tools.ts`、`tui/watchlist.ts`、`quant/insight.ts` 仍有直接路径逻辑。
- 当前导入图剩余反向依赖或高耦合边：`storage->agent`、`storage->quant`、`tui->cli/storage/tools/quant`；`types->cli` 和 `skill->cli` 的命令契约边已在首批收紧中修复。
- 多处动态导入用于普通业务路径：`src/tools/quant-tools.ts`、`src/cli/params.ts`、`src/index.ts`、`src/cli/handlers/watchlist.ts`、`src/cli/handlers/system.ts`、`src/storage/src/bars.ts`。测试中的 cache-busting 动态导入可另行处理。
- `src/storage/README.md` 把 `storage -> agent` 描述为 deliberate dependency，但 `docs/module-architecture.md` 的推荐方向是 `storage -> types`。roadmap 必须先解决这个契约冲突，再决定代码迁移。
- `src/tui/src/tui.ts` 仍直接依赖 agent skill discovery、`NodeExecutionEnv`、`skillPaths` 和 `loadSettings`；`render-lines` 经 `tools/catalog.ts` 加载完整 registry 的问题已由 `src/tools/display.ts` 修复。
- `src/artifact/src/generator.ts` 与 `src/artifact/src/trajectory.ts` 的循环依赖已修复；`src/quant/index.ts` wildcard re-export 带 storage/fs 边界模块的问题仍待收口。
- `src/storage/src/dirs.ts` 的 import-time path constants 与 runtime resolver 混用，且 `.ohquant/portfolio/` 被 policy 标为 forbidden 后仍有 steady-state 读取路径。
- 仓库当前没有 `src/alpha` 或 `akquant` 接入点；alpha/akquant 是已确认的新需求，但应以 spike 和 adapter 边界进入，不应继续塞进 `tools/quant-tools.ts`。

## 模块收紧原则

- 每个模块只暴露一个稳定 public surface。跨模块调用优先走 `src/{module}/index.ts` 的显式 export；低层 helper 不通过 barrel 暴露给 UI/tool/CLI。
- Core 不认识 UI。`quant`、`source`、`runtime service`、`artifact pipeline` 只接收 DTO、配置和依赖注入，不导入 TUI、CLI、Agent session 或 storage 路径常量。
- Adapter 只做翻译。CLI handler、TUI controller、Agent tool 负责参数解析、展示文案和调用 service，不持有算法、文件路径和 provider fallback 逻辑。
- Storage 独占 `.ohquant` 文件系统布局。除 storage 和明确的迁移脚本外，其他模块不得手工拼 `.ohquant` 路径。
- Registry 只注册，不承载业务。`tools/registry.ts`、`tools/catalog.ts`、`cli/registry.ts`、`storage/index.ts`、`quant/index.ts` 都必须保持薄入口。
- 新能力先定义边界再落代码。`alpha/akquant` 先做 adapter spike 和 DTO，不把实验逻辑塞进既有 `quant-tools.ts`。

## 已落地

2026-06-30 首批模块收紧已完成：

- Command contract 下沉到 `src/types/commands.ts`；`src/cli/types.ts` 只做 re-export，`src/types/messages.ts`、`src/skill/handler.ts`、`src/app-runtime.ts` 不再依赖 CLI 类型实现。
- Tool display metadata 拆到 `src/tools/display.ts`；`src/tools/catalog.ts` 可为 TUI/runtime 提供展示格式化而不加载完整 `src/tools/registry.ts`。
- Artifact 文本提取 helper 拆到 `src/artifact/src/message-text.ts`；`trajectory.ts` 不再从 `generator.ts` 导入，消除 generator/trajectory 循环依赖。
- Architecture boundary gate 新增 `scripts/check-architecture.ts`、`scripts/architecture-boundary-baseline.json` 和 `bun run check:architecture`；当前 baseline 只允许既有违规，新增跨层 import 或 storage 外 `.ohquant` 路径构造会失败。
- 首批代码验证已跑：`bun run typecheck`、`bun test src/`；boundary gate 本轮验证已跑：`bun run check:architecture`、`bun run typecheck`。

剩余 P0：public API surface 收口、storage ownership/path resolver。完成这些后再进入 runtime/TUI/agent/quant/source 的 P1 core/service 抽取。

## P0 路线

| 模块 | 状态 | 问题 | 建议 | 验收标准 |
| --- | --- | --- | --- | --- |
| 架构约束 | 已完成 | 没有自动边界检查；后续拆模块时很容易新增反向依赖。 | 已新增 `bun run check:architecture`，按 layer 定义 baseline，只阻止新增违规；每个 PR 删除自己修掉的 baseline 项。 | gate 能报告新增违规导入和 storage 外 `.ohquant` 路径构造；P0/P1 PR 不新增 baseline。 |
| Public API 收口 | 进行中 | `storage/index.ts`、`quant/index.ts`、`source/index.ts`、`tools/catalog.ts` 暴露或加载过多内部实现。 | 先定义 public/internal export 规则；barrel 只显式导出稳定 API，internal helper 只能被本模块引用。 | UI/tool/CLI 不能通过 barrel 拿到底层 path helper、deprecated portfolio API 或带 IO 的 quant 模块。 |
| 命令契约 | 已完成 | `types -> cli`、`skill -> cli`、`cli/types -> agent` 让低层契约依赖上层实现。 | 将 `CommandResult`、`CommandContext` 的纯 DTO 下沉到 `src/types/commands.ts`；agent session 只留在 runtime/CLI adapter。 | `src/types/**` 不导入 `src/cli/**`；`src/skill/**` 不导入 `src/cli/types.ts`；command DTO 不导入 agent 实现。 |
| Storage 边界 | 待做 | `.ohquant` 路径、portfolio legacy 读取、benchmark persistence 分散在 tools/TUI/quant/runtime。 | 统一 resolver；storage 提供 benchmark/panel/watchlist/artifact API；legacy portfolio 只允许显式迁移流程。 | `OHQUANT_DIR` 测试不受 import 顺序影响；默认流程不读取 `.ohquant/portfolio/`；tools 不手工拼 `.ohquant`。 |
| Tool display metadata | 已完成 | TUI/render-lines 为显示工具 label 通过 `tools/catalog.ts` 间接加载完整 registry。 | 拆出纯 `src/tools/display.ts`，registry 消费 metadata，渲染层只消费 metadata。 | `src/tui/src/**` 和 runtime 展示格式化不加载 `src/tools/registry.ts`。 |
| Artifact 循环依赖 | 已完成 | `generator.ts` 导入 `trajectory.ts`，`trajectory.ts` 又从 `generator.ts` 导入 `extractText`。 | 将 `extractText` 下沉到 `artifact/src/message-text.ts`，generator/trajectory 单向依赖 helper。 | import graph 无 generator/trajectory 循环；artifact focused tests 通过。 |

## P1 路线

| 模块 | 问题 | 建议 | 验收标准 |
| --- | --- | --- | --- |
| Runtime core | `app-runtime.ts` 同时承担命令执行、agent event reducer、overview 刷新、行情拉取、错误文案和消息格式转换。 | 保留 `AppRuntime` 为薄 orchestrator；抽 `runtime/commands.ts`、`runtime/agent-events.ts`、`runtime/overview.ts`、`runtime/panel-service.ts`、`runtime/errors.ts`。 | 核心行为可脱离 TUI 单测；新增 overview/agent event/panel 逻辑不直接改大文件。 |
| TUI adapter | `panel.ts`、`watchlist.ts`、`tui.ts` 直接访问 storage/path、settings、agent skill discovery。 | TUI 只接收 `AppState`、panel view model、skill suggestion view model；storage/skill 读写交给 runtime service。 | `src/tui/src/**` 不直接拼 `.ohquant`，不直接保存 settings/portfolio，不直接发现 agent skills。 |
| Agent bootstrap | `session.ts` 绑定 tools、storage、skill discovery、model resolve、session repo；`context.ts` 读取 storage `DATA_DIR`。 | 引入 `AgentRuntimeDeps`；tools/settings/session repo/skill discovery 从外部注入；context 接收 snapshot。 | agent facade 可单测；创建 session 不强制触发 storage 或完整 tool registry。 |
| Quant core | `comparison.ts` 做算法同时保存 artifact；`insight.ts` 写 `.ohquant/insights.json`；`fund-dca.ts` 依赖 source 类型。 | quant 保持纯计算；持久化移到 storage/workflow；`FundNavDaily` 下沉到 `types/data.ts`；insight cache 走 storage。 | `src/quant/**` 纯计算子模块不导入 `storage` 和 `source`。 |
| Source core | provider orchestration 同时处理 cache、settings 和 raw fetch；`akshare.ts` 过大。 | 定义 provider interface；raw provider 接收显式 config；`akshare` 拆 runner/scripts/endpoints/normalize/client。 | provider 文件可用 mock config 单测；修改 endpoint 不碰 provider orchestration。 |
| Tools adapter | `quant-tools.ts`、`data-tools.ts`、`akshare-fund-tools.ts` 混合 schema、执行、格式化、持久化和 market 推断。 | tools 只做 schema、参数转换、调用 service、格式化；公共 `ok/err/schema/format` 放 `tools/shared`。 | 每个工具文件只暴露一个工具或小工具族；核心逻辑在 quant/source/runtime service 可单测。 |
| CLI adapter | `system.ts` 混合 help、compact receipt、config、doctor、portfolio、resume、session 文案。 | 按 command family 拆 handler；表格/receipt 文案移到 `cli/formatters`；handler 调 service。 | 每个 handler 文件只负责一个命令族，测试按命令族隔离。 |
| Artifact pipeline | `generator.ts` 同时读 JSONL、解析消息、检测图表、渲染轨迹、读取配置。 | 在 P0 cycle fix 后拆 `load-session.ts`、`normalize-session.ts`、`content-pipeline.ts`、`render-document.ts`；reference data 注入。 | artifact 生成器可接受 entries 作为输入；source reference data 不在 generator 中硬连。 |

## P2 路线

| 模块 | 问题 | 建议 | 验收标准 |
| --- | --- | --- | --- |
| `alpha` / `akquant` | 已确认需要新增 alpha 研究模块，但当前没有边界，容易被直接塞入 `quant-tools.ts`。 | 做 gated spike：新建 `src/alpha`，定义 `AlphaBacktestEngine` 接口和 `akquant` adapter；Agent 工具放 `src/tools/alpha-tools.ts`，持久化放 `storage`。 | alpha 不依赖 CLI/TUI/source/storage；`akquant` 形态被记录；fixture 跑通后再接 registry/context。 |
| `skill` | `src/skill/store.ts` 混合 path、默认 repo、Git clone/pull、默认安装；`handler.ts` 同时依赖 agent、cli、storage。 | 拆 `paths.ts`、`defaults.ts`、`installer.ts`；命令 adapter 留在 CLI 或 shared command contract。 | 安装逻辑可注入 git runner 单测；`skill` 不直接依赖 `cli/types.ts`。 |
| `types` | `src/types/errors.ts` 既是类型又包含 runtime catalog/formatter；`config.ts` 同时放契约和默认值。 | 维持现状但禁止继续扩张；若错误系统变大，移动到 `src/errors/catalog.ts`、`src/errors/format.ts`。 | `types` 主要保存 DTO/contract，不新增 IO 或业务执行逻辑。 |
| `tui/render-lines` | `src/tui/src/render-lines.ts` 负责 markdown-like 结构、表格、diff、tool result、chart glyph 等多类渲染。 | 按 renderer 拆：plain、table、doctor、compact、tool-result、chart-glyph。 | 新增一种消息格式不需要修改 600 行 renderer。 |
| `artifact/detectors-renderers` | detector/renderers 以 regex 和 HTML 字符串为主，未来多人修改容易冲突。 | 每类图表单独 detector + renderer，保留统一 pipeline 注册表。 | 新图表类型只增加一个注册项和对应 fixture。 |
| `source` small providers | `tushare.ts`、`llmquant.ts`、`financial-datasets.ts` 规模小，主要问题是配置读取依赖 storage。 | 等 provider interface 建好后迁移 raw providers。 | 小 provider 文件保持单一 adapter 职责，可用 mock config 测试。 |
| `tests` | 多个测试重复设置 `OHQUANT_DIR`，artifact 生成测试含 console/path 输出，source tests 用动态 import 清缓存。 | 增加 test helper：临时 ohquant、fixture loader、module reset 策略；生成类测试改 fixture/snapshot。 | 默认 `bun test src/` 输出稳定、少副作用。 |
| `build/config` | `tsconfig` 允许 unused locals/params；没有 import boundary lint。 | 在完成 P0/P1 后逐步启用局部 noUnused，或用独立脚本检查新代码。 | CI 能阻止新增明显死代码和边界违规。 |

## P3 路线

| 模块 | 问题 | 建议 | 验收标准 |
| --- | --- | --- | --- |
| `quant` pure calculators | `factor.ts`、`risk.ts`、`backtest.ts` 当前相对清晰，但指标公式存在重复。 | 不急于拆；当指标扩展时建立 `quant/stats.ts` 复用 CAGR、Sharpe、drawdown、percentile。 | 只有真实重复或新需求出现时再抽象。 |
| `alpha` engine registry | 单引擎 `akquant` spike 前不需要复杂插件系统。 | 只有出现第二个真实引擎时再新增 `src/alpha/engines/index.ts`。 | 不为单引擎提前设计 registry。 |
| `root entry` | `src/index.ts` 使用动态 import 启动 app，问题有限。 | 等普通业务路径动态 import 清理后再决定是否静态化。 | 入口仍保持薄，启动路径清晰。 |

## 模块逐项分析

### `src/app-runtime.ts`

问题：

- `AppRuntime` 从 `src/app-runtime.ts:68` 开始，文件约 1000 行，承担 UI state、slash command、agent event、market refresh、storage summary 和错误文案。
- `refreshMarketPanel` / `pullMarketPanel` 在 `src/app-runtime.ts:493` 和 `src/app-runtime.ts:506`，把 UI refresh、provider fallback、portfolio symbols 和行情 rows 组合在 runtime 内部。
- `baseCode`、`inferMarket` 等 symbol 规则在 `src/app-runtime.ts:918`、`src/app-runtime.ts:995`，同类逻辑也存在于 tools。

建议：

- P1: 先拆 overview/market refresh 到 `src/runtime/overview.ts`，让 runtime 只调用 `buildOverviewSections()`。
- P1: 拆 agent event reducer 到 `src/runtime/agent-events.ts`，集中处理 message/thinking/tool 状态。
- P1: 把 symbol normalization 移到共享 `src/market/symbols.ts` 或 `src/types/symbols.ts`。

### `src/cli`

问题：

- 已修复：`src/cli/types.ts` 改为 re-export `src/types/commands.ts`，命令契约不再绑定 `QuantAgentSession` 实现。
- 部分修复：`src/skill/handler.ts` 已改用 shared command contract；`src/cli/registry.ts` 仍负责注册 skill handler，后续可按 command family 继续收窄。
- `src/cli/handlers/system.ts` 同时包含 compact receipt、config、doctor、portfolio、resume、session 等多命令逻辑。
- `src/cli/params.ts:65` 动态导入 tool registry，CLI 与 tools 在运行时耦合。

建议：

- P0: 把 command DTO 下沉，打断 `types->cli` 和 `skill->cli`。
- P1: 按命令族拆 handlers：`config.ts`、`doctor.ts`、`portfolio.ts`、`resume.ts`、`session.ts`。
- P1: workflow/compare 应调用应用服务，不直接拼 quant/storage 细节。

### `src/tui`

问题：

- `src/tui/src/panel.ts:9` 直接导入 settings、sessions、portfolio storage API，TUI 不再是纯渲染层。
- `src/tui/src/watchlist.ts:6` 手工拼 `.ohquant` 路径，违反 storage owns filesystem 的边界。
- `src/tui/src/tui.ts:13` 直接依赖 `discoverSkills`、`NodeExecutionEnv`、`skillPaths`、`loadSettings`，把 skill discovery 和 settings 读写拉进 TUI。
- `src/tui/src/render.ts:11` 从 quant 读取 loading quotes，渲染层依赖业务内容来源。
- 已修复：`src/tui/src/render-lines.ts` 经 `tools/catalog.ts` 消费纯 `src/tools/display.ts` metadata，不再触发完整 registry 加载。
- `src/tui/src/render-lines.ts` 和 `src/tui/src/panel.ts` 文件过大，多个 agent 容易同时冲突。

建议：

- P1: TUI 只接收 `AppState`、panel view model、skill suggestion view model；所有 storage/skill 读写交给 runtime/service。
- P0: 拆 tool display metadata，避免 TUI import tools registry。
- P1: 拆 `PanelController` 的 config/resume/portfolio/help 子控制器。
- P2: 拆 `render-lines` 为多 renderer 注册表。

### `src/agent`

问题：

- `src/agent/src/session.ts:24` 导入 builtin tools，`src/agent/src/session.ts:26` 导入 storage settings/session dir，session facade 同时绑定工具和本地文件系统。
- `src/agent/src/context.ts:8` 直接引用 storage `DATA_DIR`，system prompt 构造知道本地缓存布局。
- `src/agent/src/pi` 是大块 vendored/runtime harness 代码，局部改动风险高。

建议：

- P1: 把 `QuantAgentSession` 创建改为依赖注入：model config、tools、session repo、skill discovery。
- P1: `context.ts` 接收 cache snapshot，而不是自己扫描 storage path。
- P2: 标记 `src/agent/src/pi` 为 adapter/harness 边界，业务改动尽量在外层 wrapper 完成。

### `src/tools`

问题：

- `src/tools/quant-tools.ts:72`、`src/tools/quant-tools.ts:92` 等普通执行路径使用动态 import。
- `src/tools/quant-tools.ts:294` 和 `src/tools/quant-tools.ts:344` 直接解析 `.ohquant/benchmark/results`。
- `src/tools/data-tools.ts:544` 和 `src/tools/quant-tools.ts:375` 重复 market 推断。
- `src/tools/akshare-fund-tools.ts` 文件超过 1000 行，endpoint、候选源、格式化和工具注册混在一起。
- `src/tools/registry.ts:1`、`src/tools/bash-tool.ts:9` 仍依赖 `agent/src/pi` 类型/实现；TUI 经 `tools/catalog.ts` 加载 registry 的问题已修复。

建议：

- P0: benchmark result persistence 移入 storage。
- P0: 拆 `tools/display.ts` 或 `tools/metadata.ts`，供 TUI 使用纯元数据，不加载 registry。
- P1: 按工具族拆文件，公共 `ok/err/schema/format` 放 `tools/shared`。
- P1: shared symbol helper 统一 market/base code 推断。
- P1: 工具类型尽量依赖外部 `@earendil-works/pi-agent-core`，避免工具层 import vendored `agent/src/pi`。

### `src/quant`

问题：

- `src/quant/comparison.ts:7` 保存 comparison artifact，使 quant 算法层依赖 storage。
- `src/quant/fund-dca.ts:1` 依赖 source 的 `FundNavDaily` 类型。
- `src/quant/insight.ts:105` 写 `.ohquant/insights.json`，把 insight 生成与 storage 路径耦合。
- `src/quant/index.ts:1` wildcard re-export 了 `insight.ts` 和 `comparison.ts`，调用方容易无意拉入带 IO/storage 边界的模块。
- `risk.ts`、`backtest.ts`、`benchmark.ts` 有部分指标计算重复，但当前还不需要大抽象。

建议：

- P1: quant 保持纯计算，workflow/storage 负责读写 artifact。
- P1: `FundNavDaily` 下沉到 `types/data.ts`。
- P1: 收窄 `src/quant/index.ts`，不要默认 re-export 带 IO/storage 的模块。
- P2: insight cache 走 storage API。
- P3: 只有当指标继续扩展时再提取 `quant/stats.ts`。

### `src/alpha` planned module

问题：

- 当前没有 `src/alpha`，但需求已经确认：需要 alpha 研究模块，并接入 `akquant` 作为回测工具。
- 如果直接把 `akquant` 接入 `src/tools/quant-tools.ts`，会继续放大 tools 单文件、混淆纯计算层和外部引擎调用。
- `akquant` 的 API、运行方式、依赖形态尚未在仓库内固化；需要先做 spike，不能假设它是本地 TS 包、Python 包还是 CLI。
- 回测结果如果让 storage import `src/alpha/types.ts`，会复制当前 `storage -> quant` 反向依赖问题。

建议：

- P2: 新建 `src/alpha`，职责限定为 alpha 策略定义、实验参数、回测编排和结果 DTO，不负责 provider 数据抓取、不负责 `.ohquant` 文件路径、不负责 TUI 呈现。
- P2: `src/tools/alpha-tools.ts` 或 workflow 层负责解析 source/storage 数据；`src/alpha` 只接收 `Bar[]` 或显式 `DatasetRef`，不得 import `source`、`storage`、`cli`、`tui`。
- P2: 定义统一引擎接口：
  - `src/types/alpha.ts`: `AlphaSpec`、`AlphaBacktestRequest`、`AlphaBacktestResult`、plain persisted DTO。
  - `src/alpha/types.ts`: alpha 内部 service types，必要时 re-export shared DTO。
  - `src/alpha/engines/akquant.ts`: 唯一的 `akquant` adapter。
  - `src/alpha/backtest.ts`: 调用 engine、标准化结果、复用 `quant/risk` 指标。
  - `src/alpha/index.ts`: 收窄 public export。
- P2: Agent 工具单独放 `src/tools/alpha-tools.ts`，首个工具命名为 `alpha_backtest`，display 可先归到 `quant` domain，label 使用 `Alpha.Backtest`。
- P2: 回测结果持久化放 `src/storage/src/alpha-runs.ts`，路径建议 `.ohquant/alpha/runs/{run-id}.json`；storage 保存 plain DTO，不 import `src/alpha/**`。
- P2: 同步更新 `src/storage/src/policy.ts`、`docs/ohquant-storage-policy.md`、`src/storage/README.md`、`src/storage/test/alpha-runs.test.ts`、`src/tools/registry.test.ts`、`src/agent/test/context.test.ts`。
- P3: 若后续支持多引擎，新增 `src/alpha/engines/index.ts` 做 engine registry；不要提前为单引擎设计复杂插件系统。

建议目录：

```text
src/types/
  alpha.ts
src/alpha/
  index.ts
  types.ts
  backtest.ts
  engines/
    akquant.ts
src/tools/
  alpha-tools.ts
src/storage/src/
  alpha-runs.ts
src/storage/test/
  alpha-runs.test.ts
```

首个 spike 验收：

- 明确 `akquant` 是 npm 包、Python 包、CLI 还是内部库，并记录安装/运行方式。
- 用固定 fixture 跑通一次 adapter，不接 TUI，不写 `.ohquant`。
- 定义 `AlphaBacktestRequest`：strategy spec、bars/data ref、cost model、date range、engine options。
- 定义 `AlphaBacktestResult`：equity curve、trades、risk summary、engine version、input data lineage/hash。
- 验证 adapter 超时、stderr、异常输出、空结果的错误形态。
- 通过 storage API 写 `.ohquant/alpha/runs/{run-id}.json`，并断言 file events。
- 加 architecture boundary test：`src/alpha` 不导入 `src/source`、`src/storage`、`src/cli`、`src/tui`。
- 工具注册后 agent 可以调用 alpha backtest，但实现不修改 `quant-tools.ts` 的既有工具逻辑。

### `src/source`

问题：

- `src/source/src/akshare.ts` 同时包含内嵌 Python 脚本、public endpoint 列表、parser、normalizer、fetch wrapper、Sina fallback。
- `src/source/src/sources.ts:9` 同时处理 provider orchestration、cache load/save、settings load。
- `src/source/index.ts` wildcard export 所有 provider internals，使调用方容易绕过 orchestrator。
- provider 凭证由 storage 读取，raw provider 难以独立测试。

建议：

- P1: 拆 `akshare` 子模块，保持 endpoint 和 parser 可独立测试。
- P1: raw provider 接受显式 config；`sources.ts` 或更高层负责 settings/cache。
- P2: public export 改为显式 API。

### `src/storage`

问题：

- `src/storage/README.md` 将 agent/pi dependency 描述为 deliberate，但 `docs/module-architecture.md` 推荐 `storage -> types`；roadmap 需要先统一契约。
- `src/storage/src/sessions.ts:3`、`src/storage/src/sessions.ts:5` 依赖 agent/pi 类型、模型信息和 session context rebuild，这是 runtime dependency，不应和 `src/storage/src/comparison.ts:10` 的 type-only quant 依赖混为一谈。
- `src/storage/index.ts` wildcard 暴露所有 storage 内部实现和低层路径常量。
- `src/storage/src/dirs.ts` 同时导出 import-time constants 和 runtime resolver，测试 env 切换时容易混淆。
- `src/storage/src/local-portfolios.ts` 不只是 legacy discovery，还包含持仓摘要、主题推断、去重策略；同时 `.ohquant/portfolio/` 已被 policy 标记为 forbidden。

建议：

- P0: 先决定 session summary 属于 storage exception 还是 agent adapter，并同步 `module-architecture.md`、`src/storage/README.md`。
- P1: 移除 storage 对 quant 的直接依赖；comparison/alpha run storage 都保存 plain DTO。
- P0: 统一 path resolver，避免 import-time constants 绕过 runtime `OHQUANT_DIR`。
- P0: runtime/TUI 默认流程不再读取 `.ohquant/portfolio/`；legacy portfolio discovery 只保留为显式迁移。
- P0/P1: 收窄 barrel exports；低层 path helper 改成 resolver-only。
- P2: legacy portfolio discovery 与 summary heuristic 拆开。

### `src/artifact`

问题：

- `src/artifact/src/generator.ts:28` 的 `generateArtifact()` 同时读文件、构造上下文、渲染消息、构建 trajectory、识别图表和生成 HTML。
- `src/artifact/src/generator.ts:15` 直接从 storage 内部路径导入 env key reader。
- `src/artifact/src/reference-data.ts:1` 依赖 source provider 构造 artifact reference line。
- 已修复：`extractText` 已下沉到 `src/artifact/src/message-text.ts`，`generator.ts` 和 `trajectory.ts` 不再形成循环依赖。
- artifact 生成测试中存在大量 demo fixture 和 console path 输出，默认测试噪音较大。

建议：

- P0: 先把 `extractText` 下沉到 `artifact/src/message-text.ts`，打断 generator/trajectory 循环。
- P1: 生成 pipeline 拆成 session loader、entry normalizer、content detector、document renderer。
- P1: source reference data 作为可注入服务。
- P2: detector/renderer 按图表类型拆分，并用 fixtures 做稳定断言。

### `src/skill`

问题：

- `src/skill/store.ts:1` 使用同步 Git 执行，`installSkills()` 和 `ensureDefaultSkills()` 混合 clone/pull、默认 repo、目录清理。
- `src/skill/store.ts:4` 依赖 storage path；这点可接受，但 path/install/discovery 应隔离。
- 部分修复：`src/skill/handler.ts` 仍依赖 agent discovery，但命令类型已改用 `src/types/commands.ts`，不再依赖 CLI handler 类型。

建议：

- P2: 拆 `paths.ts`、`defaults.ts`、`installer.ts`。
- P2: git runner 注入，避免安装测试触网或依赖本机 git。
- P2: command adapter 移到 CLI 或 shared command contract。

### `src/types`

问题：

- 已修复：`src/types/messages.ts` 从 `src/types/commands.ts` re-export `CommandResult`，不再反向依赖 CLI。
- `src/types/errors.ts:18` 和 `src/types/errors.ts:112` 包含 runtime catalog 和 formatter。
- `src/types/config.ts:42` 包含默认值；目前可接受，但不应继续加入 IO/migration。
- source-specific 类型如 `FundNavDaily` 还留在 provider 模块。

建议：

- P0: 修复 `types->cli`。
- P1: 将跨 source/quant/tools 共用的 market、symbol、fund nav DTO 下沉。
- P2: 错误 catalog 变大时迁出 `types`。

### `src/root` (`index.ts`, `app.ts`, `perf.ts`)

问题：

- `src/index.ts:60` 用动态 import 启动 app，当前风险低，但与“少用动态导入”的方向不完全一致。
- root entry 同时处理 CLI argv、banner、skill ensure、app startup，仍然相对薄。

建议：

- P3: 等普通业务路径动态 import 清理后再决定是否静态化入口。
- P2: 保持 root entry 只做启动，不继续加入业务逻辑。

### 测试与协作机制

问题：

- 多模块测试重复创建/清理 `OHQUANT_DIR`。
- artifact/source 测试有动态 import、demo generation、console path 输出，不利于默认测试审计。
- 缺少模块边界检查，多个 agent 容易在大文件上并行制造交叉改动。

建议：

- P0: 添加 architecture boundary check。
- P2: 建立 `src/test-support` 或 `scripts/test-support` 临时 storage helper。
- P2: 将 demo 生成测试从默认单元测试中分离。

## 多 agent 执行规则

- 每个 PR 必须声明 module ownership：允许修改的模块 public API、内部文件、禁止碰的共享入口、需要删除的 architecture allowlist 项。
- 共享入口包括 `src/storage/index.ts`、`src/quant/index.ts`、`src/source/index.ts`、`src/tools/registry.ts`、`src/tools/catalog.ts`、`src/cli/registry.ts`、`src/app-runtime.ts`。修改这些文件必须在 PR 说明中列出原因、受影响调用方和新的 public API。
- 新增工具前先稳定 registry/display metadata contract；工具实现只能通过 service/core 调用业务逻辑，避免 `tools/quant`、`tools/data`、`alpha-tools` 在同一入口冲突。
- 每个 PR 至少运行 focused tests、`bun run typecheck` 和 `bun run check:architecture`。大规模拆分完成后再跑完整 `bun test src/`。
- 对现有违规使用 allowlist baseline；PR 只能减少 allowlist 或保持不变，不能新增违规边。

## 建议 PR 切分

| 顺序 | 状态 | PR | Write scope | 主要验收 |
| --- | --- | --- | --- | --- |
| 1 | 已完成 | Boundary gate skeleton | `scripts/check-architecture.ts`、`scripts/architecture-boundary-baseline.json`、`package.json`、`docs/roadmap.md` | 新增 `check:architecture`，带 baseline allowlist，只阻止新增违规和 storage 外 `.ohquant` 路径构造。 |
| 2 | 部分完成 | Public API surface | `src/storage/index.ts`、`src/quant/index.ts`、`src/source/index.ts`、`src/tools/catalog.ts` | barrel 显式 export；display metadata 不加载 registry；禁止 UI/tool/CLI 引用 internal helper。 |
| 3 | 已完成 | Command contract | `src/types/commands.ts`、`src/cli/types.ts`、`src/skill/handler.ts`、`src/types/messages.ts`、`src/app-runtime.ts` | 修复 `types->cli`、`skill->cli`、`cli/types->agent`；focused tests 通过。 |
| 4 | 待做 | Storage ownership | `src/storage/src/dirs.ts`、benchmark storage、panel/watchlist/legacy portfolio 调用点 | resolver 不受 import order 影响；默认流程不读 `.ohquant/portfolio/`；benchmark 读写走 storage API。 |
| 5 | 已完成 | Artifact cycle break | `src/artifact/src/message-text.ts`、`generator.ts`、`trajectory.ts` | 消除 generator/trajectory 循环依赖，保持 artifact 输出兼容。 |
| 6 | 待做 | Runtime core extraction | `src/runtime/`、`src/app-runtime.ts` | 抽 overview、agent event reducer、panel/watchlist service；核心逻辑可脱离 TUI 单测。 |
| 7 | 待做 | TUI adapter cleanup | `src/tui/src/`，只消费 runtime view model | TUI 不直接读写 storage，不直接发现 skills，不直接拼 `.ohquant`。 |
| 8 | 待做 | Agent dependency injection | `src/agent/src/session.ts`、`context.ts`、runtime create-agent 调用点 | agent 创建不强制加载完整 tools registry/storage；context 使用 snapshot。 |
| 9 | 待做 | Quant/source core split | `src/quant/`、`src/source/`、`src/types/data.ts` | quant 纯计算不导入 source/storage；source raw providers 接收显式 config。 |
| 10 | 待做 | Tool adapters | `src/tools/`、`src/tools/shared/` | tools 只做 schema/format/adapter；核心执行逻辑迁到 quant/source/runtime service。 |
| 11 | 待做 | CLI adapters | `src/cli/handlers/`、`src/cli/formatters/` | handlers 按命令族拆分，只调用 service，不直接拼业务细节。 |
| 12 | 待做 | Artifact pipeline | `src/artifact/src/` | generator 拆成 load/normalize/detect/render；reference data 可注入。 |
| 13 | 待做 | Alpha/akquant gated spike | `src/types/alpha.ts`、`src/alpha/`、`src/tools/alpha-tools.ts`、`src/storage/src/alpha-runs.ts` | 确认 `akquant` 形态，跑通 fixture，再接 registry/context。 |
每个 PR 的规则：只改一个模块边界；先加 boundary/focused test；保持 public behavior 不变；不要顺手重排无关格式。共享入口只能在对应 PR 修改，后续 PR 通过新 public API 消费。