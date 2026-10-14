---

version: alpha
name: WhyJ-Quant-Design-System
description: An AI-native quantitative research terminal built around a single premium gold accent. Deep-black canvases, geometric sans-serif typography, generous whitespace, and signal-first information architecture create a terminal experience that feels closer to Claude Code, Linear, and Bloomberg than traditional retail trading software. The interface removes decorative finance tropes and focuses on clarity, conviction, and research workflows.

colors:
primary: "#D4AF37"
primary-focus: "#E2BE4D"
primary-on-dark: "#F0D77A"
ink: "#F5F5F5"
body: "#F5F5F5"
body-on-dark: "#F5F5F5"
body-muted: "#A6A6A6"
divider-soft: "#1A1A1A"
hairline: "#242424"
canvas: "#0B0B0C"
surface: "#111111"
surface-elevated: "#171717"
surface-terminal: "#000000"
on-primary: "#0B0B0C"
on-dark: "#F5F5F5"

typography:
hero-display:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 56px
fontWeight: 700
lineHeight: 1.05
letterSpacing: -1.2px

display-lg:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 40px
fontWeight: 700
lineHeight: 1.1
letterSpacing: -0.8px

display-md:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 32px
fontWeight: 700
lineHeight: 1.15
letterSpacing: -0.6px

lead:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 24px
fontWeight: 400
lineHeight: 1.4
letterSpacing: 0px

tagline:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 18px
fontWeight: 500
lineHeight: 1.4
letterSpacing: 0px

body-strong:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 16px
fontWeight: 600
lineHeight: 1.5
letterSpacing: 0px

body:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 16px
fontWeight: 400
lineHeight: 1.6
letterSpacing: 0px

caption:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 13px
fontWeight: 400
lineHeight: 1.4
letterSpacing: 0px

caption-strong:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 13px
fontWeight: 600
lineHeight: 1.4
letterSpacing: 0px

button:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 14px
fontWeight: 500
lineHeight: 1
letterSpacing: 0px

nav-link:
fontFamily: "Geist Sans, Inter, system-ui, sans-serif"
fontSize: 13px
fontWeight: 500
lineHeight: 1
letterSpacing: 0px

rounded:
none: 0px
xs: 4px
sm: 8px
md: 12px
lg: 16px
pill: 9999px
full: 9999px

spacing:
xxs: 4px
xs: 8px
sm: 12px
md: 16px
lg: 24px
xl: 32px
xxl: 48px
section: 80px

components:
button-primary:
backgroundColor: "{colors.primary}"
textColor: "{colors.on-primary}"
typography: "{typography.button}"
rounded: "{rounded.pill}"
padding: 10px 18px

button-secondary:
backgroundColor: transparent
textColor: "{colors.primary}"
typography: "{typography.button}"
rounded: "{rounded.pill}"
padding: 10px 18px

terminal-panel:
backgroundColor: "{colors.surface-terminal}"
textColor: "{colors.body}"
rounded: "{rounded.none}"

card:
backgroundColor: "{colors.surface}"
textColor: "{colors.body}"
rounded: "{rounded.lg}"
padding: 24px

card-elevated:
backgroundColor: "{colors.surface-elevated}"
textColor: "{colors.body}"
rounded: "{rounded.lg}"
padding: 24px

navigation:
backgroundColor: "{colors.canvas}"
textColor: "{colors.body}"
typography: "{typography.nav-link}"
height: 48px

portfolio-widget:
backgroundColor: "{colors.surface}"
textColor: "{colors.body}"
rounded: "{rounded.md}"
padding: 20px

command-input:
backgroundColor: "{colors.surface-terminal}"
textColor: "{colors.body}"
rounded: "{rounded.none}"
height: 44px

footer:
backgroundColor: "{colors.canvas}"
textColor: "{colors.body-muted}"
typography: "{typography.caption}"
padding: 48px
-
Wordmark:

WhyJ Quant

Font:

Geist Sans

Weight:

600

Tracking:

-0.02em

Color:

#F5F5F5

Accent:

#D4AF37

Background:

#0B0B0C

## Brand Rules

Only one accent color exists:

{colors.primary}

Never introduce:

* Green
* Red
* Blue
* Purple

as brand colors.

Market movement colors are data visualization concerns and not brand identity.

## Market and status semantics

The shared brand gold is `#D4AF37`, focus gold `#E2BE4D`, text `#F5F5F5`, muted text `#A6A6A6`, and hairline `#242424`.

`/config → Market Colors` selects one explicit convention for the workspace, including mixed-market portfolios: `red-up` (default, red up / green down) or `green-up` (green up / red down). Overview, tables, candles and newly generated HTML use the same convention; report versions retain the convention captured when generated.

Movement and outcome use separate tokens. Positive/negative command status, scores and risk amounts do not change when the market convention changes. Rounded zero, flat candles and unavailable values use neutral gray; gains/losses retain signs, and reports include a legend. Brand gold does not imply a positive financial result.

### 色彩规范与实现映射（2026-10-13）

本文件是产品、TUI、报告、文档站与演示的视觉规范。共享实现为 [theme-colors.ts](./src/types/theme-colors.ts)；终端和报告消费同一组语义，不各自发明主题。下表登记已有规范及实现映射，不新增品牌色。

| 用途 | 规范值 / 行为 | 约束 |
|---|---|---|
| 品牌主色、选中背景 | `#D4AF37` | 唯一品牌强调色；不表示盈利、买入或成功 |
| 焦点强调 | `#E2BE4D` | 键盘焦点与活动态，同属金色层级 |
| 深色背景上的亮金 | `#F0D77A` | 标题或局部强调，不另立 cash gold 主色 |
| 正文 / 次要文字 | `#F5F5F5` / `#A6A6A6` | 信息层级不依赖颜色；重要限制不能只用极暗灰 |
| 画布 / 面板 / 细分隔线 | `#0B0B0C` / `#111111` / `#242424` | 终端画布可使用既定纯黑；分隔线不承担文字含义 |
| 行情 `red-up` | 涨 `#E5494D`、跌 `#1E9F4D` | 默认约定，同一工作区跨市场一致 |
| 行情 `green-up` | 涨 `#1E9F4D`、跌 `#E5494D` | 由 Market Colors 显式选择，不按单个标的自动反转 |
| 操作成功 / 失败 | `#1E9F4D` / `#E5494D` | 不随行情约定翻转，必须同时显示状态文字 |
| 风险量 / 评分 | 独立的 `negative` / `positive` 语义 | 回撤、VaR 等不能因为数值带正号就着盈利色；评分色不证明投资价值 |
| 平盘、显示精度下的零变化、缺失 | `#A6A6A6` | 仍区分 `0.00%` 与 `N/A` / `--`，缺失不能伪造为零 |

品牌、行情和状态是三种职责，不是三个主题。红绿只用于数据和状态，不进入 Logo、主导航或营销装饰；金色也不用于暗示金融结果的好坏。文字、正负号、箭头、数值、图例共同表达含义，单色下仍应可读。

`/config → Market Colors` 修改工作区偏好后重绘，不额外触发行情请求；新报告捕获生成时约定，历史报告字节不随设置改写。演示中采用合成数字须标注，旧参考截图不可充当默认涨跌约定或运行证明。

旧渲染稿的 amber / `#E8B339` cash gold 和固定 A 股配色不再是并行规范；保留原因与代价见 [终端演进记录](./docs/blog/10-layout-and-visual-language.md#visual-language)。具体语义映射与验证见 [渲染指南](./docs/quant-harness/quant-uiux.md#structured-render)。

## Layout Principles

Left aligned.

Whitespace first.

Content over decoration.

Signal over chrome.

Research over excitement.

## Product Motto

Research.
Backtest.
Analyze.

Alternative:

Think in Signals.

Alternative:

Research Before Conviction.
