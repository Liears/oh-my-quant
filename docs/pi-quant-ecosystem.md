# Pi 量化生态、WhyJ Quant 对比与插件开发

外部生态核验日期：2026-09-13；WhyJ 工作区复核日期：2026-09-24。WhyJ Quant 指本仓库当前工作区；外部包版本来自 npm registry，功能来自作者文档，部分关键机制核对了发布包源码。没有安装这些外部插件，也没有验证它们的真实行情、模型账户或交易执行。

## 结论与选型

Pi 生态已经有量化工具、研究验证流程、资产管理客户端和交易终端，定位不同。WhyJ Quant 的已有价值在于把自动取数、自定义标的组合、分析工具、会话和报告放进一个终端，并已提供静态、受信任的 WhyJ Extension API 1；目前不能把它描述为完整的策略研究平台或原生 Pi 通用插件宿主。

| 包与核验版本 | 定位与主要能力 | 对我们的参考价值 |
|---|---|---|
| [@mporenta/pi-trading-quant-chain](https://pi.dev/packages/@mporenta/pi-trading-quant-chain) `0.1.21`，2026-06-19 | 五角色串行研究、设计、开发和审查 | 任务交接、变更范围、有限重试 |
| [@weaxs/stock-analysis-plugin](https://github.com/Weaxs/stock-analysis-plugin) `0.1.12`，2026-09-09 | 多市场行情、分析、筛选、YAML 策略回测 | 共享 Python 工具核与多个宿主适配 |
| [veil-quant](https://pi.dev/packages/veil-quant) `0.1.0`，2026-08-17 | 数据时间约束、研究证据、实验验证与复现 | 从“有分析结果”到“结果可被检验” |
| [@pi-stef/finance](https://pi.dev/packages/@pi-stef/finance) `0.3.1`，2026-07-20 | 连接独立资产服务，查询持仓、配置偏离及建议 | 真实资产账户与观察组合的语义区分 |
| [ti-trader](https://pi.dev/packages/ti-trader) `0.2.1`，2026-09-10 | 独立加密资产交易 CLI，含模拟盘和实盘工具 | 交易执行与研究工具的职责划分 |

版本快照可分别复核：[chain registry](https://registry.npmjs.org/@mporenta%2Fpi-trading-quant-chain)、[stock registry](https://registry.npmjs.org/@weaxs%2Fstock-analysis-plugin)、[veil registry](https://registry.npmjs.org/veil-quant)、[finance registry](https://registry.npmjs.org/@pi-stef%2Ffinance)、[ti registry](https://registry.npmjs.org/ti-trader)。这里不根据下载数或功能清单推断质量、收益或生产可靠性。

## 重点：pi-trading-quant-chain

其核心产物是量化开发工作流。默认顺序为 researcher → architect → planner → developer → reviewer；包内带角色说明与链配置，项目 `.pi/agents` 可覆盖默认定义。入口包含启动 flag、slash command、状态组件和 `run_trading_quant_chain` 工具。[发布说明](https://cdn.jsdelivr.net/npm/@mporenta/pi-trading-quant-chain@0.1.21/README.md)

核对 `0.1.21` 入口源码后，值得关注的机制有：

| 机制 | 已观察到的行为 | 接入含义 |
|---|---|---|
| 子进程 | 启动 `pi --mode json -p`，解析子进程输出 | 本机需能找到独立的 `pi` 可执行文件 |
| 扩展隔离 | 子进程参数包含 `--no-extensions` | 在父 Pi 中安装其他量化插件，不代表链内角色能调用这些插件工具 |
| 审查范围 | 生成 developer 阶段的变更记录，传给 reviewer | 可避免将原有未提交文件混入本次工作责任 |
| 有限重试 | 实现任务的 reviewer 要求返工时，最多重跑一次 developer/reviewer | 不会无限自动改写；失败后仍需要处理剩余问题 |
| 可观测性 | 记录步骤、交接、耗时和工具事件，更新状态组件 | 适合追踪长任务，但不等同于量化结果正确性证明 |

上述实现依据：[发布入口源码](https://cdn.jsdelivr.net/npm/@mporenta/pi-trading-quant-chain@0.1.21/trading-quant-chain.ts)。本次只核对入口和关键控制流，没有完整审计所有角色、依赖及子进程异常路径。

作者描述的审查范围包括数据泄漏、前视偏差、费用、滑点和交易安全；这类审查提示不能替代计算引擎中的确定性校验。随包的 fake child fixture 用于无模型测试，也不能证明行情与回测有效。该包不能仅靠安装就补齐我们的行情适配器、通用策略引擎或收益核算。[发布说明](https://cdn.jsdelivr.net/npm/@mporenta/pi-trading-quant-chain@0.1.21/README.md)

若在独立 Pi 环境试用，作者提供的临时加载方式如下；本次没有执行：

```powershell
pi -e npm:@mporenta/pi-trading-quant-chain@0.1.21 --trading-quant-chain
```

## 其他包的功能边界

### stock-analysis-plugin：数据与策略工具集

作者当前 README 声明 39 个工具、20 个 Skills，覆盖 A/HK/US/JP/KR/TW，包含行情、财务、新闻、技术分析、多因子筛选和风险筛查；策略以 YAML 描述条件与参数，配套回测和诊断流程。底层 Python CLI 复用于 Pi、Hermes、OpenClaw 和 dsh。其多源覆盖、策略效果和可用性在本次均未实跑验证。[作者仓库](https://github.com/Weaxs/stock-analysis-plugin)

Pi 适配器通过 `ExtensionAPI` 注册工具，再调用 Python，因此复用价值在于“业务计算与宿主注册分开”。依赖 Python 环境，也依赖各数据源权限；不能把工具数量当成准确性指标。[Pi 接入说明](https://github.com/Weaxs/stock-analysis-plugin/blob/main/docs/pi-integration.md)

### veil-quant：研究证据与验证

三个主要工具分别负责带明确 `as_of` 的数据访问、研究产物验证、假设与实验记忆。作者区分探索结果和经过完整 Stage 4 的实验：缺少 Stage 4 时只生成未验证候选。数据来自注册的 CSV/Parquet，需配置项目数据、时间语义和运行环境。[发布 README](https://cdn.jsdelivr.net/npm/veil-quant@0.1.0/README.md)

入口源码确有缺少 `as_of` 时阻止调用的逻辑，并将验证工作委托给后端实现；不能据此宣称所有八项验证都已被我们验证，或任意 shell 读取也受到控制。[发布入口源码](https://cdn.jsdelivr.net/npm/veil-quant@0.1.0/src/extension.ts)

它最值得借鉴的是保存决策时点、输入身份、实验谱系与复现证据。我们的 `asOfDate` 当前主要表示数据覆盖到哪天，尚不是“历史决策当时已经可取得的数据”保证。

### finance：资产服务的 Pi 客户端

`@pi-stef/finance` 需要另外运行 `finance-api` 并配置 bearer token。它暴露持仓、净值、配置偏离、目标和建议等接口，也支持触发同步、导入及调整目标。因此它有状态修改能力，并非全部只读。[客户端说明](https://pi.dev/packages/@pi-stef/finance)

后端使用 SQLite，作者列出 CSV/OFX、SnapTrade 和 SimpleFIN 接入；Coinbase/Teller 仍为 stub，跨 provider 的重复账户也未自动去重。这些是文档披露的能力和限制，未连接账户验证。[后端说明](https://pi.dev/packages/@pi-stef/finance-api)

WhyJ 的自定义组合保存标的与分组，不等于券商账户、持仓金额或资金流水。若将来借鉴该方案，需要单独设计私有资产的接入和存储，遵循本项目的 [存储策略](./ohquant-storage-policy.md)。

### ti-trader：交易应用与随包扩展

作者将 `ti` 定位为独立交易 CLI，默认模拟盘，提供行情、账户、预检、买卖和风控工具。Binance 覆盖更完整，OKX/Bybit 标记为 experimental；模型与交易配置使用自己的目录。[包说明](https://pi.dev/packages/ti-trader)

需要区分其 CLI 和 Pi manifest：manifest 仅声明 `market-lab`、`market-chart` 两个扩展入口。把包安装进原生 Pi，不能据此推断已经获得 `ti` 的完整原生交易工具。它对我们的参考主要是交易执行分层，A 股/基金研究的适配程度仍需另行验证。[包 manifest 与说明](https://pi.dev/packages/ti-trader)

## 与 WhyJ Quant 的优势、劣势对比

以下“已有”来自当前源码；外部能力沿用前文作者声明，不代表做过同环境性能或准确率对照。

| 维度 | WhyJ 已有优势 | 当前劣势与可参考对象 |
|---|---|---|
| 使用流程 | TUI、Settings、组合、分析、Artifact/Trajectory 集成在同一入口 | 自维护终端与会话层，无法直接复用所有 Pi UI 扩展 |
| 数据获取 | 分析前自动取数、市场路由、缓存修订、陈旧来源标识，降低手工准备成本 | 不是逐笔行情终端；真实 US/HK 可用性尚未验收；stock-analysis 提供更广的数据与分析清单 |
| 组合管理 | CLI/TUI 共用增删改服务，保留交易所身份、空组和共享成员 | 是观察标的组合；缺 finance 的真实账户汇总、资金和配置偏离语义 |
| 策略表达 | 内置 SMA、因子、风险、基金定投和 Benchmark 工具，调用路径明确 | 股票策略回测入口仍固定为双均线，缺 stock-analysis 式通用策略 DSL |
| 研究验证 | 有数据来源、窗口处理、基准日期对齐及结果制品 | 缺 veil 式历史可得性契约、冻结输入、实验登记和完整复现机制 |
| 任务编排 | 单 Agent 会话、取消、恢复、压缩和事件生命周期可独立测试 | 没有 chain 式五角色开发流水线；引入前应先证明单 Agent 的具体失败模式 |
| Pi 接入 | 直接使用锁定为 `0.85.1` 的上游 loop 与模型协议，已删除重复实现；WhyJ API 1 可静态加载工具、skills、命令和 capability | WhyJ API 1 不是 `pi-coding-agent` ExtensionAPI，不能直接安装 npm Pi extension；现有 JSONL 会话仍由自身适配 |
| 工程验证 | 模块测试、架构检查、独立目录 CLI 验收已有记录；回测账本与收益指标已有独立人工样例 | 这些证据只覆盖已列契约，不能证明全部数值、真实模型鉴权或外部插件兼容 |
| 交易执行 | 研究工具与组合管理的范围清楚 | 没有 ti-trader 的交易所订单与执行风控；是否需要属于产品范围决策 |

本地依据：[模块架构](./module-architecture.md)、[工具注册表](../src/tools/registry.ts)、[自动取数](../src/runtime/analysis-data.ts)、[组合服务](../src/runtime/portfolio.ts)、[内核边界](./pi-agent-loop-harness.md)、[验收记录及范围](./core-data-audit.md)。

### 历史对比发现与当前修复状态

2026-09-13 的对比曾复现回测权益递推偏差：旧实现以 `prevPos × (p_t / p_prev - 1) × p_t` 计算持仓损益，和股数账本的 `prevPos × (p_t - p_prev)` 不一致。该问题随后已修复；当前实现按现金、股数、成交额和费用逐期执行自融资账本，并让上一期目标权重在下一收盘价成交。[计算源码](../src/quant/backtest.ts)

本次在本机执行了如下无网络复现：

```powershell
bun -e 'import { vectorizedBacktest } from "./src/quant/backtest.ts"; console.log(vectorizedBacktest([1,1,1], [100,100,110], 100000, 0, 0).equity);'
```

旧实现末值约为 `111000`；当前命令返回 `[100000,100000,110000]`，与第二个价格点持有 1000 股、第三个点上涨 10 元的独立账本一致。回归还覆盖费用、部分仓位、再投资、无效价格和权重。[数值契约测试](../src/quant/backtest-correctness.test.ts)

旧版 `cagr` 也曾用算术平均日收益年化，使 `[0.1, -0.1]` 返回 `0`。当前 `report` 先复利得到 -1% 累计收益，再按显式自然年跨度或 252 期默认口径几何年化；Benchmark、Sortino、Calmar 和风险报告共享相同定义。费用仍由调用方以参数传入，尚未建立逐市场默认费用、滑点、复权、涨跌停和实际成交规则，因此修复不等于完整市场回测验收。

2026-09-13 对比时，[provider-smoke.ts](../scripts/provider-smoke.ts) 曾只检查 `prompt` 是否抛异常，允许空响应被判为成功。2026-09-14 模型配置统一时已修复：必须获得非 error/aborted 的非空 assistant 文本，空响应、401、超时均返回失败；本地 HTTP fixture 已覆盖这些分支。真实供应商账户仍未验收，模型测试证据见 [验收记录](./model-config-audit.md)。

## 如何基于 Pi 开发插件

### 先区分四种资源与两种宿主

| 资源 | 用途 | 适合量化场景 |
|---|---|---|
| Extension | TypeScript 注册工具、命令、事件、UI | 数据访问、计算、强制校验、任务执行 |
| Skill | `SKILL.md` 描述工作步骤并引用脚本 | 研报流程、分析方法、结果解释 |
| Prompt template | 可重复使用的提示模板 | 研究简报、因子解释 |
| Theme | 终端显示样式 | 统一展示 |

这些资源通过 `package.json` 的 `pi` 字段发布，包可来自 npm、git 或本地路径。[官方 Packages 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)

**原生 Pi** 提供 `@earendil-works/pi-coding-agent` 的 `ExtensionAPI`。**WhyJ 嵌入 pi-agent-core/pi-ai，并提供自己的会话适配和 [WhyJ Extension API 1](./extensions.md)**；后者以静态 TypeScript definition 加载工具、skills、命令和 capability，包含版本、声明匹配、冲突、启停、重载、取消和诊断契约。它不实现原生 Pi 的事件/UI API，也不会自动执行 npm 包内的 Pi extension。[Skill 发现](../src/agent/src/skills.ts) 仍只读取受支持的共享 Skill 目录。

所以 `pi install` 管理的是 Pi 环境，不能当成 `whyj` 的插件安装命令；只复制 Skill 也不能使其引用的专有工具自动出现。原生 Pi adapter、WhyJ extension definition 和 durable 会话格式是三个不同契约。

### 最小包结构与示例

建议先做独立 Pi 包，将计算和宿主适配拆开。以下为教学示例，接口按 Pi `0.85.1` 发布类型核对；不是本仓库已经发布的插件，未在真实 Pi 宿主中运行。[官方发布类型](https://cdn.jsdelivr.net/npm/@earendil-works/pi-coding-agent@0.85.1/dist/core/extensions/types.d.ts)

```text
whyj-pi-quant-example/
├── package.json
├── src/core.ts           # 纯计算，不读取 UI、会话或配置
├── extensions/index.ts   # schema、注册与结果映射
└── test/core.test.ts     # 数值契约测试
```

`package.json` 的最小配置：

```json
{
  "name": "whyj-pi-quant-example",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "keywords": ["pi-package"],
  "files": ["extensions", "src"],
  "pi": { "extensions": ["./extensions/index.ts"] },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "0.85.1",
    "typebox": "1.3.7"
  }
}
```

宿主提供的包放 peerDependencies，独立业务运行依赖放 dependencies；开发测试锁定宿主版本。通配 peer 不代表兼容任意 Pi 版本，发布时仍需声明实际测试范围。分发 Skill 时再加入 `pi.skills` 与对应打包目录。[官方依赖约定](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)

`src/core.ts`：以小数收益输入，返回非负最大回撤比例。

```typescript
export function drawdown(returns: number[]): number {
  if (!returns.length || returns.some(r => !Number.isFinite(r) || r < -1)) {
    throw new Error("Expected non-empty finite returns >= -1");
  }
  let nav = 1;
  let peak = 1;
  let maximum = 0;
  for (const r of returns) {
    nav *= 1 + r;
    if (!Number.isFinite(nav)) throw new Error("NAV overflow");
    peak = Math.max(peak, nav);
    maximum = Math.max(maximum, 1 - nav / peak);
  }
  return maximum;
}
```

`extensions/index.ts`：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { drawdown } from "../src/core.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "whyj_max_drawdown",
    label: "Maximum drawdown",
    description: "Calculate maximum drawdown from decimal period returns.",
    parameters: Type.Object({
      returns: Type.Array(Type.Number({ minimum: -1 }), { minItems: 1 })
    }),
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      const result = { maxDrawdown: drawdown(params.returns) };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result
      };
    }
  });
}
```

Pi `0.85.1` 工具执行参数顺序是 `toolCallId, params, signal, onUpdate, ctx`。需要人工命令时用 `pi.registerCommand`，需要工具调用前校验时用 `pi.on("tool_call", ...)`；关键数据约束同时放到业务层，避免其他调用入口绕过。UI API 只在有 UI 的上下文中使用。[官方 Extensions 文档](https://cdn.jsdelivr.net/npm/@earendil-works/pi-coding-agent@0.85.1/docs/extensions.md)

在示例包目录安装开发依赖、用已配置好的原生 Pi 临时加载：

```powershell
bun install
pi -e ./extensions/index.ts
```

确认行为后可在消费项目中执行 `pi install -l <本地包路径>`，将包写入项目配置；正式发布前补齐说明、测试和资源打包，再移除示例的 `private`。本次没有安装或发布包。[官方本地加载与安装](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)

### 把 WhyJ 能力提供给 Pi 的最小路线

建议保留已有业务核，逐个暴露稳定工具：

```text
WhyJ CLI/TUI → WhyJ 工具适配 ─┐
                            ├→ 数据/计算服务 → provider 与公开数据缓存
原生 Pi → 独立 Extension ────┘
```

先从无 IO 的计算函数或已经存在的只读 JSON 命令开始。当前 `whyj --json -c "/portfolio"` 可读取标的组合，`--json doctor` 可检查环境；不能假设任意 Agent 工具都已经具有同名 CLI 命令。完整计算适配需要先建立可分发的领域入口，不把 `session-runtime`、TUI 或用户配置目录当成插件公共 API。[当前 CLI 入口](../src/index.ts)

接数据工具时统一返回实际 source、数据日期、查询窗口、缓存状态；如果目标是历史研究，再增加决策时点、可得性和输入内容身份。取消信号需传到 HTTP/Python，不能仅在 UI 上显示取消。

推荐顺序是：持续保留收益账本回归 → 提取少量稳定的数据/计算契约 → 做独立 Pi 适配包 → 用实际任务验证价值 → 按需增加研究验证或多角色编排。WhyJ API 1 已解决本仓库内静态可信扩展的生命周期问题；原生 Pi 兼容层仍应以具体插件和任务为验收对象。

## 启动与测试方式

### 启动本仓库

```powershell
cd C:\Users\yangjing\Project\oh-my-quant
bun install
bun run src/index.ts
```

已有依赖时可跳过安装。进入后用 `/config` 配置模型，用 `/portfolio` 编辑组合；默认 A 股 AKShare 数据路径还需要本机 Python 已安装 `akshare`。开发自动重启用 `bun run dev`，构建运行则先 `bun run build` 再 `bun run start`。[启动说明](../README.md)、[数据环境](./source-data-providers.md)

### 当前项目检查

```powershell
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

按模块定位问题可执行 `bun test src/agent/test`、`bun test src/source/tests`、`bun test src/tools/quant-tools.test.ts`；开发时可用 `bun run test:watch`。`bun run test` 先执行 test fence，再执行默认测试，真实网络与手工制品测试需单独选择。[脚本定义](../package.json)

较早的核心数据验收记录为 640 pass / 0 fail / 77 个文件；它保留当时的工作区证据。[原始验收记录](./core-data-audit.md) 2026-09-24 在 `requiresTools` 绑定和本文状态纠偏后，串行全量为 **1874/1874、224 个文件、23761 次断言、300.38 秒**，typecheck、architecture、test fence 和生产构建（3052 modules / 7.1 MB）通过。回测账本专项为 **15/15、68 次断言**；这些本地验证不包含外部插件安装或真实供应商账户。

`bun run test:providers` 会使用配置中的真实模型凭证发请求，当前已检查非空响应及最终错误状态，并以非零退出码表示失败。Doctor 的退出码约定不同，必须检查 model phase，见 [配置与测试说明](./configuration.md)。本次没有运行真实供应商账户探测。

### 新插件应补的测试

| 层次 | 应验证的行为 |
|---|---|
| 纯计算 | 人工可算的盈利/亏损/费用账本；复利口径；非法数值；示例回撤 `[0.1,-0.2,0.25]` 应约为 `0.2` |
| 数据契约 | 截止时点、日期排序与缺失、重复修订、复权/费用单位、来源切换与陈旧缓存 |
| Pi 适配 | 注册工具名称与 schema；参数、结果和错误映射；取消是否传到业务层 |
| 流程 | 若增加链编排，模拟子进程失败、交接丢失、有限重试、超时与恢复；不以真实 LLM 代替确定性断言 |
| 宿主验收 | 在隔离 Pi 配置与固定版本中验证加载和一次工具调用；真实 provider 测试另列凭证与环境要求 |

2026-09-13 的文档验证记录为：当时 16 个本地链接均存在；示例 manifest 可解析；两个 TypeScript 代码块通过语法转换；回撤函数的 3 个数值案例和 4 个非法输入案例通过。API 签名另行核对了发布类型，但未完成整个插件的宿主类型检查。2026-09-24 重新扫描 61 份现行 Markdown，**1218 个本地链接均存在**；完整原生 Pi 插件加载、跨宿主兼容和真实模型调用仍是后续验收项。
