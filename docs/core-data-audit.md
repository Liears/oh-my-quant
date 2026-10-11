# 核心数据与组合验收

日期：2026-09-13。范围：自动行情获取/更新、自定义组合、TUI/CLI 使用路径、pi 内核升级及模块边界。

## 发现与修复

| 原问题 | 当前行为 | 主要位置 |
|---|---|---|
| 同日行情修订无法更新；缓存新鲜度忽略查询区间 | 同日期新值覆盖；5 分钟 freshness 加窗口覆盖；坏记录、空响应不续期 | `storage/src/bars.ts`、`market/bars.ts` |
| 数据工具拒绝 US/HK；首选 source 与跨市场 fallback 不一致 | 使用市场兼容 provider 链，显式兼容 provider 优先，保留实际来源 | `source/src/source-providers.ts`、`tools/data-tools.ts` |
| 因子、回测和风险依赖手工预取，start/end 未落实 | 统一自动取数，按窗口计算并校验参数/样本量，标明陈旧缓存 | `runtime/analysis-data.ts`、`tools/quant-tools.ts` |
| Benchmark 日期未真正对齐、默认参数必填、同日结果覆盖、排序选项无效 | 共同交易日期对齐，可省略默认参数，唯一制品文件名，按指定指标排序 | `tools/benchmark-tools.ts` |
| Overview 没有周期刷新，超时请求继续运行，帮助也触发取数 | 启动自动取数，每轮结束后 60 秒刷新，合并重复请求，120 秒超时与退出取消，本地只读命令不取数 | `app-runtime.ts` |
| HTTP 收到 headers 就停止超时；Windows Python fallback 受旧进程 close 干扰 | 超时覆盖响应体；取消传到 HTTP/Python；忽略启动失败进程的 close；包根解析兼容 dist | `source/src/http.ts`、`akshare-python.ts` |
| 同数字的 .SH/.SZ/.OF 被别名合并，指数/基金路由串线 | 完整代码身份；Tushare 股票/指数/ETF/开放式基金分别路由；保留 BRK.B | `market/symbols.ts`、`runtime/overview.ts`、`source/src/tushare.ts` |
| 组合只有旧文件选择；空组和 US/HK 被过滤；刷新读取 legacy holdings | 组合增删改；保留空组和共享成员；仅显式 import 读取旧文件 | `runtime/portfolio.ts`、`tui/src/portfolio-panel.ts`、`cli/handlers/portfolio.ts` |
| 配置变化未刷新行情；Settings 打开的组合面板又被关闭 | 保存后标记刷新；先关闭旧面板，再分发新面板动作 | `tui/src/panel.ts`、`tui/src/tui.ts` |
| pi 依赖版本与实际运行的本地循环/协议副本分离 | 两包精确锁定 0.85.1，删除路径覆盖，直接使用上游循环和协议 | `agent/src/kernel/` |
| 最近分析标的由多个 Agent 共用；恢复失败清掉原状态并污染 ready | 实例内上下文；串行切换，成功后替换，失败保留可用的原会话 | `agent/src/session.ts`、`session-state.ts` |
| agent_end 监听器未结束就被视为 idle；压缩/导航取消信号不贯通 | 单一操作生命周期，等待监听器/持久化，提交摘要前检查取消 | `session-runtime/harness/operation.ts`、`session/` |
| 清空队列遗漏 nextTurn；新一轮仍残留旧错误 | 清理三个队列；agent_start 清除旧错误提示 | `session-runtime/harness/agent-harness.ts`、`session-state.ts` |

## 核心减法与边界

- 删除独立缓存搜索 helper，价格分析统一从 `loadAnalysisBars → runtime.fetchBars` 获取输入。
- 删除 Overview 绕过配置的 spot 分支与截断代码的别名匹配；provider 回退只在 source 编排。
- 删除旧 portfolio picker 的 model/view/交互分支，以及未注册的 market handler。
- CLI/TUI 共用一个组合编辑服务；TUI 不直接读写 storage 或选择 provider。
- market 处理无 IO 的代码/日期/Bar 规范化；source 不导入 storage；runtime 绑定配置与缓存；storage 拥有路径和持久化规则。
- 组合只持久化代码、名称、instrument 和分组。个人持仓金额、仓位和净值快照不进入行情缓存；正常启动/刷新不读取 `.ohquant/portfolio/`。
- Agent 的上游 loop/provider 入口、模型配置、会话契约、状态映射、结果提示、操作生命周期、压缩、导航分别维护。删除重复的事件广播和工具结果分类分支。
- 相对本轮起始 HEAD，`src/agent/src/` 生产 TypeScript（不含 `*.test.ts`）从 12,663 行减至 7,882 行，净减少 4,781 行；`session.ts` 为 408 行。移动的会话文件已计入新目录，未把重命名计成删除。
- Doctor 类型归入 `types/doctor.ts`，端点显示逻辑留在 runtime；架构检查同时约束纯计算模块、pi 版本一致性、别名覆盖及上游实现导入位置。

## 验证记录

- `bun run typecheck`：通过。
- `bun run check:architecture`：通过，0 baseline violations。
- `bun run build`：通过，构建 `dist/index.js`。
- `bun run test`：640 pass，0 fail，77 个文件，包含 test fence。
- 回归覆盖：同日修订、缓存窗口/TTL/损坏输入、跨市场 fallback、取消后不降级/落盘、响应体超时、自动重试/退出/刷新合并、组合 CRUD/持久化/键盘操作、默认评分参数和制品不覆盖。
- 构建后的 CLI 在独立系统临时目录通过 11 个连续命令：新建 Core → 加入 `000001.SZ` / `000001.SH` / `022364.OF` / `AAPL` / `00700.HK` → 重命名 → 新进程读取 → 移除 → 删除 → 新进程确认空列表。五个标的保留独立身份。
- 本机真实 AKShare 探测：`000300.SH` 1625 条、`000001.SZ` 1624 条、`022364.OF` 455 条，数据截至 2026-09-11。该探测走 live 路径，不改写用户行情缓存。
- pi 回归使用真实上游循环验证 displayUser 转换、工具执行/拦截/参数错误与结果顺序；真实请求构造器验证模型 ID、协议端点和 headers。生命周期测试覆盖压缩/分支取消、准备阶段取消、监听器失败、队列清空、多实例隔离、恢复失败和连续重置。

## 验证边界

Overview 展示最新可取得的日线/基金净值，不承诺逐笔报价；本地刷新时间和上游数据日期分别显示。无行情显示 `--`，多个标的日期不一致时展示日期范围。

US/HK 路由、凭证传递、回退与工具结果通过确定性测试；本次未证明真实账户权限或所有上游接口持续可用。大规模组合吞吐、多进程同时写入同一缓存目录，以及所有外部数据异常不在本次已验证范围内。测试通过不能证明不存在任何未知缺陷。

pi 运行循环和模型传输已更新；现有 JSONL v3 由 WhyJ session-runtime 承接，未迁移到上游新版 durable Harness/lane 格式。模型回归在发出网络请求前拦截，不证明真实模型账户鉴权成功。完整边界见 [pi 内核与会话适配](./pi-agent-loop-harness.md)。上游新模型目录随构建打包，当前产物为 4.28 MB；源码精简不等于 bundle 体积降低。

接口依据：[Tushare fund_nav](https://tushare.pro/document/2?doc_id=119)、[Tushare index_daily](https://tushare.pro/document/2?doc_id=95)、[Financial Datasets 股票价格指南](https://docs.financialdatasets.ai/guides/get-stock-prices-python)。
