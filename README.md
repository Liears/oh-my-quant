# WhyJ Quant

交互式量化分析终端 — AI Agent 驱动，slash commands 操作，本地数据存储。

[![npm](https://img.shields.io/npm/v/whyj-quant)](https://www.npmjs.com/package/whyj-quant)

![WhyJ Quant terminal homepage](./docs/assets/terminal.png)

## What's New in 1.1.2

- HUD 简化为更专业的终端状态栏，只保留 Ctx、TTFT、TPOT、T 四个核心指标。
- TTFT 与 TPOT 改为跨多轮会话的平均值，更适合观察模型整体响应表现。
- 底部状态栏进一步收紧间距，信息密度更高，视觉上更接近专业交易终端。

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

- `Agent Runtime`：Model、Thinking、Provider Key、Provider URL。
- `Research Data`：Market Data、Data Token、Active Portfolio。
- `Workspace Experience`：External Skills、Overview Dock、Auto Artifacts。

面板只显示设置项与当前值；完整字段语义、默认值和迁移规则见 [WhyJ Quant 配置参考](./docs/configuration.md)。

也可以直接写入默认配置文件 `.ohquant/settings.json`：

```json
{
  "version": 3,
  "env": {
    "WHYJ_QUANT_API_KEY": "sk-...",
    "WHYJ_QUANT_BASE_URL": "https://api.deepseek.com/anthropic",
    "WHYJ_QUANT_AUTH_TOKEN": "sk-...",
    "WHYJ_QUANT_CONTEXT_WINDOW": "1000000",
    "WHYJ_QUANT_COMPACT_TRIGGER_TOKENS": "800000",
    "WHYJ_QUANT_TUSHARE_TOKEN": "your_token",
    "WHYJ_QUANT_FINANCIAL_DATASETS_KEY": "your_key",
    "WHYJ_QUANT_LLMQUANT_API_KEY": "your_key"
  },
  "model": "sonnet",
  "thinkingLevel": "high",
  "showPortfolioPanel": true,
  "artifactGeneration": { "auto": false },
  "skillIntegrations": { "external": false }
}
```

模型上下文相关变量：

| 环境变量 | 作用 | 示例 |
|----------|------|------|
| `WHYJ_QUANT_CONTEXT_WINDOW` | 当前模型支持的上下文 token 总量；覆盖模型注册表/fallback 元数据，并用于底栏容量与占用百分比 | `"1000000"` |
| `WHYJ_QUANT_COMPACT_TRIGGER_TOKENS` | 当前上下文估算达到该 token 数后，在下一次 prompt 发送前自动 compact | `"800000"` |

两个值都应写成正整数字符串。compact 阈值独立于模型窗口；若配置值大于 context window，运行时会将其限制为 context window。未配置 compact 阈值时，默认使用 `contextWindow - 16384`。

模型选择校验：如果 `env` 中配置了 `WHYJ_DEFAULT_SONNET_MODEL`、`WHYJ_DEFAULT_OPUS_MODEL` 或 `WHYJ_DEFAULT_HAIKU_MODEL`，顶层 `model` 必须是对应别名（`sonnet` / `opus` / `haiku`）或其中一个映射值。其他值会在 settings 加载/保存时强制回退到第一个已配置别名，优先级为 sonnet、opus、haiku。未配置任何角色映射时，仍允许直接模型 ID。

`External Skills` 默认关闭，只加载项目量化 skills；开启后统一加载用户级 Codex、Claude、Agents 和 pi skills。

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
| `whyj --json doctor` | 检查 runtime、配置目录、auth 来源 |
| `whyj -c "/help"` | 执行单条 slash command 后退出 |
| `whyj --json -c "/portfolio"` | 执行单条 slash command 并输出 JSON envelope |

Slash commands:

| 命令 | 一级描述 | 结果 |
|---|---|---|
| `/compact` | Compact current session context | 压缩当前 session，可附带关注点 |
| `/resume` | Browse and restore saved sessions | 浏览并恢复历史 session |
| `/portfolio` | Browse and select local portfolios | 浏览并选择本地 portfolio |
| `/config` | Review and edit runtime settings | 查看或编辑 Settings |
| `/doctor` | Configure and diagnose runtime | 首次配置或诊断 runtime readiness |
| `/skill` | Discover, inspect, and run skills | 发现、查看和运行 skills |
| `/help` | Browse commands and shortcuts | 查看命令与快捷键 |
| `/clear` | Clear conversation and reset agent | 清空对话并重置 agent |
| `/artifact` | Browse, restore, and open reports | 浏览报告，恢复来源 session 并在浏览器打开 |
| `/exit` | Exit WhyJ Quant | 退出 WhyJ Quant |

无 `/` 前缀直接输入自然语言 → AI Agent 分析。因子、回测、风险与策略评分由 agent 调用内置 Quant tools（`Quant.Factor`、`Quant.Backtest`、`Quant.Risk`、`Quant.Benchmark`）完成；行情拉取与缓存由 agent 通过已配置的 `Source` 自动处理。

报告自动生成默认关闭，只能在 `/config` 面板通过 `Auto Artifacts` 开启。开启后，量化研究类 turn 完成并写入完整调用轨迹时自动生成 Dashboard + Trajectory，同时打开浏览器预览；`/artifact` 本身只负责浏览、恢复和打开已有报告。

完整的 TUI/非 TUI 行为、参数与兼容边界见 [Slash Command 参考](./docs/slash-commands.md)。

## Dev

```bash
bun install
bun run src/index.ts
bun run src/index.ts -- -c "/help"   # one-shot mode
bun run src/index.ts -- --json doctor
```

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

### Architecture & System

- [Agent System Spec](./docs/agent-system-spec.md) — full architecture, tool system, session management
- [pi Agent Loop & Harness](./docs/pi-agent-loop-harness.md) — harness lifecycle, compaction, queue drains, branch navigation
- [Agent Loop Context Assembly](./docs/agent-loop-context.md) — model-input vs UI-text assembly path
- [Module Architecture](./docs/module-architecture.md) — repo-level module boundaries and dependency direction
- [Storage Policy](./docs/ohquant-storage-policy.md) — local filesystem split: durable settings, cache, artifacts, forbidden state
- [Configuration Reference](./docs/configuration.md) — Settings 面板、JSON 字段、默认值、凭证和兼容迁移

### CLI & UX

- [Slash Command Reference](./docs/slash-commands.md) — 一级目录、执行结果、参数和 TUI/非 TUI 行为
- [CLI Design & Reference](./docs/interactive-cli-design.md) — slash commands, `src/cli/` module, implementation plan
- [Doctor, Config, and UX Guidelines](./docs/doctor-design-and-hints.md) — doctor checks, config flow, UX interaction, errors, guidance

### TUI

- [TUI Layout Design](./docs/tui-layout-design.md) — five-region frame-buffer layout and interaction model
- [TUI Table/Chart Render](./docs/tui-table-chart-render.md) — structured agent output rendering in the TUI
- [Design System (NewForm)](./DESIGN.md)

### Agent Tools & Skills

- [Built-in Tool Registry](./docs/builtin-tool-registry.md) — unified registration path for built-in agent tools
- [Quant Tools Design](./docs/quant-tools-design.md) — factor, backtest, risk, and benchmark as agent tools
- [Skill 系统](./docs/trader-skills.md) — skill 架构、安装、发现、CLI handler、TUI 集成及完整技能目录

### Data

- [Source Providers](./docs/source-data-providers.md) — official interfaces, source priority, agent/runtime injection
- [Source Module](./src/source/README.md) — provider adapters, fallback rules, module test layout

### 参考

- [量化资源索引](./docs/source-data-providers.md) — 数据源 provider、Python 库、API 参考（已合并至此）
- [Skill 系统](./docs/trader-skills.md) — 外部 skill 生态、AI 交易平台、学习资源（已合并至此）
- [Personal Notes](./notes/README.md) — 投资知识库：`notes.md`（原则/法则/框架）+ `funder.md`（16 位大师索引）+ `daily.md`（每日笔记）。其中 `notes.md` 和 `funder.md` 被 `/insight` 管道消费，自动生成为 Agent 思考时展示的投资格言
