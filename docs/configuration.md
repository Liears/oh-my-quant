# WhyJ Quant 配置参考

WhyJ Quant 的配置保存在 `.ohquant/settings.json`；`OHQUANT_DIR` 可指定其他配置目录。使用 `/config` 或 `Ctrl+P` 打开 Settings，选择 `Model`。Doctor 的 `Configure → Model connection` 打开同一个编辑器。

## 模型连接

1. 选择 `Provider`，输入厂商名称或 ID 搜索。
2. 选择 `Model`，搜索实际模型 ID；列表显示名称、上下文容量和 reasoning 能力。目录里没有的模型使用 `Enter custom model ID`。
3. API-key 连接填写 `API key` 或选择 `Provider setup`，例如 Cloudflare 的 key/account/gateway、Bedrock 的 bearer token/AWS profile。OAuth 连接使用下述 `Sign in & Save`。
4. 选择 `Thinking`。可选级别来自 Pi 对当前模型的能力定义；不支持 reasoning 的模型只显示 `off`。
5. 选择 `Save`，或选择 `Save & Verify` 保存并发送一次小型模型请求。

`Connection details` 中可修改端点、协议、当前模型的上下文/输出限制、reasoning 能力，并移除保存的密钥。普通 provider 使用目录默认值，无需手填 URL。自定义连接始终显示这些字段，URL 必填。

普通编辑只修改草稿。Enter 确认当前输入，Esc 退回或丢弃草稿；多步 `Provider setup` 中取消会保留原凭证。输入框支持左右方向键、Home/End、删除和退格；密钥始终遮蔽。空密钥输入保留原值，清除用 `Remove saved key`。

支持 OAuth 的 provider 提供 `Sign in & Save`：先选模型和 Thinking，再按 Pi 提示选择登录方式；授权链接用 `Ctrl+O` 打开、`PgUp/PgDn` 滚动查看，设备码按提示输入浏览器，手动授权码在终端遮蔽。成功后立即保存，后续 Esc 不撤销该登录；登录中 Esc 取消，关闭父面板也会取消。`Sign out` 立即删除当前本地登录或 Pi 链接，OAuth 仍保持选中；Pi 登录本身保留。`Use API key` 是需要 Save 的显式切换草稿。完整流程和验证边界见 [OAuth 生命周期](./model-oauth.md)。

保存后，新提交的 prompt/skill、手动压缩或分支摘要读取新设置，无需重启；历史对话和 session ID 保留。当前分析及其工具调用、排队续问保持原连接，直到此次运行结束，避免新密钥被发往旧端点。运行中保存后可用 `Save & Verify` 单独测试新连接。重启并恢复历史会话时，使用当前保存的连接。

模型保存、External Skills 和 Auto Artifacts 开关通过配置通知生效，不附带 Overview 行情刷新。`Save & Verify` 只增加指定的模型诊断；数据 `Save verified` 则刷新行情一次，关闭 Settings 不再次刷新。浏览、取消或保存冲突不发布成功通知。键盘与运行时验证见 [终端研究流程验收](./terminal-workflow-audit.md)。

模型目录、原生协议、默认 URL、模型能力、API-key/环境凭证解析与 OAuth 协议来自精确锁定的 `@earendil-works/pi-ai` 0.85.1。实现参考 [Pi AI provider API](https://github.com/earendil-works/pi/tree/main/packages/ai)，实际契约以安装版本的类型与源码为准。OAuth 本地流程和构建已回归，真实账号另行验证；启动不自动导入 Pi 的 auth.json/models.json。已显式链接的 OAuth 连接在后续模型请求中读取 Pi 的当前账号。

## 从 Pi 导入连接

设置中的 `providers[id].oauthId` 是 WhyJ 本地独立登录或 Pi 链接的引用，存在时不回退到 API-key；不要手动填入 token。使用模型面板登录会建立独立凭证，显式 Pi 导入可建立共享链接。

`/config --pi list` 查看 Pi 文件中的连接；`preview` 预览选定 provider/model，`apply --review <token>` 在版本仍一致时保存。preview/apply 不修改 Pi 文件：API-key 和模型元数据按选定连接复制快照；有效 OAuth 在所选 provider 支持时建立指向 Pi `auth.json` 的链接，不复制 token。后续模型请求可能在 Pi 同路径文件锁下刷新该账号。源文件、环境解析结果或 WhyJ 设置变化时必须重新预览。命令式凭证、无效 OAuth 与不能完整映射的字段明确拒绝。路径、优先级、覆盖范围和测试见 [Pi 配置导入](./pi-config-import.md)。

模型文件可包含注释与尾逗号，auth/settings 文件仍要求严格 JSON。Anthropic 的 `compat.allowedFallbackModels` 可保留目标模型与价格元数据；列表覆盖、请求字段和实际返回模型计费的边界见 [导入契约](./pi-config-import.md#映射与边界)。

## 保存冲突与文件恢复

设置保存使用进程间锁和原子替换，并校验打开草稿时的文件版本。另一终端或外部编辑器已修改文件时，保存会提示 `Settings changed`，保留当前草稿且不执行 Save & Verify 的网络验证。记录需要保留的修改后，退出并重新打开 `/config`，在最新配置上重新编辑。`Settings busy` 表示另一个写入尚未结束，可在当前草稿上重试保存。

JSON 损坏或关键字段类型错误时，应用保留原文件并提示修复，不自动覆盖成默认配置。修复或从自己的备份恢复 `.ohquant/settings.json` 后重新启动；没有备份时，先保留损坏文件的副本，再按下方配置示例修复。`whyj --help` 在配置损坏时仍可使用；`whyj --json doctor` 会返回 `ok: false`、`error.code: settings_unavailable` 和非零退出码，不输出原始文件内容。凭证仍保存在原来的本地配置中，此机制不增加密钥历史副本。

## 连接字段与优先级

| 字段 | 含义 |
|---|---|
| `provider` | Pi provider ID、已声明的自定义 provider 名称，或 `custom` |
| `providers[id].custom` | true 显式声明非内置的命名端点；Pi 导入自动填写，未声明的未知 provider 报错 |
| `model` | 实际模型 ID，保留大小写、命名空间和 `[1m]` 等后缀 |
| `providers[id].apiKey` | 仅该 provider 使用的保存密钥 |
| `providers[id].oauthId` | 本地 OAuth 登录或 Pi 账号链接引用；优先于 API-key，缺失/刷新失败时要求重新登录；由 Sign in & Save 或已审阅的 Pi apply 生成 |
| `providers[id].headers` / `authHeader` | 导入的请求头快照及显式 Bearer 设置；值不在预览中输出 |
| `providers[id].compat` | provider 兼容默认值；模型层可覆盖 |
| `providers[id].env` | 该 provider 的环境设置，由 Pi 设置流程填写，也可编辑 JSON |
| `providers[id].baseUrl` | 覆盖此连接端点；留空使用 provider 默认值 |
| `providers[id].api` | provider 的默认协议覆盖；留空使用当前模型的 Pi 原生协议 |
| `providers[id].model` | 上次选用的模型，切回 provider 时恢复 |
| `providers[id].models[modelId]` | 仅该模型的协议/能力覆盖；api/baseUrl 优先于 provider 默认值，支持 contextWindow/maxTokens/reasoning/name/input/cost（含 tiers）、headers/compat/samplingParams/thinkingLevelMap；完整定义标记 replaceCatalog |
| `thinkingLevel` | 请求的推理级别，保存/请求时按模型能力约束 |

未选择 OAuth 时，模型凭证优先使用当前 provider 保存的 key，再按 Pi 规则读取其环境变量，例如 `OPENAI_API_KEY`、`GEMINI_API_KEY`、`DEEPSEEK_API_KEY`。环境值优先级为 `providers[id].env` → `settings.env` → 进程环境。不同 provider 不共享保存的 key；显式 `provider` 模式不会回退到旧的 `WHYJ_QUANT_API_KEY` 全局槽位。

已导入的命名自定义 provider 和模型会出现在同一搜索列表中；切换 provider 恢复其上次使用的模型。Protocol 编辑当前模型的覆盖，选择 Provider default 清除该模型覆盖；Base URL 和 API key 仍由同一 provider 的所有模型共用。不同工作区的自定义目录互不污染 Pi 内置目录。

若模型包含独立地址，编辑器另显示 Model URL，清空后使用 provider 默认地址。兼容/采样/请求头等元数据通过 Pi 文件导入或本地 JSON 配置保存；精确合并顺序、采样参数覆盖请求体的行为和当前协议边界见 [导入契约](./pi-config-import.md#映射与边界)。

端点与协议分别设置，不通过 `/v1` 或厂商名字猜测协议。例如 OpenAI 默认是 `openai-responses`，DeepSeek 默认是 `openai-completions`，Google 是 `google-generative-ai`，MiniMax CN 是 `anthropic-messages`。原生 provider 的其他协议仍由 Pi 分派；Custom 支持上述四种协议。空凭证的 Custom 用固定 `local` 占位 token，可供忽略鉴权的本地兼容服务使用。

Azure、Bedrock、Vertex、Mistral 的原生协议也可导入并在各自 provider 的 Protocol 列表中选择。环境凭证保留原类型：AWS profile/IAM、Vertex ADC 不替换成伪 API key。无需固定 URL 的内置连接显示 Provider environment/default；原生 SDK 仍按其环境变量优先级解析最终端点。字段、测试和自定义名称的边界见 [Pi 原生协议导入](./pi-config-import.md#映射与边界)。

`contextWindow`、`maxTokens` 必须为正整数，输出限制不超过窗口。覆写能力仅描述服务实际支持的限制，不会提升服务端容量。自动压缩阈值仍使用 `env.WHYJ_QUANT_COMPACT_TRIGGER_TOKENS`，默认 `contextWindow - 16384`，上限为当前模型窗口。

`/config`、`/doctor` 与 `/artifact` 的 TUI/非 TUI 边界见 [Slash Command 参考](./slash-commands.md)。

## 用户可见设置

| Settings 分组 | 面板选项 | JSON 字段 | 默认值 | 语义 |
|---|---|---|---|---|
| Agent Runtime | `Model` | `provider`、`model`、`providers`、`thinkingLevel` | 编辑器初始为 DeepSeek V4 Pro；凭证未配置 | 打开上述统一模型连接编辑器；Thinking 在其中按模型能力选择。 |
| Research Data | `Market Data` | `preferences.source`、`preferences.defaultMarket` | `llmquant-data` / `A`；编辑器选择兼容的样本市场 | 打开 Data connection 草稿编辑器。验证后保存，Overview 与 Agent 的后续刷新/调用使用新配置；普通取数仍保留定义的 fallback 链。 |
| Research Data | `Data Token` | 对应 `env.WHYJ_QUANT_*` key | 未配置 | 打开同一个 Data connection 编辑器并聚焦密钥输入；AKShare 不需要 token。只在样本验证成功并执行 Save verified 后保存。 |
| Research Data | `Portfolios` | `.ohquant/panel-portfolio.json` | 空组合列表 | 打开自定义组合编辑器；保存代码、名称、instrument 与分组关系。所有组合展示在 Overview，报价自动刷新。 |
| Workspace Experience | `External Skills` | `skillIntegrations.external` | `false` | 开启后额外加载用户级 Codex、Claude、Agents 和 pi skills；项目量化 skills 始终加载。 |
| Workspace Experience | `Overview Dock` | `showPortfolioPanel` | `true` | 显示右侧 Overview dock；关闭后 Analyzing 面板使用完整终端宽度。 |
| Workspace Experience | `Auto Artifacts` | `artifactGeneration.auto` | `false` | 开启后在量化分析 turn 完整结束时生成 Dashboard + Trajectory 并打开浏览器；关闭时不自动生成。`/artifact` 始终只浏览、恢复和打开已有报告。 |
| Workspace Experience | `Market Colors` | `preferences.marketColorScheme` | `red-up` | 红涨绿跌；可选 `green-up` 绿涨红跌。同一工作区的 A/HK/US/基金统一使用所选约定，立即重绘且不额外刷新行情；新报告保存该选择，历史版本不改写。 |
| Workspace Experience | `Status HUD` | `preferences.hudMode` | `full` | `full` 显示上下文、延迟和轮数；`context` 隐藏延迟；`off` 隐藏这些指标，保留模型和来源。立即生效，重启保留，不触发行情请求。 |
| Workspace Experience | `Compact At` | `env.WHYJ_QUANT_COMPACT_TRIGGER_TOKENS` | 模型窗口减 16384，最低 1 | 输入 1 到当前窗口之间的 token 数，或 `auto` 恢复自动值；Esc 取消。显示解析后的实际阈值，下一次 prompt 按现有自动压缩流程检查。 |

行情变化、评分/风险和命令结果使用不同语义：切换 Market Colors 不翻转回撤/VaR、成功/失败的颜色；显示精度下的零变化及缺失值保持灰色。完整约定见 [DESIGN](../DESIGN.md)。

模型性能基准入口、失败/取消语义及 HUD 统计口径见 [模型性能测试](./model-performance.md)。Status HUD 只控制展示，不修改模型上下文窗口；Compact At 控制压缩触发，不能扩大供应商窗口。环境中的旧阈值仍按原优先级读取；在面板保存 `auto` 会明确使用自动值。

`Auto Artifacts` 只对自然语言量化研究请求生效。运行时会在 turn 完成、session JSONL 已写入后生成报告；证券、基金或组合分析会要求 agent 先形成可审计的技术与风险指标链。仅打开设置、恢复 session 或执行普通本地命令不会生成报告。

## 扩展管理

扩展管理使用 `/config --extensions list|enable|disable|reload [id]`，详见 [Slash 参考](./slash-commands.md)。`disabledExtensions` 是当前构建扩展 ID 的禁用数组，缺失或空数组表示默认启用全部注册扩展。它由 storage 校验、去重并排序，未知 ID 保留但显示 unavailable；类型错误或非法名称拒绝读取并保留原文件。启停保存复用 settings revision 与进程锁，其他运行中的终端需重启读取新选择。此字段不包含包路径、脚本或凭证；不决定独立 Overview/Doctor 数据服务的可用性。

## Market Data 与凭证

| Market Data | 主要市场 | Data Token |
|---|---|---|
| `akshare` | A 股、指数、基金 | 不需要 |
| `tushare` | A 股、基金 | `WHYJ_QUANT_TUSHARE_TOKEN` |
| `llmquant-data` | 美股、港股 | `WHYJ_QUANT_LLMQUANT_API_KEY` |
| `financial-datasets` | 美股价格与快照 | `WHYJ_QUANT_FINANCIAL_DATASETS_KEY` |

`/config → Market Data` 或 Doctor 的 `Configure → Market Data` 打开同一个编辑器：

1. 在 `Market`、`Source` 按 Enter 切换；顶部列出所选市场兼容的源及 Python/凭证要求。
2. 编辑 `API key`、可选 `Endpoint`、`Symbol` 和 `Start` / `End`。密钥遮蔽，空输入保留原值；`Remove saved key` 在草稿中移除保存值并回到环境凭证。端点空输入移除本地覆盖，依次使用环境端点、provider 默认值。
3. 选择 `Check data`，仅请求当前源的样本。不会保存配置或行情。通过后显示有效行数、数据截止日及有限能力范围。
4. 选择 `Save verified` 才写入配置并触发运行时刷新。修改任何检查输入后须重新检查；有效环境凭证或端点变化同样使保存资格失效。保存冲突/遇锁时保留草稿。

检查期间 Esc 取消请求并留在编辑器，再按 Esc 退出、丢弃草稿；编辑输入时 Esc 仅取消当前输入。关闭父面板、切换面板或退出应用会取消请求，晚到结果不再更新界面。异步检查完成会主动刷新面板，无需按键。检查标的/日期和成功证据只用于本次草稿，不写成长期权限证明。

Tushare 配置示例：选择市场 `A`、源 `tushare`，填写 token，执行 `Check data → Save verified`。日线和 symbol 搜索均会使用该 token；紧凑快照不会调用需要额外积分权限的 `daily_basic`，避免把权限错误误报为配置未生效。

`/doctor --phase data` 只读检查当前数据源，复用实际行情适配器，检查期间不保存配置或行情缓存。保存的行情 key/端点优先于进程环境；诊断开始时固定配置快照。默认采用兼容市场的样本和最近 30 天窗口，文本的 `data sample` 与 JSON 的 `config.dataRequest` 明示范围。AKShare 必须通过同一 Python 环境的包检查并实际取得有效行情，HTTP 200 或包可导入都不足以判定可用。

JSON 的 data phase 另含 `data.status`、标的/日期、行数、asOfDate、凭证来源和依赖版本。`ready` 仅证明这份日线/单位 NAV 样本；缺凭证、缺 Python/包、鉴权失败、权限不足、无有效数据、超时和取消分别报告。诊断不使用其他 provider 的回退结果证明所选源可用；其他端点需单独检查。

### Tool capabilities 与端点检查

Data connection 中选择 `Tool capabilities`，或在 Doctor 中按 `v`。输入工具名称搜索，Enter 查看实际参数、市场、provider、依赖、权限和副作用。列表来自同一份可执行注册表；`sample-verified` 是样本输入通过，`local` 仅表示不需要行情 provider，二者都不是工具已执行。

详情按 `p` 打开 `Endpoint check`。在 Endpoint 行按 Enter 切换该工具的兼容端点；Parameters 编辑 JSON 对象，按界面列出的 required 参数填写，选择 Check 才发出请求。例如基金净值端点参数为 `{"symbol":"270042","indicator":"单位净值走势"}`。API key 仍来自当前数据草稿或环境，不放进参数 JSON。

检查只读取一个 source 端点，不写入行情、研究记录或设置。显示端点、参数、非空行数、检查时间及失败原因；通过只证明这次响应，未验证实时性或其他权限。取消、修改参数和连接、关闭父面板使旧证据失效；结果不跨编辑器长期保留。端点检查不代替 `Check data → Save verified` 的配置保存条件。完整协议见 [工具注册表](./builtin-tool-registry.md)。

Doctor 的 `Run diagnostics` 检查已保存的模型、工具和数据，不保存草稿。关闭 Doctor、进入 Configure 或启动另一轮 Doctor 会取消旧诊断；旧状态不能重新打开面板或覆盖新一轮结果。模型编辑器的 `Save & Verify` 仍是保存模型后独立检测模型，与数据的验证后保存流程不同。

## 可选 Alpha 引擎

`alpha_backtest` 使用 `env.WHYJ_QUANT_AKQUANT_PYTHON` 指定的 Python 可执行文件；也可在启动前设置同名进程环境变量，保存配置优先。解释器路径由用户配置，工具参数不能覆盖。AKQuant 0.3.58/规则 1.5.4 的安装、检查、调用示例和复跑方式见 [Alpha / AKQuant](./alpha-backtest.md)。Tool capabilities 显示缺失前提，`alpha_engine_status` 执行实际导入/版本检查；行情端点通过不代表引擎可用。历史 `alpha_runs` 不需要 Python。

## 规范化配置示例

```json
{
  "version": 3,
  "env": {
    "WHYJ_QUANT_TUSHARE_TOKEN": "your_token"
  },
  "provider": "deepseek",
  "model": "deepseek-v4-pro",
  "providers": { "deepseek": { "apiKey": "your-provider-key" } },
  "thinkingLevel": "high",
  "showPortfolioPanel": true,
  "artifactGeneration": {
    "auto": false
  },
  "skillIntegrations": {
    "external": false
  },
  "permissions": {},
  "preferences": {
    "defaultMarket": "A",
    "defaultBenchmark": "000300.SH",
    "defaultCash": 100000,
    "defaultFast": 20,
    "defaultSlow": 60,
    "currentPortfolioFile": "holdings.json",
    "source": "llmquant-data"
  }
}
```

`preferences.currentPortfolioFile` 仅供显式旧文件导入时的去重排序，已经不决定 Overview 内容或自动读取路径。组合入口见 [Slash Command 参考](./slash-commands.md)。

## 兼容迁移

没有 `provider` 的旧设置继续使用角色别名和 `WHYJ_QUANT_*` 模型变量。打开编辑器时将当前连接转换为明确的 provider/实际 ID 草稿，保留实际端点、密钥及窗口覆盖；只有 Save 才写入新连接。新模式中的实际 ID 不受旧 `WHYJ_DEFAULT_*_MODEL` 映射强制改写，窗口改用当前模型的能力覆盖。未编辑的旧默认配置仍保存 `model: "sonnet"`，其默认解析为 `deepseek-v4-pro`。

加载设置时会执行规范化并写回：

- v1、v2 配置统一升级并写回为 `version: 3`。
- v2 的 `artifactGeneration.mode: "auto" | "manual"` 会迁移为 `artifactGeneration.auto: true | false`；旧字段不再写回。
- 旧的 `skillIntegrations.codex` 或 `skillIntegrations.claude` 只要任一为 `true`，迁移为 `skillIntegrations.external: true`；旧字段不再写回。
- 旧的无运行时效果的 `insightEnabled` 字段会被移除。
- `Thinking: off` 是合法持久化值，不会再被改回 `high`。
- 未知的 thinking level 或 market-data source 会回退到对应默认值。

密钥不得输出到日志、Artifact 或完整配置摘要中。`/config` 和 `/doctor` 只显示存在状态或脱敏值。

## 测试方式

```powershell
bun test src/tui/test/settings-refresh.test.ts src/tui/test/research-workflow.test.ts
bun test src/runtime/model-benchmark.test.ts src/runtime/hud.test.ts src/app-hud.test.ts src/tui/test/hud-settings.test.ts
bun test src/tui/test/market-colors.test.ts src/artifact/test/market-colors.test.ts
bun test src/agent/test/model-connection.test.ts src/agent/test/model-request.test.ts src/tui/test/model-settings-panel.test.ts
bun test src/storage/test/durable-preferences.test.ts src/tui/test/settings-conflict.test.ts
bun test src/runtime/data-readiness.test.ts src/cli/doctor-data.test.ts
bun test src/runtime/data-settings.test.ts src/tui/test/data-settings-panel.test.ts src/app-doctor.test.ts
bun test src/runtime/tool-readiness.test.ts src/cli/doctor-tools.test.ts src/tools/tool-cancellation.test.ts
bun test src/runtime/tool-probe.test.ts src/tui/test/tool-capabilities-panel.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

单元测试使用真实 Pi 目录和 SDK 请求构造器；集成测试仅连接 `127.0.0.1` 临时服务，覆盖切换、会话保留、空响应、401、超时、配置修复和 smoke 结果判定。面板测试覆盖搜索、草稿、分步凭证设置、密钥遮蔽及 60×20/80×24/120×32 渲染。

持久化测试使用独立临时目录，覆盖同版本草稿的八进程竞争、组合的八进程修改、旧草稿冲突、迁移遇锁、损坏文件保留和 CLI 错误。面板回归覆盖 80×24 的冲突提示、保存重试、取消密钥草稿和失败开关回滚，不使用真实账户。

账户连通性需要单独验证：运行 `Save & Verify`，或 `bun run src/index.ts -- -c "/doctor --phase model"`。只检查模型时，未检测的 Tools/Data 保持 pending；JSON 的 `requestedPhases` 说明本次范围。`bun run test:providers` 发送真实最小请求，读取当前配置，任何错误、空回答或超时都返回失败；会产生供应商请求用量。离线测试通过不代表真实账户已通过验证。

Doctor 保留原有命令返回约定：退出码 `0`、JSON `ok: true` 和 `ready: true` 表示诊断报告已生成，不保证模型或数据服务可用。自动化检查需读取 `data.phases` 中 `phase: "model"` 的 `status === "pass"`，同时确认没有 `Network probe skipped` 警告。模型返回 401 时报告应为 `partial_fail`，模型 phase 为 `fail`。需要按连通性设置进程退出码时使用 `bun run test:providers`。

本轮实现、回归测试与构建产物验证的对应关系见 [模型配置验收记录](./model-config-audit.md)。

单独的 `/doctor --tool …` 是端点请求检查：`data.status === "ready"` 才返回 `ok: true` 和退出码 0，失败/空响应为非零；不是三阶段诊断报告的 `ready` 约定。用法见 [Slash 参考](./slash-commands.md)。
