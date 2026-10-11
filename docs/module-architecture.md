# WhyJ Quant 模块架构

本文档是面向维护者的代码库地图。解释每个模块的职责、数据允许流动的方向，以及其他模块应使用的入口点。

## 顶层布局

| 路径 | 角色 | 备注 |
|------|------|------|
| `src/cli/` | slash 命令解析、本地命令处理、JSON one-shot 模式 | 仅限本地 UI/session 控制 |
| `src/tui/` | 终端渲染、面板、输入、布局、显示组件 | 消费运行时事件；不应持有业务状态 |
| `src/app-runtime.ts` | TUI/CLI 到 agent session 和本地面板的桥接 | 编排 UI 状态刷新 |
| `src/app-watchlist.ts` | watchlist 应用服务 | 让 TUI 不直接访问 storage |
| `src/insight/` | storage-backed insight/quote 服务 | 从 `quant/insight.ts` 迁出文件持久化 |
| `src/agent/` | 上游 pi kernel 接入、WhyJ 会话适配、session facade | 持有 prompt loop、compaction、resume |
| `src/research/` | 分支研究状态与共享证据核验 | 参数/引用/重算独立于 Agent 与报告渲染，不调用实时数据源 |
| `src/account-performance/` | 私有账户区间业绩的只读历史端口与计算 | 显式适配器、资金流前估值及已扣费用；只在内存处理，未接默认 UI/Agent/年报，见 [账户业绩](./account-performance.md) |
| `src/execution/` / `src/app/paper-execution/` | 独立订单端口 / 宿主显式选择的本地模拟盘 | 通用端口不持久化或读取凭证；paper 宿主在指定绝对目录保存私有账户/订单，合成成交由宿主注入，不进默认 Agent，见 [执行契约](./execution.md) |
| `src/tools/` | 内置 agent 工具 | 数据工具、量化工具、shell 工具、注册表 |
| `src/source/` | 行情数据 provider adapter 和回退编排 | 公共入口点为 `src/source/index.ts` |
| `src/market/` | 无 IO 的代码、日期和 Bar 规范化 | source/storage 共用，保留交易所与基金后缀身份 |
| `src/runtime/portfolio.ts` | 自定义组合编辑服务 | TUI 与 CLI 共用校验和增删改逻辑 |
| `src/runtime/quant-harness.ts` | 结构化研究任务宿主与工具执行守卫 | 组合现有 Session/Pi；任务事件仍存原 session，状态由 research/tasks 投影 |
| `src/tools/research-task-tool.ts` | 会话绑定的研究控制工具 | registry.bindResearchTools 组装，注入分支读口；成功结果提交事件，不在工具内等待自身 idle |
| `src/runtime/research-task-view.ts` / `src/tui/src/research-task-panel.ts` | 任务投影文本与只读终端面板 | `/resume --task` 经 AppRuntime 回调传入快照；渲染与按键不执行模型、行情或状态写入 |
| `src/runtime/analysis-data.ts` | 量化工具数据入口 | 按分析窗口自动取数 |
| `src/runtime/data-readiness.ts` | 数据连接诊断 | 明确市场/样本/窗口，仅探测所选源，无缓存或隐式保存；CLI/数据配置面板共用 |
| `src/runtime/data-settings.ts` | 数据配置草稿与验证生命周期 | 编辑使证据失效，取消隔离迟到结果；验证成功才生成可保存草稿，不直接持久化 |
| `src/runtime/tool-readiness.ts` | 工具能力投影 | 从实际 registry 检查市场、凭证、Python 依赖与日线样本范围，不执行工具 |
| `src/runtime/tool-probe.ts` / `tool-probe-draft.ts` | 端点响应检查与编辑生命周期 | CLI/TUI 共用；只调用所选 source adapter，复用基金参数 schema；固定配置快照、超时/取消、不持久化 |
| `src/tui/src/data-settings-panel.ts` | 数据编辑器 | 键盘/焦点/脱敏展示；PanelController 经 PanelDataService 保存，完成事件驱动 TUI 重绘 |
| `src/runtime/overview-refresh.ts` | Overview 周期/手动刷新生命周期 | 取消、超时、代次、状态和观测；AppRuntime 转发入口 |
| `src/runtime/overview-data.ts` | 本轮公开报价请求池与来源映射 | 最多 8 个活跃请求，跨指数/组合去重，可注入 source fetcher；无行情缓存 |
| `src/runtime/source-runtime.ts` | storage-backed source runtime adapter | 将 source 的可注入 cache/settings deps 绑定到 storage |
| `src/storage/` | `.ohquant` 持久化、缓存、session 摘要、显式 legacy portfolio 迁移 | 本地持久化状态规则的唯一位置；只暴露 resolver/API，不暴露 import-time path constants |
| `src/types/` | 共享领域契约 | 保持与 provider 无关 |
| `docs/` | 设计、架构、运维文档 | 将实现说明放在此处，而非埋在代码注释中 |

## 边界规则

1. `tui` 渲染状态；不决定 session 真值。
2. `cli` 处理确定性 slash 命令；自然语言转给 agent。
3. `agent` 持有 harness 生命周期、`compact`、`resume` 和 session 重建。
4. `tools` 是唯一可供 agent 调用的执行层。
5. `source` 获取并标准化 provider 数据；不决定 portfolio 语义。
6. `storage` 持有文件系统布局和去重/缓存规则；调用方不应手工拼接 `.ohquant` 路径。
7. `runtime` 负责把 source 的依赖注入接口绑定到 storage/settings；`source` 本身不导入 storage。
8. `execution` 只定义私有执行契约和调用边界；显式应用宿主可以持有独立执行服务账本，不能将其并入 `.ohquant` 公开行情/观察组合存储或默认研究上下文。

## 模块契约

### `src/source/`

- 职责：
  - 各 provider 特定的行情数据获取
  - 数据源回退顺序
  - 通过 `SourceRuntimeDeps` 接收可选缓存/settings hooks
  - Overview/TUI 的数据源归属文本
- 公共导入：
  - `src/source/index.ts`
- 内部分割：
  - `src/source/src/` 实现
  - `src/source/tests/` 模块测试

### `src/storage/`

- 职责：
  - 设置、bars 缓存、benchmark/comparison 制品、sessions、显式 legacy portfolio 迁移
  - 本地 portfolio 去重和精简摘要生成
  - `.ohquant` 策略执行
  - runtime path resolver：`resolveOhquantDir()`、`resolveDataDir()`、`resolveBenchmarkResultsDir()` 等
- 公共导入：
  - `src/storage/index.ts` 或依赖范围有意缩小时使用特定的 storage 模块

### `src/tools/`

- 职责：
  - 向 agent 暴露稳定的工具契约
  - 将工具 IO 转换为 domain/storage/source 调用
  - 干净地呈现面向用户的错误
- 规则：
  - 新的内置工具应通过 `docs/builtin-tool-registry.md` 记录的注册表路径注册

### `src/agent/`

- 职责：
  - harness phase、运行循环、session tree、compaction、resume
  - system prompt/context 组装
- 规则：
  - UI 应调用 facade，不直接修改 agent 状态
  - `kernel/loop.ts` 唯一导入上游执行循环；`kernel/llm.ts` 唯一导入上游协议与模型目录
  - `model-config.ts` 解析配置；`session-state.ts` 映射事件；每个 Agent 自有 SessionCtx
  - `session-contracts.ts` 定义完整模型/工具/skills/repo/prompt/证据端口；`session-dependencies.ts` 组装默认本地 IO，`session.ts` 消费端口与分支快照。独立替换与失败契约见 [Session 依赖注入](./session-dependencies.md)
  - 架构 gate 禁止 `session.ts` 直接导入 storage、tools、source、tui；不以默认组装替代可注入宿主
  - `session-runtime/harness/operation.ts` 统一取消与完成等待；`session/compact-session.ts`、`navigate-session.ts` 管理独占会话操作
  - pi 两包精确锁定同一版本；架构检查禁止 TypeScript 路径别名覆盖和绕过 kernel 的协议实现导入

## 推荐的依赖方向

`agent` 和 `artifact` 共用 `research/input.ts` 的归档核验及七类计算重算；`research/state.ts` 消费结构化分支快照并生成内部状态，见 [研究状态](./research-state.md)。Research 只可向 quant、market、storage、types 依赖；低层和 TUI 不反向依赖 research。数据归档修订/缺失的判定在报告与恢复上下文中一致，新增核验逻辑无需依赖 HTML 或 TUI。

```text
cli/tui
  -> app-runtime
    -> agent
    -> storage
    -> tools

tools
  -> runtime/source-runtime
  -> storage
  -> market/types

source
  -> market/types

app services (`app-runtime`, `app-watchlist`, `insight`)
  -> storage
  -> source/tools/agent as needed

runtime/source-runtime
  -> source
  -> storage

storage
  -> market/types
```

避免反向依赖：`source` 和 `storage` 不应互相依赖，`tui` 不应直接依赖 provider adapter，也不应手工拼 `.ohquant` 路径。`scripts/architecture-boundary-baseline.json` 当前为空，新增违规由 `bun run check:architecture` 阻止。

## 测试布局

将测试放在所验证模块的附近，但按模块分组：

- `src/source/tests/`
- `src/storage/*.test.ts`
- `src/tui/test/`
- `src/agent/test/`

对于 provider bug，在修复之前或同时，在模块测试文件夹中添加回归测试。

## 当前文档

- [Quant UI/UX](./quant-uiux.md)
- [Quant Harness](./quant-harness.md)
- [pi Agent Loop 与 Harness](./pi-agent-loop-harness.md)
- [Pi 量化生态、CLI 对比与插件开发](./pi-quant-ecosystem.md)
- [OhQuant 存储策略](./ohquant-storage-policy.md)
- [内置工具注册表](./builtin-tool-registry.md)
- [数据源 Provider](./source-data-providers.md)
- [Skill 系统](./trader-skills.md)
