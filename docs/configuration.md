# WhyJ Quant 配置参考

WhyJ Quant 的配置单一真源是 `.ohquant/settings.json`。交互模式使用 `/config` 或 `Ctrl+P` 打开 Settings 面板；修改会立即保存。首次配置 provider 时也可以使用 `/doctor` 向导完成保存与验证。

`/config`、`/doctor` 与 `/artifact` 的 TUI/非 TUI 边界见 [Slash Command 参考](./slash-commands.md)。

## 用户可见设置

| Settings 分组 | 面板选项 | JSON 字段 | 默认值 | 语义 |
|---|---|---|---|---|
| Agent Runtime | `Model` | `model` | `sonnet` | AI Agent 使用的模型别名或直接模型 ID。存在 `WHYJ_DEFAULT_*_MODEL` 映射时，值必须匹配别名或映射值。 |
| Agent Runtime | `Thinking` | `thinkingLevel` | `high` | 推理深度：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`。深度越高，通常延迟和 token 使用越高。 |
| Agent Runtime | `Provider Key` | `env.WHYJ_QUANT_API_KEY` | 未配置 | 模型 provider 凭证。本地保存，界面只显示脱敏值。`WHYJ_QUANT_AUTH_TOKEN` 仅作为旧配置 fallback。 |
| Agent Runtime | `Provider URL` | `env.WHYJ_QUANT_BASE_URL` | provider 默认值 | 模型端点。运行时根据 `/anthropic` 或 `/v1` 等端点形态选择 Anthropic Messages 或 OpenAI-compatible 协议。 |
| Research Data | `Market Data` | `preferences.source` | `llmquant-data` | 首选行情 provider。Provider 失败时仍使用文档定义的市场与 source fallback 链。 |
| Research Data | `Data Token` | 对应 `env.WHYJ_QUANT_*` key | 未配置 | 当前 Market Data provider 的凭证；AKShare 不需要 token。 |
| Research Data | `Active Portfolio` | `preferences.currentPortfolioFile` | `holdings.json` | Overview dock 使用的 symbol group。行情报价实时获取，不把个人持仓或仓位快照写入缓存。 |
| Workspace Experience | `External Skills` | `skillIntegrations.external` | `false` | 开启后额外加载用户级 Codex、Claude、Agents 和 pi skills；项目量化 skills 始终加载。 |
| Workspace Experience | `Overview Dock` | `showPortfolioPanel` | `true` | 显示右侧 Overview dock；关闭后 Analyzing 面板使用完整终端宽度。 |
| Workspace Experience | `Auto Artifacts` | `artifactGeneration.auto` | `false` | 开启后在量化分析 turn 完整结束时生成 Dashboard + Trajectory 并打开浏览器；关闭时不自动生成。`/artifact` 始终只浏览、恢复和打开已有报告。 |

## Market Data 与凭证

| Market Data | 主要市场 | Data Token |
|---|---|---|
| `akshare` | A 股、指数、基金 | 不需要 |
| `tushare` | A 股、基金 | `WHYJ_QUANT_TUSHARE_TOKEN` |
| `llmquant-data` | 美股、港股 | `WHYJ_QUANT_LLMQUANT_API_KEY` |
| `financial-datasets` | 美股价格与快照 | `WHYJ_QUANT_FINANCIAL_DATASETS_KEY` |

## 规范化配置示例

```json
{
  "version": 3,
  "env": {
    "WHYJ_QUANT_API_KEY": "sk-...",
    "WHYJ_QUANT_BASE_URL": "https://api.deepseek.com/anthropic",
    "WHYJ_QUANT_TUSHARE_TOKEN": "your_token"
  },
  "model": "sonnet",
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

## 兼容迁移

加载设置时会执行规范化并写回：

- v1、v2 配置统一升级并写回为 `version: 3`。
- v2 的 `artifactGeneration.mode: "auto" | "manual"` 会迁移为 `artifactGeneration.auto: true | false`；旧字段不再写回。
- 旧的 `skillIntegrations.codex` 或 `skillIntegrations.claude` 只要任一为 `true`，迁移为 `skillIntegrations.external: true`；旧字段不再写回。
- 旧的无运行时效果的 `insightEnabled` 字段会被移除。
- `Thinking: off` 是合法持久化值，不会再被改回 `high`。
- 未知的 thinking level 或 market-data source 会回退到对应默认值。

密钥不得输出到日志、Artifact 或完整配置摘要中。`/config` 和 `/doctor` 只显示存在状态或脱敏值。
