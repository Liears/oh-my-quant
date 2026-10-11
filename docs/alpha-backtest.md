# Alpha / AKQuant 回测边界

F25 采用独立 `src/alpha` 模块：接收固定 Bars 与可选 DatasetRef，生成策略信号，调用外部 Python 引擎，再核对成交与净值。模块本身不读账户或 `.ohquant`；默认工具通过 runtime 获取行情、强制绑定 DatasetRef 并保存研究档案。依赖安装由用户显式执行。

## 引擎与运行方式

AKQuant 是 Python API 加 Rust 扩展，通过 `run_backtest` 接收 DataFrame 和策略回调，返回结果对象。依据：[官方仓库](https://github.com/akfamily/akquant)、[安装元数据](https://pypi.org/project/akquant/0.3.58/)、[API 文档](https://akquant.akfamily.xyz/reference/api/)。本次适配锁定 0.3.58；直接检查该 wheel 的函数签名和实现，使用 `NextOpen()`，不沿用已经移除的 `execution_mode` 参数。

调用方显式提供 Python 可执行文件。请求从 stdin 传 JSON，stdout 只传协议结果；引擎日志走 stderr。进程退出、缺依赖、版本不符、超时、主动取消、输出过大或非 JSON 均失败，不回退成已有 TypeScript 引擎的结果。

## 输入和模拟假设

- 单一标的、升序且唯一的有效日线；不自动删除、补齐或重排输入。OHLC 必须自洽，volume 非负；供应商未给成交额时 `amount` 可为 `null`，已给定时必须为非负有限数。
- 策略为 SMA 或显式 0/1 信号，加固定整数股数。SMA 只使用当日及此前 close；显式信号的历史可得性由调用方负责。
- 信号在当日收盘后产生，次根 Bar 开盘撮合。每日取消未成交余单后重新计算目标；最后一根只取消余单，不发新单，不强制清仓。
- 使用通用股票模拟、UTC 日期标签、整股、T+0、无借款/卖空，成交参与率 100%。这些是假设，不是 A/HK/US 交易规则证明；不包含节假日、涨跌停、复权、分红或历史可交易性校验。
- 佣金为成交金额乘费率，双边收取；百分比滑点买入加价、卖出减价，无最低佣金、印花税或过户费。成本字段必须显式提供，不按市场猜费率。
- DatasetRef 若提供，必须匹配标的、日期和 Bars 的 SHA-256；引用仅表明输入关联，不证明归档文件目前存在。结果同时保存输入摘要、引擎版本/规则版本、参数与来源引用。

## 输出核验

保留订单状态、逐笔成交、逐日净值；依据成交从初始模拟现金独立重建现金和股数，再逐日核对引擎权益。拒绝错标的、重复成交、越界日期、超量/卖空、费用/成交价不符、缺失净值及不一致订单。浮点核对容差为 `max(1, abs(expected)) × 1e-8`。没有成交是合法结果；没有净值不是成功。

风险口径复用本地共享计算：总收益与最大回撤来自逐期复利；CAGR 使用首尾日历跨度，波动率/Sharpe 使用显式年化交易期数，Sharpe 无风险收益设为 0。回撤持续期的既有 `maxDdDays` 字段实际计观察期。指标非有限数或累计收益与首尾权益比不一致时明确失败。订单拒绝保留在结果中，不称为成功成交。

## 验收记录

首次直接 Python 实验使用四条合成行情，初始现金 1000，数量 10，佣金 0.001、滑点 0.01：次日买入价 12.12，第四日卖出价 13.86，费用分别为 0.1212、0.1386，最终权益 1017.1402。该实验验证真实 wheel 的撮合与成本形态；模块接口与失败测试另行记录，不将该单例当作全功能验收。

## 模块调用与复跑

入口为 [createAkquantEngine](../src/alpha/index.ts)，共享 DTO 位于 [types/alpha.ts](../src/types/alpha.ts)。请求校验、Python 协议、子进程生命周期和回执核验分别维护；架构 gate 禁止 alpha 导入 source/storage/CLI/TUI/执行模块。示例请求见 [合成行情 fixture](../src/alpha/test/fixtures/sample.ts)。

```typescript
import { createAkquantEngine } from "./src/alpha/index.ts";
import { sampleRequest } from "./src/alpha/test/fixtures/sample.ts";

const engine = createAkquantEngine({
  python: { command: "C:/path/to/venv/Scripts/python.exe" },
  timeoutMs: 60_000,
});
const result = await engine.run(sampleRequest(), AbortSignal.timeout(60_000));
console.log(result.metrics, result.engine, result.inputHash);
```

默认测试不要求 Python，也不下载包。它使用手工账本响应及真正的 Bun 子进程验证协议和终止行为：

```powershell
bun test src/alpha/test
bun run typecheck
bun run check:architecture
```

真实引擎复跑需要显式建立可选环境。当前固定依赖快照验证于 Windows / CPython 3.14.3；不声明其他平台组合已经测试。以下环境位于临时目录，不改变应用现有 Python：

```powershell
$alphaEnv = Join-Path $env:TEMP 'whyj-akquant-0.3.58'
uv venv --python 3.14 $alphaEnv
$alphaPython = Join-Path $alphaEnv 'Scripts/python.exe'
uv pip install --python $alphaPython -r scripts/akquant-requirements.txt
uv pip check --python $alphaPython
bun run scripts/check-akquant.ts --python $alphaPython
```

已有环境可直接执行最后两步，勿重新创建。安装使用 [固定版本清单](../scripts/akquant-requirements.txt)；运行入口不自动安装或升级。`unavailable` 表示 Python 或依赖不可用，`version` 表示版本不符；`input`、`timeout`、`cancelled`、`process`、`output` 分别标记输入、期限、取消、进程失败和响应不可信。原始 stderr 不回传到研究结果；超过 256 KiB 或 stdout 超过 16 MiB 会停止进程。默认进程期限 60 秒，可显式调整至不超过 600 秒，真实检查脚本每例 180 秒。取消/超时等待子进程 close 后才返回。

R13 接口验收：14 项默认测试、73 次断言通过；真实引擎脚本 5/5 通过：

| 场景 | 已观察结果 |
|---|---|
| 次日开盘 + 佣金/滑点 | 两笔成交，最终权益 1017.1402 |
| 只有两股成交量，余单取消后重新计算目标 | 股数 0 → 2 → 10 → 0，三张订单，最终权益 1028 |
| 最后一日才出现买入信号 | 不下单，权益 1000，收益 0 |
| SMA 1/2 | 预热后在第三、第四日成交，最终权益 1027.2503 |
| 现金不足 | 两张 rejected 订单、零成交，权益保持 1 |

引擎返回版本 `0.3.58`、规则版本 `1.5.4`、Python `3.14.3`，19 个依赖的兼容检查通过。真实检查只消费合成 Bars，不联网取行情、不调用模型、不访问账户或公开缓存。普通 `bun test` 中的模拟协议不冒充真实引擎证据。

另以该 Windows 虚拟环境的真实 Python 运行等待任务，2 秒 deadline 返回 `timeout` 后，按任务自身记录的 PID 检查进程已退出；不只验证外层启动器结束。该手工探针不属于 5 个引擎场景或默认测试计数。

本轮工程记录：补充数值溢出反例前，全量为 1099/1099（147 文件、10661 次断言、77.43 秒）；补充后最终为 **1100/1100**（147 文件、10662 次断言、78.87 秒）。类型检查、架构检查和构建通过，架构基线违规为 0。默认 CLI 构建仍为 2680 模块、约 6.0 MB；独立 `src/alpha/index.ts` 另行打包为 10 模块、26.94 KB，尚未加入默认产品构建。四份相关文档的 148 个本地链接有效，`git diff --check` 通过。更新后真实引擎五例再次全部通过。

2026-09-15 对 [成交额缺失口径](./data-validation.md#2026-09-15缺失成交额与真实零值)复核：Alpha 输入校验保留 `amount:null` 与固定数据哈希，Python DataFrame 只传撮合所需的日期、OHLCV，不造一个成交额零值。已有临时环境中的真实 AKQuant 0.3.58 / 规则 1.5.4 / Python 3.14.3 执行 `bun run scripts/check-akquant.ts --python $alphaPython`，六个合成场景全部通过；新增缺失成交额样本与基线同为最终权益 1017.1402、两笔成交，输入哈希不同。该场景未访问真实行情、模型或账户；旧归档的误填零值无法从 v1 数值中追溯，限制见数据验证。

## 默认 Agent 入口

默认静态注册表已包含三个 Alpha 工具，随 whyj.core 启用。它们通过自然语言调用，没有新增 slash 命令：

| 工具 | 行为 |
|---|---|
| `alpha_engine_status` | 检查配置的 Python、AKQuant 0.3.58 与规则 1.5.4；ready 仅证明导入与版本 |
| `alpha_backtest` | 先检查引擎，再取日线；固定数据版本、验证成交/账本、原子保存 UUID 档案 |
| `alpha_runs` | 不带参数列出历史；带 `id` 读取原档案并复核原数据/账本，不运行撮合引擎 |

在上面的可选环境安装完成后，于 PowerShell 启动：

```powershell
$env:WHYJ_QUANT_AKQUANT_PYTHON = $alphaPython
bun run src/index.ts
```

也可把绝对路径写入 `settings.json` 的 `env.WHYJ_QUANT_AKQUANT_PYTHON`，保存值优先于进程环境。工具参数不能指定解释器或 Python 代码。该配置与 AKShare 数据环境独立；未配置、包缺失或版本不符会在取行情前失败，不改用其他回测引擎。

示例输入：先检查 Alpha 引擎，然后用 AKQuant 回测 AAPL，2024-01-02 至 2024-12-31，SMA 5/20，假设现金 100000、固定 10 股、佣金 0.001、滑点 0.01、每年 252 期，采用 generic-stock-next-open 模拟。全部假设需要显式给定；基金 NAV 不作为 OHLC 输入。实际运行仍需兼容行情源或覆盖该窗口的缓存。

Tool capabilities 会显示额外的引擎要求；已配置不等于已经通过导入检查，日线端点成功也不升级引擎状态。`alpha_engine_status` 的结果不写成长期权限证据。

## 归档、报告和恢复

`.ohquant/alpha/runs/{uuid}.json` 保存原始研究参数、数据来源/运行时 cache 状态、固定 Bars/DatasetRef、引擎版本、订单、成交、账本和指标，外层 SHA-256 检查完整性。共享 storage 负责锁和原子写入，runtime 负责语义核验；失败/取消不提交回测档案。行情服务已成功取得的公开数据可能先行归档。

历史读取不以最新行情替换丢失版本。报告核验同时匹配工具调用参数、UUID 档案、原始 DatasetRef、成交和账本；重算账本与指标，不声称重新运行撮合引擎。研究状态保留 run ID、假设和核验结果，重启后从原分支重新建立。

完整报告保留转录；独立分享只导出公开行情、单位初值 1 的曲线、指标和固定模拟假设，排除现金、股数、成交/订单 ID、run ID 和原始对话。Auto Artifacts 开关与既有报告浏览/恢复机制相同。

## 接入验证

```powershell
bun test src/alpha/test src/runtime/alpha-research.test.ts
bun run scripts/check-alpha-research.ts --python $alphaPython
```

新增集成测试覆盖默认注册工具、缺依赖前置失败、参数 schema、空数据、陈旧来源、取消、伪造账本、请求不符、损坏/缺失归档、历史数据修订、报告过滤和研究任务验收。默认测试不依赖安装 Python。

独立检查脚本使用真实 Pi 循环与真实 AKQuant，模型传输由本地 SSE fixture 固定，行情使用临时目录内的合成缓存。已验证三个默认工具、最终权益 1027.2503、HTML 报告及数据谱系、Session 重启与历史复核；不使用真实模型或联网行情，不将此记录解释为自然语言策略选择或市场数据质量验收。最初脚本误用 metadata.filePath 导致报告检查失败，改用现有 metadata.path 后完整通过。

2026-09-14 接入后的最终全量回归：**1113 pass / 0 fail**，149 文件、10752 次断言、75.66 秒；相较接口阶段新增 13 项测试。类型检查、架构检查（0 baseline violations）、构建及 `git diff --check` 通过。默认 CLI 已包含 Alpha，构建为 2694 模块、约 6.1 MB。上述 1100 项和独立打包记录保留为接入前证据。

| F25 验收条件 | 当前证据 |
|---|---|
| 实际引擎及依赖方式 | 固定 Python/wheel 与规则版本，真实五场景脚本 |
| 固定输入、成本、日期、版本 | 严格请求校验、DatasetRef 归档绑定及独立成交账本 |
| 工具可达和依赖发现 | 默认三工具、schema/requirements；缺依赖时取数前失败 |
| 超时、异常、空结果及取消 | 子进程协议测试与 runtime 无档案提交反例 |
| 研究谱系和恢复 | UUID 档案、原始版本复核、报告 DTO、真实 Pi 重启/历史检查 |
| 公开输出边界 | 单位曲线和白名单指标；模拟金额、股数及交易 ID 排除测试 |

F25 按 PRD 的本地研究引擎闭环完成。实盘、市场规则完善、真实模型语义和全市场数据质量仍属于各自的后续验收范围。
