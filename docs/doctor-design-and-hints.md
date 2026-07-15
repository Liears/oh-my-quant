# Doctor、Config 与 UX 指南

本文档定义 WhyJ Quant 的 doctor 检查、配置流程、提示、CLI/TUI 行为、slash 命令、安装和 review 工作流的可用性标准。

## 原则

每个面向用户的流程应回答四个问题：

1. 发生了什么？
2. 为什么会发生？
3. 接下来可以做什么？
4. 需要详细信息时去哪里？

在边界处使用产品语言，在实现内部使用诊断语言。内部消息如 `Session not found`、`Agent harness not initialized`、`Clone failed` 或原始 provider 错误，应在 CLI/TUI 边界处映射后再呈现给用户。

## 配置

单一真源：`.ohquant/settings.json`

用户入口统一称为 `Settings`，命令仍为 `/config`。面板按 `Agent Runtime`、`Research Data`、`Workspace Experience` 分组，字段名称与 JSON 映射以 [WhyJ Quant 配置参考](./configuration.md) 为准。不要在 README、Doctor 或 TUI 中为同一字段使用另一套别名。

推荐字段：

```json
{
  "env": {
    "WHYJ_QUANT_API_KEY": "sk-...",
    "WHYJ_QUANT_BASE_URL": "https://api.deepseek.com/anthropic",
    "WHYJ_QUANT_AUTH_TOKEN": "sk-..."
  }
}
```

规则：

- 不要推荐项目根目录的 `.env` 文件。
- `/config` 应写入 `.ohquant/settings.json`。
- `doctor` 应报告配置路径、认证来源和脱敏值，而不输出完整密钥。
- UI 中显示的模型标签和值在展示前必须剥离终端控制码。
- 统一命名使用 `WHYJ_QUANT_*` 前缀。`WHYJ_QUANT_API_KEY` 是模型凭证槽位，`WHYJ_QUANT_BASE_URL` 是端点槽位。
- `WHYJ_QUANT_AUTH_TOKEN` 仅作为兼容旧配置的模型凭证 fallback；新的配置入口仍应写入并引导用户使用 `WHYJ_QUANT_API_KEY`。
- 如果 `WHYJ_QUANT_BASE_URL` 指向 Anthropic 兼容端点，如 `/anthropic`，运行时必须自动选择 Anthropic Messages provider，而不是强制使用 OpenAI-compatible 路径。
- 如果 `WHYJ_QUANT_BASE_URL` 的尾段是 OpenAI-compatible 形态，如 `/v1`，运行时必须保持 `openai-completions` 路径，即使同一厂商也同时提供 `/anthropic` 端点。
- 如果配置了 `/anthropic`，doctor 和提示应指出工具重放是 Anthropic 形态的，因此 `tool_use` 之后必须紧跟 `tool_result` 块。
- 仅在显示边界剥离终端控制码。配置值、模型 ID 和 provider URL 应按原样读取和存储，除非代码显式用于渲染。
- 不要将仅用于显示的控制码剥离器当作配置解析器重用。如果值可以合法包含括号或后缀，应保留它并单独为 UI 副本格式化。

## UX 交互

交互文本应描述状态，而非实现。

使用此模式：

```text
Agent 仍在启动中。您的消息已保留在 composer 中；请稍后重新发送。
```

避免此模式：

```text
正在初始化... 请稍候。
```

必要行为：

- 打开面板的命令应避免在面板本身即为结果时产生重复输出。
- 无操作应为 `info` 而非 `error`（当没有损坏时）。
- 长时间运行的操作应命名当前阶段，例如 `compacting`、`running tool` 或 `fetching`。
- 空状态应说明缺失的配置和下一步操作。
- Slash 命令应通过 `/help` 和 composer suggestions 可发现。
- 精确的 slash 输入应直接运行；部分 slash 输入可通过建议补全。
- 排队的输入在 agent 未就绪时应保持可见或可恢复。

## 错误提示

错误必须可操作。推荐结构：

```text
问题描述。
原因：已知原因时的具体描述
下一步：一个具体的恢复操作
```

对于简短状态行，用一句话：

```text
无法找到 session "abc"。运行 /resume 查看已保存的 session，然后选择其中之一。
```

规则：

- 永远不要将原始内部状态作为唯一消息暴露。
- 保留有助于恢复的技术细节，但放在产品级语句之后。
- 网络/provider 故障应提及重试、代理/网络以及如何重新发送。
- 认证失败应指明恢复入口：优先 `/doctor` 的 `[Configure]` 或首次设置向导；`/config` 可作为备用入口。
- 本地数据缺失应告诉用户是获取、配置还是添加文件。
- 制品缺失应解释如何创建第一个制品。
- 不要指责用户。优先使用"选择一个 portfolio..."而非"无效参数"。
- 对于 provider 不匹配，优先显式区分"端点/模型不匹配"和"工具重放形状不匹配"。

当前已映射的情况：

- `Connection error.` -> 网络/代理提示，含重新发送引导。
- `Session not found: <id>` -> 运行 `/resume` 并选择一个已保存的 session。
- `Agent harness not initialized` -> 先发送任何 AI 消息，然后重试命令。
- `Nothing to compact` -> 信息性 no-op。
- 无效的 `/skill install` 输入 -> 在调用 `git` 前展示 `owner/repo` 格式。
- Anthropic 兼容端点上的 `404 status code (no body)` -> 检查 base URL、模型名称和 provider 路由；该端点可能不提供该模型。
- `400` 且 `tool_use` id 缺少 `tool_result` 块 -> 检查 Anthropic 重放顺序；不要在块之间插入无关的 assistant 文本。

快速 provider 检查清单：

1. 确认配置来源是 `.ohquant/settings.json`，而非项目根目录的 `.env`。
2. 确认 `WHYJ_QUANT_BASE_URL` 和模型标签指向同一 provider 族。
3. 如果存在 `WHYJ_DEFAULT_*_MODEL` 映射，确认顶层 `model` 是角色别名或精确等于其中一个映射值。
4. 确认 Doctor provider probe 使用解析后的原始模型 ID，与 Agent 请求一致；终端清理后的显示标签不能用于网络请求。
5. 确认 `WHYJ_QUANT_CONTEXT_WINDOW` 是当前模型真实支持的正整数 token 数，而不是期望值或 compact 阈值。
6. 确认 `WHYJ_QUANT_COMPACT_TRIGGER_TOKENS` 是独立的正整数，并且不高于 context window。
7. 确认 URL 尾段与协议匹配：`/anthropic` -> Anthropic Messages，`/v1` -> OpenAI-compatible。
8. 确认工具重放形状与 provider 匹配：OpenAI-compatible 的 `assistant.tool_calls` vs Anthropic 的 `tool_use` 后跟 `user.tool_result`。
9. 如果模型仍然失败，在暴露原始 provider 文本前在错误副本中呈现不匹配信息。

已验证的真实 provider smoke：

- DeepSeek `/anthropic`
- GLM `/anthropic`
- GLM `/v1`
- MiniMax `/anthropic`
- MiniMax `/v1`

执行方式：

- `bun run test:providers`
- 默认 case 读取 `.ohquant/settings.json`
- 可选补充：
  - `WHYJ_SMOKE_GLM_AUTH_TOKEN`
  - `WHYJ_SMOKE_GLM_ANTHROPIC_MODEL`
  - `WHYJ_SMOKE_GLM_OPENAI_MODEL`
  - `WHYJ_SMOKE_MINIMAX_AUTH_TOKEN`
  - `WHYJ_SMOKE_MINIMAX_ANTHROPIC_MODEL`
  - `WHYJ_SMOKE_MINIMAX_OPENAI_MODEL`

## 操作引导

Slash 命令应有从命令到下一步操作的清晰路径。

一级名称与描述以 [Slash Command 参考](./slash-commands.md) 为准。本节只记录诊断与恢复路径，不维护另一份命令目录。

恢复引导：

- `/help`：仅命令目录和快捷键。
- `/config`：按 Agent、Provider、Research、Data keys、Workspace 和 Path 输出当前规范化设置；TUI 中打开只保留设置项、当前值和顶部概览的 Settings 面板。
- `/portfolio`：在 TUI 中打开本地组合面板；在 TUI 外，列出可用组合。
- `/portfolio use <name|file|index>`：切换活跃的本地组合。
- `/resume`：在 TUI 中打开恢复面板；在 TUI 外，列出已保存的 sessions。
- `/resume <sessionId>`：恢复已知 session，对缺失 ID 给予友好处理。
- `/compact [focus]`：仅在有用时压缩 session；no-op 为 info。
- `/doctor`：首次使用时打开配置向导；配置后运行模型、工具链和数据源诊断，报告配置路径、认证来源、脱敏值指纹和可操作恢复提示，而不输出完整密钥。
- `/skill`：列出可用 skill。
- `/skill info <name>`：显示来源、可见性、位置和摘要。
- `/skill:<name>` 或 `/skill run <name>`：通过活跃 agent session 运行 skill。
- `/skill install <owner/repo>`：从 GitHub 安装或更新 skill。

面板空状态引导：

- Resume 面板："暂无已保存的 session。先开始一段对话，然后再回到 /resume。"
- Portfolio 面板："暂无本地组合。" 外加 `.ohquant/portfolio/` 设置引导。
- Benchmark dashboard：告诉用户如何创建第一个 benchmark 结果。
- 数据搜索：建议完整代码或更具体的名称。

补充实现约束：

- `/doctor`、`whyj doctor` 和 `whyj --json doctor` 必须共享同一套 `runDoctor()` 状态机，避免 TUI、文本 CLI 与 JSON CLI 的 ready 判定、来源显示或脱敏格式不一致。
- `doctor` 文本输出应包含阶段名、状态、摘要和下一步 action；如果使用表格输出，必须包含列头，便于在 TUI 对话区和纯文本 shell 输出中快速扫描。

## 安装

主要安装路径：

```bash
npm i -g whyj-quant
whyj
```

开发者安装路径：

```bash
bun install
bun run src/index.ts
```

首次运行引导：

1. 启动 `whyj`。
2. 运行 `/doctor`。
3. 在首次设置向导中配置 `WHYJ_QUANT_API_KEY`、`WHYJ_QUANT_BASE_URL` 和首选数据源 key。
4. 使用 `[Save & Verify]` 保存并运行真实探测。
5. 提出自然语言问题或运行 `/help`。

Skill 安装引导：

```text
/skill install LLMQuant/skills
```

规则：

- 仅接受 `owner/repo` 用于 skill 安装。
- 如果 GitHub clone/pull 失败，提及网络/代理访问和重试命令。
- 不要在安装、doctor 或配置输出中打印密钥。
- `doctor` 应报告凭证是否存在、来自哪里以及脱敏值指纹，而非完整密钥值。

## Review 工作流

当前工作区不暴露可调用的 `gstack ux-review` skill。`CLAUDE.md` 中的项目引导列出了以下 gstack review skill：

- `/review`
- `/design-review`
- `/devex-review`
- `/plan-ceo-review`
- `/plan-design-review`
- `/plan-devex-review`
- `/plan-eng-review`

对于可用性工作，将其视为 UX 加 DevEx review：

- 当用户要求广泛的交互变更且范围尚未清晰时，使用 `/plan-design-review`。
- 当 UI 副本、面板状态、命令流或空状态发生变化时，使用 `/design-review`。
- 当涉及安装、设置、命令行行为、JSON envelope 或文档变更时，使用 `/devex-review`。
- 当行为已实现时，使用 `/review` 进行最终代码审查。

如果请求的 review skill 在环境中缺失，记录该事实并继续使用等效的本地 review 检查清单。

## UX Review 检查清单

在合并面向用户的变更前使用此检查清单：

- 首次使用的用户能否从屏幕或错误消息中找到下一步操作？
- 每个错误是否区分了问题、原因和下一步（当信息充足时）？
- No-op 状态是否显示为信息而非错误？
- 网络、provider 和认证失败是否映射到恢复引导？
- Slash 命令是否在 `/help` 和 composer suggestions 中可发现？
- 安装路径是否覆盖全局安装、本地开发和 skill 安装？
- JSON 输出是否保持机器稳定，同时文本输出保持人类可读？
- 密钥是否从所有状态、错误和 `doctor` 输出中脱敏？
- 空面板是否有用，而无需用户查阅文档？
- 测试是否覆盖高风险路径的用户可见副本？

## 实现说明

将映射逻辑保持在拥有用户界面的边界附近：

- Agent/provider 错误：`src/app-runtime.ts`
- Slash 命令 dispatch：`src/cli/registry.ts`
- Slash 命令 handler：`src/cli/handlers/`
- Skill 安装/列表/运行：`src/skill/`
- 数据/量化工具输出：`src/tools/`
- 面板空状态：`src/tui/src/panel-models.ts` 和 `src/tui/src/panel-views.ts`
- 安装和首次运行文档：`README.md` 和本文档

添加新命令或面板时，至少为一种成功状态、一种缺失输入状态和一种空结果状态添加测试。

## Doctor 渐进检测设计

### 概述

`/doctor` 从静态配置快照改为**异步状态机驱动的三阶段渐进检测**，TUI 和 CLI 共享同一状态机。

Doctor 同时承担两个产品角色：

1. **首次配置入口**：当模型凭证和数据源凭证全部缺失时，`/doctor` 进入首次设置向导，帮助用户完成最小可用配置。
2. **后续诊断工具**：配置存在后，`/doctor` 运行真实 provider、工具链和数据源探测，定位当前环境为什么不能工作。

这两个角色共享同一套检查逻辑，但写入行为必须被限制在显式的配置动作里。普通诊断运行只读配置；wizard 或 `[Configure]` 进入编辑状态后，只有用户执行 `[Save & Verify]` 才写入 `.ohquant/settings.json` 并重新检测。

### 当前落地状态（2026-07-04）

下面这份文档以**当前实现**为主；只有在明确标注时，才表达后续可演进方向。当前代码已经落地的是：

- 共享 doctor 状态模型：`runDoctor()` / `collectDoctor()` / `DoctorResult`
- 三阶段检测：Model / Tools / Data，诊断模式下阶段之间不短路
- 真实 provider/data probe、30s 级别超时、脱敏日志
- CLI 文本模式渐进输出；`overall === "unconfigured"` 时直接输出首次配置 scaffold；`--json` 只输出最终结果
- TUI `/doctor` 入口：命令执行后立即打开 doctor 面板，并随着 `runDoctor()` 逐阶段刷新状态
- 如果 `/doctor` 在面板打开后遇到运行时异常，TUI / slash 命令链路会把 loading 面板替换成结构化 fail-state，而不是停在永久 loading
- TUI first-setup 闭环：`overall === "unconfigured"` 时进入 doctor draft，`[Save & Verify]` 一次性写入并重跑 `/doctor`，ESC 丢弃 draft
- TUI 诊断动作：`[Retry All]`、`[Retry Model]`、`[Retry Tools]`、`[Retry Data]` 和 `[Configure]`
- Tools 阶段已校验 built-in registry、TypeBox schema compile、source adapter export，以及 `akshare` 场景下的 Python / package 可用性
- `warnings` 已在 CLI 文本和 TUI doctor 面板中显示

当前还保留的实现取舍是：

- Doctor 复用了现有 `panel.ts` 面板体系，而不是单独拆一个 `doctor-panel.ts`
- 交互动作是**键盘触发**，不是鼠标点击；文档里旧的“可点击”描述应按当前实现理解为“可触发”

### 状态模型

```typescript
type PhaseStatus = "pending" | "checking" | "pass" | "fail";
type DoctorMode = "diagnostic" | "first_setup";
type DoctorOverall = "running" | "all_pass" | "partial_fail" | "unconfigured";

interface DoctorPhase {
  phase: "model" | "tools" | "data";
  status: PhaseStatus;
  label: string;        // "Model · DeepSeek V4 Pro"
  detail: string;       // "sk-...abcd · Anthropic Messages"
  error?: string;       // "Connection refused: 127.0.0.1:11434"
  action?: string;      // "Set WHYJ_QUANT_API_KEY in settings"
  warnings?: string[];  // non-blocking findings shown when expanded
  durationMs?: number;
}

interface DoctorState {
  mode: DoctorMode;
  phases: [DoctorPhase, DoctorPhase, DoctorPhase];
  overall: DoctorOverall;
  config: {
    settingsPath: string;
    model: string;
    baseUrl: string;
    endpointMode: string;
    dataSource: string;
  };
  auth: Record<string, { available: boolean; source: "env" | "config" | "missing"; value: string }>;
  logPath?: string;
}
```

### 三阶段检测

#### 1. Model — 验证 AI 模型连通性

**检测内容：**
- 读取 `WHYJ_QUANT_API_KEY` 和 `WHYJ_QUANT_BASE_URL`
- **发送真实 API 请求**验证连通性；每个 provider 使用自己的最小探针，例如 list models、最短 completion 或协议握手
- 验证 endpoint 协议匹配（`/anthropic` vs `/v1`）
- 失败时展示脱敏 key 指纹和 endpoint mode

**失败恢复：**
- 缺失 key：展示 `WHYJ_QUANT_API_KEY` 配置路径
- 连接失败：展示网络/代理提示 + 重试引导
- 协议不匹配：展示 URL 尾段与 provider 的对应关系

#### 2. Tools — 验证内置工具链就绪

**检测内容：**
- 内置 tool registry 是否加载（`fetch_bars`、`search_symbols`、`fetch_snapshot`、AKShare fund tools、quant compute tools）
- Tool definitions 是否加载并可编译（TypeBox schemas）
- 数据源 adapter export 是否可解析（akshare、tushare、llmquant-data、financial-datasets）
- **Python 环境检测**（首次运行关键）：
  - `python3 --version` 是否存在
  - 关键 Python 包是否安装（akshare 等）
  - 未安装时提供 `pip install` 命令

**失败恢复：**
- Tool registry/schema 加载失败：展示失败的工具名和测试/重试引导
- 数据源 adapter 不可用：展示 adapter 名称和对应配置项
- Python 缺失：展示安装命令（按平台）
- Python 包缺失：展示 `pip install` 命令列表

#### 3. Data — 验证数据源可用

**检测内容：**
- 读取数据源 key（`WHYJ_QUANT_TUSHARE_TOKEN` / `WHYJ_QUANT_LLMQUANT_API_KEY` / `WHYJ_QUANT_FINANCIAL_DATASETS_KEY`）
- 只针对当前选择的数据源发送最小真实数据请求（如一条 quote、snapshot 或 `equity_historical_prices` limit=1）验证 key 有效
- 报告数据源类型、adapter、认证来源和可用状态

**失败恢复：**
- 缺失 key：展示对应 env var 和注册链接
- Key 无效（401/403）：展示脱敏 key 指纹，引导更新
- 数据为空但认证成功：提示检查 symbol/市场覆盖，而不是把它归类为认证失败

### TUI 呈现：Doctor 面板

当前实现里，Doctor 在 TUI 中渲染为**临时 overlay/modal**，不是内联消息，不是普通 assistant 文本。

当前实现复用了现有 `panel.ts` 面板体系，在 `/doctor` 启动时先打开 loading doctor 面板，再随着状态机逐阶段刷新。也就是说：

- 已有：TUI 内 doctor 实时结果展示
- 已有：doctor 面板内直接配置与重跑
- 结构上仍复用现有 panel 基础设施，不强行拆成独立文件

**布局：**

```
┌ Doctor ──────────────────────────────────────────┐
│                                                   │
│  1. Model    ✓  DeepSeek V4 Pro                   │
│              sk-...abcd · Anthropic Messages       │
│                                                   │
│  2. Tools    ⟳  Checking tool registry...         │
│              schemas loaded · Python checking     │
│                                                   │
│  3. Data     ○  pending                           │
│                                                   │
│  Logs  ·  .ohquant/logs/doctor/latest.log         │
│                                                   │
│  [Retry All]                                       │
└───────────────────────────────────────────────────┘
```

**视觉规则（沿用 DESIGN.md）：**
- 背景：`surface-elevated` (#171717)
- 标题 "Doctor"：`goldB`
- 通过 `✓`：`S.positive`（不引入绿色）
- 失败 `✗`：`S.negative`（不引入红色）
- 检测中 `⟳`：spinner 动画
- 待定 `○`：`S.dim`
- 失败展开：错误文本 `S.cream` + action `S.gold`（键盘触发）

**交互：**
- 阶段按展示顺序更新：Model → Tools → Data；诊断模式下失败不阻塞后续阶段，wizard 模式下配置步骤串行
- 失败时该行展开，显示 error + action
- `[Retry All]` 重新运行全部三个阶段
- `[Retry Model]` / `[Retry Tools]` / `[Retry Data]` 局部重跑单个阶段
- `[Configure]` 在 doctor 面板内直接编辑配置（不跳转 `/config`）
- ESC 或点击外部关闭；如果有未保存 draft，丢弃 draft 并保持现有配置不变

### CLI 呈现：渐进文本输出

```
$ whyj doctor
[....] Model  · Checking DeepSeek API...
[ OK ] Model  · DeepSeek V4 Pro  ·  sk-...abcd
[....] Tools  · Checking tool registry...
[ OK ] Tools  · schemas loaded  ·  Python 3.12  ·  akshare 1.14
[....] Data   · Checking llmquant-data...
[FAIL] Data   · HTTP 401 — Invalid API key
       Fix    · Set WHYJ_QUANT_LLMQUANT_API_KEY in .ohquant/settings.json
       Then   · whyj doctor
```

`--json` 保持机器稳定，只输出最终 `DoctorState`，不输出渐进事件流。普通文本 CLI 可以逐阶段打印进度；如果最终结果是 `first_setup/unconfigured`，则直接输出可复制的 `settings.json` scaffold。JSON 使用者只看到一次完整 envelope，避免 parser 处理 NDJSON 或中间状态。新增字段必须 additive；已有 `ready`、`auth`、`config`、`hints` 语义在迁移期保留或提供兼容映射。

### 首次设置引导（unconfigured）

当模型凭证和已选择数据源所需凭证全部缺失时（`overall === "unconfigured"`），在 `/doctor` 内进入**首次设置向导**，不跳转到 `/config`。

**TUI wizard 流程：**

```
┌ Doctor · First Setup ────────────────────────────┐
│                                                   │
│  Let's configure your quant terminal.             │
│                                                   │
│  1. API Key                                       │
│     [________________________________________]    │
│     Your AI model provider key (sk-...)           │
│                                                   │
│  2. Base URL                                      │
│     [https://api.deepseek.com/anthropic______]    │
│     ▼ DeepSeek  ·  GLM  ·  MiniMax  ·  Custom     │
│                                                   │
│  3. Data Source                                   │
│     ○ llmquant-data  ○ tushare  ○ financial       │
│     [your-data-key___________________________]    │
│                                                   │
│  [Save & Verify]                                  │
└───────────────────────────────────────────────────┘
```

- 三步输入：API Key（兼容 legacy token 已存在场景）→ Base URL（含快捷选项）→ Data Source + Key
- 每步输入先保存在 wizard draft 中，不即时写入 `settings.json`
- `[Save & Verify]` 一次性写入后自动重新运行三阶段检测
- 所有 key 值在 UI 中脱敏显示
- ESC 或关闭 wizard 会丢弃 draft，不产生半写入配置

**CLI 输出：**

```
$ whyj doctor
No credentials configured.

Add this to .ohquant/settings.json:

{
  "env": {
    "WHYJ_QUANT_API_KEY": "sk-your-key-here",
    "WHYJ_QUANT_BASE_URL": "https://api.deepseek.com/anthropic",
    "WHYJ_QUANT_LLMQUANT_API_KEY": "your-llmquant-key"
  }
}

Then: whyj doctor
```

### 实现结构

```
src/
├── cli/
│   ├── doctor.ts              # 状态机核心 (DoctorState, runDoctor phases)
│   ├── doctor.test.ts
│   └── handlers/system.ts     # doctorHandler (TUI + CLI 共用)
├── runtime/
│   └── commands.ts            # openDoctor effect 分发
├── tui/src/
│   ├── panel.ts               # 现有 panel 容器，doctor 面板入口
│   ├── panel-views.ts         # DoctorPanelView 渲染
│   └── tui.ts                 # openDoctor() 打开面板
├── types/
│   └── commands.ts            # openDoctor effect 类型
└── index.ts                   # whyj doctor CLI 路径
```

**当前代码约束：**

- `runDoctor()` 返回 `AsyncIterable<DoctorState>`，每阶段完成 emit 一次
- CLI 文本模式订阅 iterable，逐行输出；CLI JSON 模式消费完整 iterable 后只输出最终 state
- TUI 订阅状态流，先打开 loading doctor 面板，再逐阶段刷新
- 如果 `collectDoctor()` 或其外围配置/日志链路抛错，调用方会构造一个 doctor error result 回填到面板/文本输出
- 状态机逻辑在 `doctor.ts`，面板/CLI 只做渲染
- doctor 面板内 action 只驱动显式重试或显式保存，不隐式改写配置
- 保持现有 `--json` 输出格式稳定性（新增 `phases` 字段）

### 实现切片顺序

1. **共享状态机与兼容 JSON**：已完成。`DoctorState`、`runDoctor()` async iterable、`collectDoctor()` 最终快照已落地，并保留了旧 `ready/auth/config/hints` 字段的兼容语义。
2. **真实 provider probe 与日志**：已完成。Model/Data 阶段已升级为最小真实请求，包含超时、错误分类和脱敏日志。
3. **TUI doctor 面板入口**：已完成。`/doctor` 在 TUI 中会立即打开 doctor 面板，并随着状态机逐阶段刷新。
4. **首次设置 wizard**：已完成。已支持 provider 预设、draft 编辑、`[Save & Verify]` 一次性写入、ESC 丢弃 draft、诊断态 `[Configure]` 入口。
5. **细粒度 retry**：已完成。doctor 面板支持 `Retry All`、`Retry Model`、`Retry Tools`、`Retry Data`。

### 交互状态完整矩阵

每个阶段的状态和用户所见：

| 阶段状态 | 图标 | TUI 用户所见 | 可操作 |
|---------|------|-------------|--------|
| `pending` | `○` | 灰字阶段名，无 detail | 无 |
| `checking` | `⟳` | spinner + 当前检查项名称 + 实时 detail 更新 | 无 |
| `checking` (timeout) | `⟳` → `✗` | 30s 超时后自动转为 fail，detail 显示 "Timed out after 30s" | Retry |
| `pass` | `✓` | 阶段名 + detail 摘要，行收起 | 查看摘要 |
| `pass` (warning) | `✓` | 同 pass，并额外显示 `Warn · ...` 行 | 查看摘要 |
| `fail` | `✗` | 行自动展开，error + action | Retry / Fix |
| `fail` (dependency unavailable) | `✗` | 当前阶段自己的依赖缺失，例如未安装 Python 或缺少数据源 key；不因其他阶段失败而跳过 | Fix / Retry |

**整体状态转换：**

```
unconfigured ──→ wizard ──→ running ──→ all_pass
                                  │
                                  ├──→ partial_fail
                                  │       │
                                  │       └──→ retry ──→ running
                                  │
                                  └──→ timeout ──→ partial_fail
```

### 失败展开状态 ASCII 布局

```
┌ Doctor ──────────────────────────────────────────┐
│                                                   │
│  1. Model    ✓  DeepSeek V4 Pro                   │
│              sk-...abcd · Anthropic Messages       │
│                                                   │
│  2. Tools    ✗  Python package missing             │
│              registry: loaded                      │
│              schemas: loaded                       │
│              akshare: import failed                │
│              ──                                   │
│              Fix · Install akshare in Python env   │
│              [Retry Tools]                         │
│                                                   │
│  3. Data     ✗  missing WHYJ_QUANT_LLMQUANT_API_KEY│
│                                                   │
│  [Retry All]                                       │
└───────────────────────────────────────────────────┘
```

### TUI 视觉约束（补充 DESIGN.md）

| 元素 | 字体 | 颜色 | 说明 |
|------|------|------|------|
| Panel 标题 "Doctor" | `body-strong` (16px, 600) | `goldB` | 左对齐 |
| 阶段编号 "1. 2. 3." | `caption-strong` (13px, 600) | `gold` | |
| 阶段标签 "Model" | `body-strong` (16px, 600) | `cream` | |
| 阶段 detail | `caption` (13px, 400) | `dim` | 缩进 2ch |
| 错误文本 | `caption` (13px, 400) | `cream` | |
| Action 文本 | `button` (14px, 500) | `gold` | 键盘触发 |
| 面板背景 | - | `surface-elevated` (#171717) | |
| 面板内边距 | `spacing.md` (16px) | - | 四边统一 |
| 阶段行间距 | `spacing.sm` (12px) | - | 阶段之间 |
| Wizard 输入框 | `body` (16px, 400) | `ink` on `surface-terminal` | 44px 高（最小触摸目标）|
| 面板宽度 | - | - | 最大 64 字符，居中 |
| Overlay 背景遮罩 | - | `canvas` at 60% opacity | 覆盖主界面 |

### 非阻塞失败策略

阶段之间**不阻塞**：即使 Model 失败，Tools 和 Data 仍然继续检测。用户可能想先修 Data key，同时看到 Model 的问题。只有 wizard 模式下三步串行（因为每步依赖前一步的输入）。

真实 provider 探测是 doctor 的核心能力，不是可选装饰。默认诊断运行会发送最小真实请求来验证凭证、端点、协议和数据源可用性。实现必须遵守以下约束：

- 每个 provider probe 必须有明确超时，默认单阶段不超过 30s。
- Probe 请求必须尽量轻量，避免大批量数据、benchmark 或长上下文 completion。
- 测试必须 mock provider probe，不依赖真实网络或真实密钥。
- `WHYJ_DOCTOR_SKIP_NETWORK=1` 只用于测试、CI 或用户显式要求的离线排障；默认 `doctor` 不能用它替代真实 provider/data probe。
- 错误摘要进入 UI；原始响应和 stack trace 只进入已脱敏诊断日志。

### 不在范围内

以下明确排除在当前 doctor 设计之外：

- **定时健康检查** — doctor 是手动触发的诊断工具，不是后台 daemon
- **历史 doctor 报告** — 不持久化可浏览的历史报告，每次运行是独立检测；诊断日志只用于排障
- **自动修复** — 诊断模式只报告问题并提供 action，不自动修改配置；只有用户显式执行 `[Save & Verify]` 才写入配置
- **Multi-provider 并发检测** — 一次只检测当前配置的 provider，不并发测多个
- **性能 benchmark** — doctor 检测连通性和配置，不测量延迟/吞吐

### 测试策略

`src/cli/doctor.test.ts` 至少覆盖：

| 场景 | 断言 |
|------|------|
| 全凭证就绪 + API 通 | `overall === "all_pass"`，三阶段 `pass` |
| 零凭证 (unconfigured) | `overall === "unconfigured"`，wizard 触发 |
| Model key 缺失 | Model `fail`，error 包含 "WHYJ_QUANT_API_KEY" |
| Model API 超时 | 30s 内 Model 转为 `fail`，error 包含 "timed out" |
| Tool registry/schema 加载失败 | Tools `fail`，detail 列出失败的工具名或 schema 错误 |
| Data key 401 | Data `fail`，error 包含 "401" 和脱敏 key 指纹 |
| Python 缺失 | Tools `fail`，error 包含平台相关安装命令 |
| 凭证从 env 读取 (非 config) | auth source 标注为 "env" |
| `--json` 输出格式 | JSON 包含 `phases` 数组，每项有 `status` `label` `detail`，并保持旧字段或兼容映射 |
| retry 后全通过 | 初始 `partial_fail` → retry → `all_pass` |
| wizard draft 关闭 | 未执行 `[Save & Verify]` 时不写入 `settings.json` |
| 诊断日志脱敏 | 日志不包含完整 API key、Authorization header 或未脱敏请求体 |

当前已经补上的测试集中在：

- `src/cli/doctor.test.ts`：零凭证、env 优先级、legacy token fallback、resolved model id、partial rerun seed 失效回退、provider 分类、warning 渲染、日志脱敏
- `src/index.test.ts`：`whyj doctor` 文本进度输出、unconfigured scaffold 与 `--json` 稳定输出
- `src/cli/registry.test.ts` / `src/cli/handlers/system.test.ts` / `src/runtime/commands.test.ts`：`/doctor` 命令、TUI 实时回调链路与 runtime side effects
- `src/tui/test/panel.test.ts`：doctor 面板渲染、wizard draft 不落盘、`[Save & Verify]` 后重跑 `/doctor`、`Retry Tools/Data`、`[Configure]`、`esc` 关闭

### 诊断日志路径

详细错误信息去哪里看：`.ohquant/logs/doctor/` 目录下按时间戳命名的日志文件。TUI 失败展开只显示摘要，完整 stack trace 和已脱敏的原始响应体写入日志文件；不得写入完整 API key、Authorization header 或未脱敏请求体。面板底部添加一行：

```
  Logs  ·  .ohquant/logs/doctor/2026-07-01T15-04-05.log
```
