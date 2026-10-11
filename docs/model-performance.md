# 模型性能测试与 HUD

更新：2026-09-14。F03 的测量工具独立于行情刷新和量化计算，使用当前保存的 Pi 模型连接。`WHYJ_PERF` 分段日志仍可用于调试；它和这里的重复采样基准分别使用。

## 运行

先在 `/config → Model` 保存连接，可用 Save & Verify 检查。然后在项目目录执行：

```powershell
bun run bench:model -- --help
bun run bench:model -- --samples 5
bun run bench:model -- --samples 10 --warmups 1 --thinking off --tools quant-schema --output output/model-benchmark.json
```

测试发送真实模型请求，会产生供应商用量。固定问题是解释 +10% 后 -10% 的复利收益，每次请求只有同一份 system/user 输入，不承接当前会话。默认 5 次、无 warmup、30 秒单次截止、最多 1024 输出 tokens、串行、请求关闭重试/缓存并使用 SSE；最后三项取决于 provider 是否支持。`--max-tokens` 不超过当前模型限制。

默认使用保存的 thinking；`--thinking` 可独立覆写，报告同时记录 requestedThinking 和 Pi 约束后的 thinking。`off` 不一定是该模型支持的级别，必须检查实际值。`--tools off` 不提供工具；`quant-schema` 提供注册表中的量化工具名称/描述/schema，记录名称与 schema hash，但不执行调用、不继续 Agent 工具循环。该模式测的是带工具声明的模型请求，不是完整量化任务耗时。

JSON 输出到 stdout；指定 `--output` 时保存相同 JSON，并拒绝覆盖已有文件。配置通过只读 snapshot 加载，不执行迁移、不创建 session/缓存、不保存模型回答或远端错误正文。报告保留模型/参数/时间/版本，端点仅记录 hash；不要将它解释为模型答案正确率评测。

Ctrl+C 取消在途请求，保留已结束和被取消样本，未发出部分计入 skipped。退出码 0 表示测量与 warmup 请求均成功，1 表示输入/请求/保存失败，130 表示取消。没有认证时仍形成失败计数；配置本身无效或参数错误时不发出请求。

## 统计口径

| 字段 | 定义 |
|---|---|
| TTFT | 从 Pi stream 调用到首个非空 text/thinking delta 或具名 tool call；空 block start 不算。只有最终消息、没有可观测流式首输出时为 null。 |
| TPOT | `(终止事件时刻 − 首输出时刻) / (provider 输出 token 数 − 1)`；输出 token 至少 2 且耗时有效。包括流尾/usage 交付开销，不是供应商纯解码时间。 |
| durationMs | 单次请求含凭证解析、传输和应用消费的总耗时；使用单调 `performance.now()`。 |
| p50 / p95 | nearest-rank：排序后取 `ceil(p × n)`；仅成功的非 warmup 样本，各指标独立排除 null/无效值，保留各自 samples 数。 |
| 成功/失败 | 成功表示终止且收到非空输出；不证明回答正确。失败、空响应、缺凭证、超时、取消保留在 results；warmup 单独计数，不进入分位数。 |
| httpStatus | Pi 暴露的响应状态；部分 SDK 对拒绝响应不调用 onResponse，无法观测时为 null，不能据此猜测 200。 |

单 token、无 usage、空样本集的 TPOT/p50/p95 均为 null，不填 0。重复输入可能命中供应商内部缓存，即使请求关闭缓存，也不能宣称物理冷缓存；报告保留每次 cacheReadTokens。5 个样本的 p95 等于最大值，适合初始观察，不能据此承诺服务 SLA 或优化收益。

## HUD 与设置

HUD 是当前活动会话中成功模型响应的平均值，和独立基准的分位数不同。首输出判定与 TPOT 公式共用 [hud.ts](../src/runtime/hud.ts)；工具后的下一次模型请求独立计时，不把工具等待算入模型首输出。失败响应不进入成功均值；未测显示 `-`。

清空、成功恢复会话/报告、压缩后的上下文同步，以及模型连接切换会清除旧延迟。恢复失败保留原值；无关外观开关保留当前指标。上下文实时读取当前 Agent snapshot，不从离线 Resume 列表的估算窗口复制。

`/config → Status HUD` 可选 full/context/off，`Compact At` 编辑自动压缩阈值。两项沿用设置的原子保存与版本冲突处理；冲突/取消保留原设置，不触发行情刷新。完整字段见 [配置参考](./configuration.md)。

## 验证

```powershell
bun test src/runtime/model-benchmark.test.ts src/runtime/hud.test.ts src/app-hud.test.ts src/tui/test/hud-settings.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

本地 SSE 测试使用真实 Pi 请求构造与解析，覆盖固定输入、thinking/tool 输出、usage 缺失、单 token、空响应、403、超时、取消、warmup 分离和独立脚本退出码。脚本子进程验证旧配置字节不变、输出不覆盖、无会话/行情文件和凭证泄漏。HUD 生命周期测试覆盖失败/恢复/模型变化；Settings 的 60×20、80×24、120×32 测试覆盖选中项、按键生效、持久化与冲突。

带日期的真实连接结果和完整工程检查记录在 [R04 实施记录](./feature-delivery.md)。模型性能基准不代表金融工具或整条研究任务验收；数据刷新测量见 [数据验收](./data-validation.md)。
