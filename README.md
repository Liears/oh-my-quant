# WhyJ Quant

交互式量化分析终端 — AI Agent 驱动，slash commands 操作，本地数据存储。

[![npm](https://img.shields.io/npm/v/whyj-quant)](https://www.npmjs.com/package/whyj-quant)

![WhyJ Quant terminal homepage](./docs/assets/terminal.png)

## Windows Desktop 1.3.1

`app` 分支提供与 CLI 共用界面的 Electron 桌面版。下载 [Windows 一键安装包](https://github.com/yangjingo/oh-my-quant/releases/tag/v1.3.1)，安装后从桌面启动；内置 Bun、Python/AKShare、AKQuant 和 Git，无需另装开发环境。首次 AI 分析按 `Ctrl+P` 配置自己的模型连接。

支持中文输入、多行安全粘贴、复制、字号调整和窗口状态保存。安装、数据目录、构建及验收说明见 [桌面版文档](./docs/desktop.md)。

## What's New in 1.2.0

- Artifact 升级为华尔街终端风格的量化 Dashboard：K 线、NAV/收益曲线、风险收益指标、因子与数据覆盖度各司其职，并统一使用 WhyJ TUI 主题色。
- Trajectory 按 Turn 完整复原用户输入、模型输入、Tool/Bash/Skill calls、Call ID、returns、thinking/compact 与最终 outputs；命令和关键结果会重点高亮。
- `/artifact` 提供报告浏览与恢复，也可在面板按 `P` 打开私有账户年报文件导出向导；`Auto Artifacts` 只在 `/config` 开启，量化 turn 完成后自动生成并打开浏览器。
- Overview 刷新链路可从失败和超时中恢复，开放式基金代码保留 `.OF` 语义；无有效行情时显示 `--`，不再伪造 `0.00`。
- Slash command、Settings 与外部 Skills 配置统一为简洁的一层语义，Codex/Claude/Agents/pi 用户级 skills 合并到单一 `External Skills` 开关。

完整变更见 [CHANGELOG](./CHANGELOG.md)。

当前开发版已将 pi 内核升级到 1.1.0，删除本地循环和协议副本；会话、模型配置、状态映射、压缩及导航分别维护。边界与升级流程见 [pi 内核与会话适配](./docs/pi-agent-loop-harness.md)，数据与组合验收见 [核心验收记录](./docs/core-data-audit.md)。

开发版报告按版本保存；`/artifact` 可选择历史版本并恢复当时分支，价格图引用归档行情。来源缺失时隐藏不可恢复项并保留文件；文本结论和分享过滤的边界见 [存储策略](./docs/ohquant-storage-policy.md#artifacts)。

## Quick Start

全局安装：

```bash
npm i -g whyj-quant
whyj
```

本地开发：

```bash
bun install
bun run src/index.ts
```

首次启动后先打开配置面板：

```
Q > /config
```

Settings 面板按语义分成三组：

- `Agent Runtime`：Model 打开统一连接编辑器，搜索 Provider/实际模型 ID、填写凭证、选择 Thinking，再 Save 或 Save & Verify。
- `Research Data`：Market Data、Data Token、Portfolios。
- `Workspace Experience`：External Skills、Overview Dock、Auto Artifacts、Market Colors、Status HUD、Compact At。

面板只显示设置项与当前值；完整字段语义、默认值和迁移规则见 [WhyJ Quant 配置参考](./docs/configuration.md)。

也可以直接写入默认配置文件 `.ohquant/settings.json`：

```json
{
  "version": 3,
  "env": {
    "WHYJ_QUANT_TUSHARE_TOKEN": "your_token",
    "WHYJ_QUANT_FINANCIAL_DATASETS_KEY": "your_key",
    "WHYJ_QUANT_LLMQUANT_API_KEY": "your_key"
  },
  "provider": "deepseek",
  "model": "deepseek-v4-pro",
  "providers": { "deepseek": { "apiKey": "your-provider-key" } },
  "thinkingLevel": "high",
  "showPortfolioPanel": true,
  "artifactGeneration": { "auto": false },
  "skillIntegrations": { "external": false }
}
```

模型目录、默认端点和能力来自 Pi provider 包。密钥按 provider 保存；Cloudflare、AWS 等可通过 `Provider setup` 使用 Pi 自带的分步配置。编辑为草稿，保存后新提交的对话使用新连接并保留历史。高级端点、协议、模型窗口覆盖与旧配置迁移见 [配置参考](./docs/configuration.md)。

支持 OAuth 的 provider 可选择 `Sign in & Save`，包括 `openai-codex`；按提示完成浏览器或设备码授权，成功即保存。`Ctrl+O` 打开授权链接，Esc 取消登录。退出、切换回 API-key 及真实账号验收边界见 [OAuth 使用与测试](./docs/model-oauth.md)。

`External Skills` 默认关闭，只加载项目量化 skills；开启后统一加载用户级 Codex、Claude、Agents 和 pi skills。

输入 `/portfolio` 创建自定义组合，添加 A 股、美股、港股或 `.OF` 基金代码。空组合也会保留，修改立即保存并刷新 Overview；组合只保存标的与分组，不保存个人仓位。

也可让 Agent 创建或编辑观察组，并比较两组在指定区间、基准与币种下的收益和风险。比较会自动获取价格/NAV 与同日汇率，保存权重、共同日期和缺失原因，可按历史 ID 重算；完整示例与测试见 [观察组合比较](./docs/portfolio-comparison.md)。

可以继续让 Agent 用选定的比较 ID 生成年度/YTD 研究报告，返回离线 HTML 路径，并按报告 ID 恢复原版本。报告包含数据核对、风险收益、覆盖缺口和有原文出处的历史观点；真实账户业绩与年度决策历史尚未接入，使用与测试见 [年度研究报告](./docs/annual-reports.md)。

Overview 启动后自动取数，每轮结束 60 秒后刷新。量化工具会自动补齐并更新所需日线；失败时使用缓存会明确标为 `stale-cache`，数据日期独立展示。A 股默认使用零密钥的 AKShare 路径，需要本机 Python 环境已安装 `akshare`；其他 provider 在 Settings 配置相应凭证。

配置完成后直接提问：

```
Q > 分析平安银行的动量因子和风险指标
```

## Commands

Shell-level commands:

| 命令 | 说明 |
|------|------|
| `whyj` | 启动交互式 REPL |
| `whyj --help` | 查看 CLI 入口帮助 |
| `whyj --version` | 查看 WhyJ 与内置 Pi 包版本；`--json --version` 输出机器可读版本 |
| `whyj --json doctor` | 检查 runtime、配置目录、auth 来源 |
| `whyj -c "/help"` | 执行单条 slash command 后退出 |
| `whyj --json -c "/portfolio"` | 执行单条 slash command 并输出 JSON envelope |
| `whyj paper agent --root ABS --account ID` | 在显式选择的私有本地模拟盘启动独立 Agent；提交/撤单须终端按意图哈希审阅 |
| `whyj alpaca-paper account|submit|lookup|cancel ...` | 使用独立 paper 凭证，在所选私有目录和 Alpaca Paper 服务操作整股 GTC 限价单 |

Slash commands:

| 命令 | 一级描述 | 结果 |
|---|---|---|
| `/compact` | Compact research session context | 压缩当前 session，可附带关注点 |
| `/resume` | Resume saved research sessions | 浏览并恢复历史 session |
| `/portfolio` | Manage observation portfolios | 创建组合、增删标的、重命名和删除 |
| `/config` | Configure models and research data | 查看或编辑 Settings |
| `/doctor` | Check model and market data readiness | 首次配置或诊断 runtime readiness |
| `/skill` | Discover, audit, and run skills | 发现、查看、核验和运行 skills |
| `/help` | Browse commands and shortcuts | 查看命令与快捷键 |
| `/clear` | Reset the current research session | 清空对话并重置 agent |
| `/artifact` | Browse and restore research reports | 浏览报告，恢复来源 session 并在浏览器打开 |
| `/exit` | Exit WhyJ Quant | 退出 WhyJ Quant |

无 `/` 前缀直接输入自然语言 → AI Agent 分析。因子、回测、风险与策略评分由 agent 调用内置 Quant tools（`Quant.Factor`、`Quant.Backtest`、`Quant.Risk`、`Quant.Benchmark`）完成；行情拉取与缓存由 agent 通过已配置的 `Source` 自动处理。

报告自动生成默认关闭，只能在 `/config` 面板通过 `Auto Artifacts` 开启。开启后，量化研究类 turn 完成并写入完整调用轨迹时自动生成 Dashboard + Trajectory，同时打开浏览器预览。`/artifact` 面板可浏览、恢复和打开已有报告；按 `P` 进入显式的本地私有年报导出，不触发 Agent 或公开分享。

输入 `/resume --task` 可只读查看当前研究的目标、验收条件、证据和失败原因；方向键滚动、Enter 刷新、Esc 关闭。继续或修改任务时，在普通输入框说明要求。使用方式与测试见 [结构化研究任务](./docs/research-tasks.md)。

完整的 TUI/非 TUI 行为、参数与兼容边界见 [Slash Command 参考](./docs/slash-commands.md)。

模拟盘须先用 `whyj paper init` 创建私有账户。`whyj paper agent` 会把该账户/订单上下文发送给已配置的模型，转录保存在所选私有账本的 `agent-sessions/`；它只处理纸面订单，不进入默认研究会话。命令和测试见[执行适配契约](./docs/execution.md#显式私有-paper-agent2026-09-16)。

外部 Alpaca Paper 使用独立的 `ALPACA_PAPER_KEY_ID` 和 `ALPACA_PAPER_SECRET_KEY`，只通过 `whyj alpaca-paper` 显式文件终端调用；账户 ID、私有目录和完整意图文件须由用户选择。当前仅做假 HTTP 服务隔离测试，真实 paper 账户验收和 live 执行仍待完成，详见[外部 paper 流程](./docs/execution.md#alpaca-paper-外部适配器2026-09-16)。

用 `/help portfolio` 或 `/portfolio --help` 查看具体用法。所有十个命令都支持帮助查询，不会执行目标操作；`whyj --json -c "/clear --help"` 即使配置损坏也能返回说明。

## Dev

```bash
bun install
bun run src/index.ts
bun run src/index.ts -- --version
bun run src/index.ts -- -c "/help"   # one-shot mode
bun run src/index.ts -- --json doctor
```

模型连接配置后可运行 `bun run bench:model -- --samples 5`，使用固定输入采集 TTFT/TPOT 和 p50/p95；会产生模型用量，不执行行情或交易工具。工具开关、thinking、输出文件及测量口径见 [模型性能测试](./docs/model-performance.md)。

工程验证依次运行 `bun run typecheck`、`bun run check:architecture`、`bun run test`、`bun run build`。真实模型研究评测使用 `bun run eval:research -- --case all --output output/research-evaluation.json`，会产生模型用量；行情/新闻/账户输入为隔离合成数据，21 个 LLMQuant skill 案例覆盖五个 router 的全部 reviewed workflow，也可用 `--case skill-all` 单独运行。范围、自动检查与回答审阅要求见 [研究任务评测](./docs/research-task-evaluation.md)和 [Skill 模型评测](./docs/skill-evaluation.md)。

## JSON Policy

`--json` 输出稳定 envelope：

```json
{
  "ok": true,
  "command": "skill",
  "message": "human-readable summary",
  "data": {}
}
```

错误不会打印密钥：

```json
{
  "ok": false,
  "command": "skill",
  "error": {
    "code": "command_failed",
    "message": "safe error message"
  }
}
```

`doctor` 报告凭证是否存在、来源类别和 redacted value fingerprint；不会打印完整 secret。`whyj --json doctor` 和 `/doctor` 使用同一套报告逻辑。

## Docs

从 [文档导航](./docs/README.md) 进入，按产品与交付、Quant Harness、Quant UI/UX 三类组织。

- [产品需求与完成度](./docs/PRD.md)：逐项实现证据、缺口与验收条件。
- [实施路线](./docs/roadmap.md)：优先级、依赖和交付切片。
- [Quant Harness](./docs/quant-harness.md)：Pi 运行时、研究上下文、数据与扩展边界。
- [Quant UI/UX](./docs/quant-uiux.md)：终端布局、日常研究流程与报告体验。
- [配置](./docs/configuration.md) / [命令参考](./docs/slash-commands.md)：实际使用契约。
- [项目演示稿](./docs/slides.html)：产品、技术决策与已发现的问题。
