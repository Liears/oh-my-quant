# WhyJ Quant 数据源 Provider

本文档描述 WhyJ Quant 使用的行情数据源：其官方 API/文档入口、本地 adapter 实际调用的内容、运行时优先级顺序，以及这些 adapter 如何注入 agent loop。

这些 provider 的配置位于 `.ohquant/settings.json`。普通取数的付费凭证在实际派发对应 adapter 时才从 settings 规范化为统一的 `WHYJ_QUANT_*` 键名；不要把项目根目录 `.env` 当成主配置源。

## 1. Provider 矩阵

| Provider | 官方网站/文档 | WhyJ Quant adapter 文件 | 市场 | 配置键 |
|------|------|------|------|------|
| AKShare | https://akshare.akfamily.xyz/ | `src/source/src/akshare.ts`、`src/source/src/akshare-global-bars.ts` | A 股、指数、基金、美股、港股日线 | 无 |
| Tushare | https://tushare.pro/document/2 | `src/source/src/tushare.ts` | A 股、指数、基金（ETF/LOF/开放式） | `WHYJ_QUANT_TUSHARE_TOKEN` |
| Financial Datasets | https://docs.financialdatasets.ai/introduction | `src/source/src/financial-datasets.ts` | 美股 | `WHYJ_QUANT_FINANCIAL_DATASETS_KEY` |
| LLMQuant Data | `LLMQUANT_BASE_URL` / `https://api.llmquantdata.com` | `src/source/src/llmquant.ts` | 美股；港股路由支持待核验 | `WHYJ_QUANT_LLMQUANT_API_KEY` |

注意：LLMQuant Data 在本仓库中以直接 HTTP adapter 方式接入。撰写时，仓库依赖配置的 API base URL，而非入库的公开文档链接。

### OHLC 复权口径（2026-10-11）

`DatasetRef.adjustment` 记录计算实际使用的 `close` 口径，独立于可选 `Bar.adjClose`；不自动切换到调整收盘价，也不认证总回报或历史发布时点。

| 实际 adapter 路由 | 标签 | 含义 |
|---|---|---|
| AKShare 普通 A 股三端点，均请求 `adjust="qfq"` | `forward-adjusted` | 前复权；历史价格可能随再次抓取重算，未独立校准因子 |
| AKShare US/HK，请求 `adjust=""`；Tushare `daily` / `fund_daily` | `unadjusted` | 未复权；拆股和现金分配可能影响价格收益，未做公司行为对账 |
| 通用 Bars 的基金单位净值映射 | `unit-nav` | OHLC 均为单位 NAV；价格收益不含现金分配 |
| AKShare 指数日线、Tushare `index_daily` | `index-level` | 已发布指数点位；未认证指数的分红及成分规则 |
| Financial Datasets、LLMQuant、未知端点或只返回数组的替换 adapter | `provider-unspecified` | OHLC 口径未核验，即使另有 `adjClose` 也不推断 |

AKShare 标签只对应本仓库脚本实际派发的端点及参数，不能根据任意替换 adapter 的名称推断。来源门面拒绝不在枚举内的标签，保存时写入本次响应元数据；缓存、离线回退、归档截止读取与报告保留同一口径。旧版本未记录的标签仍为未知，不改写旧归档。[AKShare 官方参数](https://github.com/akfamily/akshare/blob/main/docs/data/stock/stock.md)、[Tushare daily 官方口径](https://tushare.pro/document/2?doc_id=27)。

前复权响应不会与上次抓取的累积价格拼接；口径切换也重建当前 head。旧不可变修订继续可读。详见 [存储规则](./ohquant-storage-policy.md#日线缓存)和[验证记录](./data-validation.md#2026-10-11复权口径与跨响应缓存隔离)。

## 2. 官方接口与本地使用

### AKShare

- 官方文档：
  - 主页：https://akshare.akfamily.xyz/
- WhyJ Quant 调用：
  - 普通 A 股日线按默认链降级：
    1. `ak.stock_zh_a_hist(...)`（东方财富）
    2. `ak.stock_zh_a_daily(...)`（新浪）
    3. `ak.stock_zh_a_hist_tx(...)`（腾讯）
  - 指数日线依次尝试 `index_zh_a_hist`、`stock_zh_index_daily_em`、中证/国证/申万及新浪接口
  - `ak.fund_open_fund_info_em(..., indicator="单位净值走势")`
  - 美股 `stock_us_daily(symbol="AAPL", adjust="")`、港股 `stock_hk_daily(symbol="00700", adjust="")`；详见 [AKShare 股票接口](https://akshare.akfamily.xyz/data/stock/stock.html)
- 本地角色：
  - A 股/指数/基金日线的主要数据源
  - A/US/HK 市场兼容链中的零密钥公开日线源
- 本地 wrapper 形态：
  - Node 通过 `child_process.spawn` 启动 Python 子进程执行 AKShare 代码片段
  - adapter 将结果标准化为内部 `Bar[]`
  - `fetchFromAKShareDetailed()` 额外返回实际命中的 endpoint 和每次 endpoint attempt
  - 全部 AKShare endpoint 失败/返回空时，adapter 返回空 bars，由上层继续降级到 Tushare
  - 可通过 `providers.akshare.sourcePriority` 调整普通 A 股日线顺序，例如 `sina,eastmoney,tencent`
  - 在进入 Python 前先区分带后缀的股票、`.OF` 基金和已知指数，避免 `000001.SZ` 错降级成同代码基金或指数
  - 腾讯日线的 `amount` 表示手数，adapter 将其映射到内部 `volume`；成交额未提供时记为 `null`
  - 美股/港股独立模块只接受对应市场的规范化代码；进入 Python 前港股去掉 `.HK`，响应按请求窗口过滤；未指定窗口时仅返回末尾 30 行
  - 这两条新浪接口请求未复权日线。未返回成交额时内部 `Bar.amount` 记为 `null`，真实返回的零值仍是 `0`；港股端点本次返回额外非空 `amount`，adapter 保留供应商原值，单位尚未独立核对。研究回测仍需单独核对复权、修订和历史当时可得性
- Python 发现顺序（`getPythonCandidates()`）：
  1. 包根目录 `.venv/` 下的 python（从当前模块向上查找 `package.json`，兼容源码和 `dist`）
  2. `py -3`（Windows Python Launcher）
  3. `python3`
  4. `python`

### 公开基金 NAV 与 DCA 的独立路径

`akshare_fund_nav` 使用 `FundNavDaily[]`，依次尝试 `fund_open_fund_info_em`、`fund_etf_fund_info_em`、`fund_graded_fund_info_em`、`fund_financial_fund_info_em`；实际成功端点进入 `FundNavDatasetRef`。只有合法日期和正单位 NAV 会归档，六位代码规范为 `.OF`。这条专门 NAV 路径不伪造 OHLC，与下面通用 Bars adapter 的既有基金映射分开。

`fund_dca_backtest` 的 NAV 来自 `fund_open_fund_info_em`，未指定显式费率时同时请求 `fund_purchase_em`。手续费字段按百分数转换，`0.03` 表示 0.03%；非数值、失败或另一基金的费率记录为不可用，计算明确采用零费假设。当前费率只作为恒定模拟假设，不是历史费率。字段定义见 [AKShare 基金接口文档](https://github.com/akfamily/akshare/blob/main/docs/data/fund/fund_public.md)。

两个工具仍实时请求数据；公开归档只供报告固定版本恢复，没有 TTL/head，也不缓存实际账户。NAV、申购费及通用基金 Python 请求接收 AbortSignal，取消停止后续回退并在归档前复查。观测时间为本地请求完成的 UTC；Python 返回的无时区时间不直接标作 UTC。归档与修订规则见 [存储策略](./ohquant-storage-policy.md#公开基金-nav-归档)，DCA 的费用/现金流/日期口径见 [量化工具](./quant-tools-design.md#fund_dca_backtest)。

### Tushare

- 官方文档：
  - 入口：https://tushare.pro/document/2
- WhyJ Quant 调用：
  - `daily` — 股票日线
  - `index_daily` — 指数日线
  - `fund_daily` — ETF/LOF 日线
  - `fund_nav` — `.OF` 开放式基金净值，映射为 OHLC 相等、合成成交量为 0、成交额不可用的序列
  - `stock_basic` — symbol 搜索
- 本地角色：
  - 当 `settings.preferences.source` 设为 `tushare` 时的 A 股首选 provider
  - 其他 source 配置下，AKShare 返回空或出错时的 A 股回退
  - `/search` 风格查找的 symbol 搜索
  - A 股日线与 symbol 搜索；紧凑快照由已成功获取的 bars 派生，不请求 `daily_basic`
- 本地 wrapper 形态：
  - POST `https://api.tushare.pro`
  - body 包含 `api_name`、`token`、`params`、`fields`

`daily`、`index_daily`、`fund_daily` 与 `fund_nav` 都请求 `ts_code`，在映射为 Bars 前逐行与请求代码核对；缺少代码、混入另一标的或返回代码不符时，整次响应作为身份错误交给兼容来源链，不能只保留看似正确的几行。单独导出的 `daily_basic` 快照也核对全部返回行。`fund_nav` 官方返回字段包含 `ts_code`、`nav_date`、`unit_nav` 与 `adj_nav`，见 [Tushare 基金净值接口](https://tushare.pro/document/2?doc_id=119)；股票与指数的代码字段见 [股票日线](https://tushare.pro/document/1?doc_id=27)和[指数日线](https://tushare.pro/document/1?doc_id=95)。本地反例覆盖错标、缺字段、混合行以及只归档回退来源。当前配置的 Tushare 实际请求仍因权限失败，不能用这些本地测试证明付费端点或 `.OF` 路由在该账号上可用。

### Financial Datasets

- 官方文档：
  - 介绍：https://docs.financialdatasets.ai/introduction
  - [历史价格](https://docs.financialdatasets.ai/api/prices/historical)与[公司快照](https://docs.financialdatasets.ai/api/prices/snapshot)
  - API 族包括 Stock Prices、Company 和 Financial Metrics
- WhyJ Quant 调用：
  - `GET /prices/`
  - `GET /prices/snapshot`
- 本地角色：
  - 美股 bars 的回退/显式数据源
  - 比本地 A 股 adapter 更丰富的美股快照数据
- 本地 wrapper 形态：
  - HTTP GET，带 `X-API-KEY`
  - 默认请求最近 60 天窗口；未显式传日期范围时只向上层返回最近 30 条
  - 接受数组 payload 或包装的 `{ prices: [...] }` / `{ data: [...] }`

官方历史价格响应声明顶层及逐行 `ticker`。本地适配器在任一位置实际提供 ticker 时逐项核对请求标的，快照同样核对；错标或混合行整批失败。价格响应带 `next_page_url` 时，沿官方不透明 cursor 逐页读取，直到没有下一页才合并归档；每页单独计费，并受同一请求期限及 128 页保护上限约束。继续链接须与起始价格端点同源同路径且只含一个非空 cursor，禁止 HTTP 重定向；循环、错标、无效页、中途失败或超出上限均丢弃本轮局部行并走兼容回退。逐行要求有效日期、完整 OHLCV 和自洽价格，缺失成交量不补成零、矛盾行不静默删除；声明了无效复权收盘价也拒绝整批。旧数组/包装响应可无 ticker，仍按既有格式读取，此时仅凭这份响应无法独立证明标的身份；不带分页标记的缺页也无法识别。当前配置源矩阵为 HTTP 402，分页与逐行校验只通过本地响应 fixture 验证。[官方分页契约](https://docs.financialdatasets.ai/guides/pagination)。

### LLMQuant Data

- 运行时端点：
  - 默认 base URL：`https://api.llmquantdata.com`
  - [官方历史日线契约](https://docs.llmquantdata.com/en/api/prices/equity-historical)当前写明美股与 `data.ticker`；[市场覆盖](https://docs.llmquantdata.com/en/market-coverage)未列港股行情。
- WhyJ Quant 调用：
  - `GET /api/equity/historical`
- 本地角色：
  - 配置后作为美股 bars 的首选直接 adapter；现有港股链也尝试该端点，支持范围待核验
  - 将 `adj_close` 保留为内部 `adjClose`
- 本地 wrapper 形态：
  - HTTP GET，带 `Authorization: Bearer <WHYJ_QUANT_LLMQUANT_API_KEY>`
  - 无显式日期范围时追加 `limit=30`；显式范围使用官方上限 `limit=200`
  - 接受包装的 `{ data: [...] }` 或 `{ data: { prices: [...] } }`
- 配置位置：
  - 在 `.ohquant/settings.json` 中设置 `WHYJ_QUANT_LLMQUANT_API_KEY` 和可选的 `WHYJ_QUANT_BASE_URL`

本地适配器现在核对响应实际声明的顶层、`data` 或逐行 ticker，任何错标使整批失败。双侧日期窗口收到官方 `meta.notice` 截断提示时，将窗口按日历日期拆成不重叠的两半，继续请求直到各段均无截断提示，最多 128 次请求；这些请求沿用同一取消信号及上层单次请求期限。单侧日期窗口、单日仍截断、超限或任一子请求失败时，整次不返回已取到的局部 bars，交给兼容回退。与 FD 共用逐行校验，缺失/无效 OHLCV、日期或已声明的复权收盘价会使整批失败，不把缺失成交量补零或静默删掉矛盾日期；无效包装响应也报错。无 ticker 的旧响应形态仍可读取，身份不能单凭该响应证明；无截断提示也不能独立证明供应商覆盖了每个预期交易日。现有 HK 回退链仍会尝试此端点，但官方文档未声明港股支持，当前账号仅见 HTTP 401、没有港股成功样本；HK 能力不能以路由存在视为已验证。

## 3. 数据优先级规则

优先级不是静态全局列表，取决于市场和调用路径。

### 3.1 `fetchBars()` 优先级

文件：`src/source/src/sources.ts`

1. 规范化代码并核对请求市场；不匹配时在缓存读取和 provider 调用前报错。
2. 运行时从 settings 读取首选 provider 与凭证；显式 source 优先。
3. 按首选与回退顺序检查当前市场兼容 provider 的缓存；auto 可直接命中 fresh，显式 source 不使用 fresh 命中但保留已检查的行作失败后的可见离线回退。
4. 缓存命中必须同时满足：抓取时间在过去 5 分钟内，且最近一次实际响应的日期集合与请求范围已经覆盖。无界抓取不能仅凭无界请求元数据声称更早/更晚日期已返回；超出实际首末日期时重新查询 provider。不同日期窗口不能仅凭“今天抓过”命中。
   - 新快照的 `meta.turnoverSemantics: nullable` 标明缺失成交额已保留为 `null`。没有该标记的旧缓存仍可按日期/TTL 使用，但零成交额的来源不可核实；`fetch_snapshot` 将这种旧 0 展示为 unavailable 并标注 `legacy-unknown`。原始不可变版本保持不变。
5. 未命中时走 provider 链；成功 bars 按日期合并，新的同日记录替换旧值，实际成功 provider 决定缓存目录。
6. provider 全部失败时再次检查当前市场的缓存，以便发现其他进程期间写入的有效版本；已有行返回 `origin: stale-cache`，没有数据返回 `unavailable`。工具必须展示状态和实际数据日期。

普通 `fetch_bars`/价格研究、实时窗口取数与 A 股代码搜索各有生产默认 60 秒单调时钟预算；调用方可通过 `providers.budgetMs` 给单次请求设置更短期限。普通取数的同一截止覆盖来源偏好选择、缓存检查、完整兼容 provider 链、归档保存及失败后的缓存复查；实时有界窗口与无界回退也共用同一截止。付费凭证在内置 adapter 实际派发时惰性读取，同步设置解码越期后不再发 HTTP；显式来源的离线缓存不需要付费设置。历史归档只读模式不启动网络预算。异步依赖即使忽略 signal，调用方也停止等待；实际 HTTP/Python adapter 接受预算 signal。已检查的旧行可在超时后以 `stale-cache` 返回，未归档的 provider 行不会伪装为持久证据；同步归档提交已完成但跨过截止时，结果携带真实 DatasetRef 和 `budgetExhausted: true`。同步解码/提交无法被定时器抢占，只能在返回后由单调时钟标记超期。外部用户取消仍中止整次调用，不改为旧缓存回退。Overview 的并发整轮预算是另一层契约，不能把单标的 60 秒上限解释为整屏刷新期限。固定反例和限制见 [供应商链预算](./data-validation.md#2026-09-15普通取数的供应商链预算)、[完整请求截止](./data-validation.md#2026-09-15单次取数完整请求截止)与[凭证读取边界](./data-validation.md#2026-09-16单次取数的来源偏好与凭证读取边界)。

`BarsFetchResult.origin` 为 `provider | cache | stale-cache | unavailable`，同时保留 `source`、`asOfDate`、`attempts`。无效日期、非正/非有限价格、缺失 OHLCV、非法非空成交额及 `low <= open/close <= high` 不成立的记录在入库前过滤；未提供成交额的有效 OHLCV 可入库但 `amount` 为 `null`。若某 provider 没有剩余有效行，进入兼容回退链，不能更新 fresh head。非法区间直接报错。实际响应日期集合不证明交易日完整、复权或历史当时可得性，见 [数据验证](./data-validation.md#2026-09-15ohlc-一致性与损坏响应隔离)。

历史观察模式通过 `fetch_bars_archive` 的必填 `observed_before`（精确 UTC 毫秒时刻）进入；普通 `fetch_bars` 的可选同名参数也调用这条路径。它只扫描当前市场兼容来源的已提交不可变响应修订，要求归档的应用抓取时间不晚于截止、该单次响应的日期范围与实际日期集合能覆盖请求，选择最近的符合版本。新协议下，只有当前有效 head 或带内容校验标记的修订可作为已提交版本；归档后、head 前崩溃遗留的无标记文件被跳过，损坏标记则保守失败。旧协议修订无法追溯证明这层提交状态。它不把后来 head 的价格拼入旧响应、不合并多个响应、不请求 provider 或重写缓存。归档损坏时保守失败，不用可用的旧行冒充完整历史。`origin: cache` 配合 `historicalBoundary.evidence: app-archive` 表示归档读取，不能解释成 fresh 行情或供应商当时已发布。工具将最新价格日期、应用观察 UTC 和该证据边界分别展示；真实供应商发布时间、复权和交易日完整性仍未知。专项回归及命令见 [历史观察截止](./data-validation.md#2026-09-15应用观察截止与历史归档读取)与[提交边界](./data-validation.md#2026-09-15-bars-修订提交边界)。

需要在该本地观察版本上计算因子、SMA 回测或风险时，使用 `analyze_archived_bars`，输入明确的价格窗口和 UTC 截止；它不走上述普通缓存/provider 优先级，计算及报告恢复绑定相同 DatasetRef。报告公开引用投影保留经白名单核对的 `providerEndpoint`，以便归档读取复核实际成功端点；不安全 URL/凭证标签拒绝。见 [归档研究计算](./data-validation.md#2026-09-15归档时点研究计算)。

### 3.2 `pullBarsFromProviders()` 优先级

这是权威的实时 provider 回退链。

市场 `A`：

1. 根据 `selected` 参数决定优先 provider：
   - `selected === "tushare"` → Tushare 优先，失败回退 AKShare
   - 其他（auto / akshare 等）→ AKShare 优先，失败回退 Tushare
2. Tushare 按代码语义选择 daily / index_daily / fund_daily / fund_nav，不把同数字代码的股票回退成基金。

市场 `US`：默认 LLMQuant Data → Financial Datasets → AKShare `stock_us_daily`；显式选择兼容 provider 时将其放在首位。

市场 `HK`：默认 LLMQuant Data → AKShare `stock_hk_daily`。选择了不支持该市场的全局 provider 时，使用该市场默认链；不会把港股发给 Financial Datasets，也不会把 A 股发给美股接口。

重要细节：

- 显式 `source` 参数必须优先生效，不能被默认 source 覆盖。
- A 股始终尝试两个 provider（首选 + 回退），顺序由 `selected` 参数决定。
- US/HK 只将 AKShare 路由到各自的公开新浪日线，不调用 A 股或 Tushare 路径。
- `Financial Datasets` 仅用于 `US`，包括显式 source 的情况。
- provider 抛错或返回空数组时，source orchestrator 不向上抛出该错误，而是继续尝试下一项。
- 返回的 `source` 与缓存目录始终使用实际成功的 provider，不能使用失败的首选 provider。
- 市场与代码不匹配是请求输入错误，在替换 adapter 调用前直接报错，不进入 provider 错误回退链。

### 3.2.1 两级降级模型

A 股日线包含两层独立的降级：

```text
AKShare adapter
  stock_zh_a_hist（东方财富）
    → stock_zh_a_daily（新浪）
    → stock_zh_a_hist_tx（腾讯）
      ↓ 全部 error/empty
source orchestrator
  Tushare
    ↓ 仍然 error/empty
fetchBars() 的当前市场兼容缓存（stale-cache）
```

AKShare 内部 endpoint 顺序通过每次调用的 `providers.akshare.sourcePriority` 配置：

```ts
const result = await fetchLiveBars("600000.SH", "A", undefined, undefined, {
  providers: {
    akshare: {
      sourcePriority: ["sina", "eastmoney", "tencent"],
    },
  },
});
```

支持 provider 名、AKShare endpoint 名和中文别名；重复项会去除，无效或空配置回到默认链。
`fetchFromAKShareDetailed()` 用于需要 endpoint 级诊断的调用：

```ts
const detail = await fetchFromAKShareDetailed("600000.SH", undefined, undefined, {
  sourcePriority: "新浪,东方财富,腾讯",
});

detail.bars;     // 标准 Bar[]
detail.endpoint; // 实际命中的 AKShare endpoint；全部为空时为 null
detail.attempts; // 每个 endpoint 的 ok/error、rows 或 error
```

普通业务调用继续使用 `fetchFromAKShare()`，其返回类型保持为 `Bar[]`。全部 AKShare endpoint
失败或为空属于可降级结果，返回空数组而不是让 Python 子进程以失败退出；导入 AKShare/Python
不可用等 adapter 级故障仍由外层 provider orchestrator 捕获并切换到 Tushare。

### 3.2.2 替换 adapter 与自定义 provider 降级链

`SourceProviderOptions.adapters` 是 provider 的可替换边界。调用方可以只替换不稳定的 AKShare
实现，不需要修改 `fetchBars()`、`fetchLiveBars()` 或 Overview：

```ts
await fetchLiveBars("000300.SH", "A", undefined, undefined, {
  providers: {
    adapters: {
      akshare: {
        fetchBars: ({ symbol, start, end }) => alternativeClient.fetchBars(symbol, start, end),
      },
    },
    fallbackOrder: { A: ["akshare", "tushare"] },
  },
});
```

`pullBarsFromProviders()` 同时返回 `attempts`，逐项标记 `success`、`empty` 或 `error`。
provider 异常可能夹带 URL 路径、未知查询参数、header 或响应正文；跨 provider 的 `attempts.error` 只输出固定类别（HTTP 状态、鉴权、权限、超时、身份不符、响应截断、缺凭证/依赖、连接或一般失败），不转发原始异常文本。数据配置检查仍根据 HTTP 401/402/403 和稳定类别提供鉴权/权限提示；具体上游正文只应在受信任的本地调试环境处理。此字段不影响成功降级，也不替代面向用户的 source label。复现与验收见 [数据验证](./data-validation.md#2026-09-15公开历史矩阵再测与失败诊断边界)。

固定窗口矩阵把上述身份和截断错误分别记录为 `identity-mismatch`、`truncated-response`；当前付费请求在权限/认证阶段失败，尚无真实服务样本触发这两类校验。

两类 attempts 不应混用：

- `AkshareBarsResult.attempts`：AKShare 内部 endpoint 级尝试，例如东方财富失败后新浪成功。
- `PullBarsResult.attempts`：跨 provider 尝试，例如 AKShare 空数据后 Tushare 成功。

### 3.3 `fetchLiveBars()` 优先级

此路径由 Overview 面板使用，有意避免缓存读写。

1. 调用 `pullBarsFromProviders(...)`
2. 过滤到请求的日期窗口
3. 窗口内成功返回 `window: requested`；所有尝试无数据且至少一次为 empty 时，允许无日期重取，成功标记 `window: latest-available`。
4. 全部鉴权/网络错误不再无日期重试；没有结果标记 `window: unavailable`。`LiveBarsFetchResult` 保留全部 provider attempts，UI 不将窗口回退伪装成当期报价。

最后一步是 Overview 不再因本地时钟领先于 provider 最新交易日而显示错误的"暂无数据"的原因。

Overview 在调用前保留 portfolio 的 instrument 语义：标记为 `fund` 的六位开放式基金代码会补全 `.OF`，而 `5xxxxx`、`159xxx` ETF/LOF 继续使用交易所路由。provider 没有返回至少两个有效观察值时，UI 显示 `--`，不以零值冒充最新价或涨跌幅。

## 4. Agent loop 注入路径

有两个注入层：工具注册和 prompt/context 注入。

### 4.1 工具注册

文件：

- `src/tools/data-tools.ts`
- `src/source/index.ts`
- `src/source/src/*.ts`

流程：

1. `DATA_TOOLS` 注册：
   - `fetch_bars`
   - `search_symbols`
   - `fetch_snapshot`
2. 这些工具 handler 调用 source 模块导出：
   - `fetchBars(...)` — 使用当前保存的 source；调用参数显式指定 source 时优先
   - `searchSymbols(...)`
   - `fetch_snapshot` 工具复用 `fetchBars(...)` 的最新 OHLCV；不把 Tushare `daily_basic` 作为默认路径
   - `fetch_bars` / `fetch_snapshot` 先校验代码与市场，错误返回 `INPUT_INVALID_SYMBOL` 工具结果，不调用行情 runtime
3. source orchestrator 调度到具体的 provider

### 4.2 Prompt 注入

文件：`src/agent/src/context.ts`

`BASE_SYSTEM_PROMPT` 告知模型：

- `fetch_bars` 是本地行情数据工具
- `search_symbols` 是 symbol 查找工具
- `fetch_snapshot` 是紧凑 symbol 快照工具

`buildSystemPrompt(...)` 同时注入缓存的 symbol 清单，使模型在决定是否重新获取之前看到本地已有数据。

### 4.3 运行时事件路径

主要运行时流程：

1. 用户在 TUI 中输入自然语言
2. `src/app-runtime.ts` 调用 `dispatchUserMessage(...)`
3. agent loop 在 harness facade 内运行
4. 模型选择工具调用，如 `fetch_bars`
5. `src/tools/data-tools.ts` 执行
6. `src/source/index.ts` 路由到 `sources.ts`
7. provider adapter 返回标准化的 `Bar[]`
8. 工具结果发送回 harness event stream
9. TUI 渲染工具行、结果文本和 Overview source attribution

`runtime/source-runtime.ts` 每次调用绑定 storage，并在需要首选来源或实际付费 adapter 时读取当前 settings；配置编辑后关闭面板会触发刷新。Overview 和 Agent tools 共用这一入口，凭证不靠启动时的旧快照。

### 4.4 Overview 注入

右侧 Overview 面板不来自 agent 工具文本。它直接使用 source 模块：

1. `AppRuntime.refreshOverviewPanel()`
2. `OverviewRefresh` 读取组合、管理代次/超时和状态
3. `OverviewRequestPool` 共用 8 个活跃请求并按规范化身份去重 → `fetchLiveBars(...)`
4. `buildOverviewPanelSections(...)` → TUI view，报价含实际来源、as-of 和窗口状态

这就是为什么即使 agent 本身没有显式叙述 provider，仍可以显示如 `AKShare + Tushare` 这样的数据源归属。

`AppRuntime` 启动后由独立 `OverviewRefresh` 自动拉取，每轮结束 60 秒后再次刷新。后台重复请求共享进行中任务；手动请求或组合/数据配置修改取消旧轮，合并为随后一轮读取最新输入。帮助等本地只读命令不触发行情请求。

每轮有 120 秒取消期限和递增代次。2026-09-15 起，默认 fetcher 通过 `OverviewPullMeta.onRow` 提供已返回行；首批在微任务结束时显示，后续连续更新按 16 ms 合并，结束时立即发布最终结果。刷新中显示本轮已返回/总行数，尚未返回项为 `--`。首批发布前可显示上次结果并明确标记；本轮结果出现后不混入旧值。单标的无数据仍为 `--`，已返回行数不等于可用行数，Source 的覆盖数单列。

异常/超时结束 loading：本轮已有结果则发布全部已返回行（包括等待合并显示的行），保留其来源/日期，注明未返回项；本轮尚无结果才保留旧值并标记 stale。旧请求不能覆盖新结果，不服从取消的 provider 晚到值及旧 onRow 回调均被隔离。退出取消刷新/合并 timer 和 HTTP/Python 请求。Source 的“更新”是本次面板结果发布时刻，“数据”是 provider 日期，多标的日期不一致时展示范围和可用行数。每个报价另带完整代码、来源、日期及窗口/回退标识。

`AppRuntimeCallbacks.onMarketRefresh` 提供每轮 outcome、可用行数、唯一请求 queue/fetch、整轮 pull/build/publish 耗时，以及 `firstResultMs`：从本轮开始到首次含本轮可用报价的面板回调结束，无可用报价为 null。build/publish 累计本轮渐进与最终更新的耗时；publish 是同步展示回调耗时，不代表终端 flush。诊断回调失败不影响刷新，`WHYJ_PERF` 记录聚合阶段。实际入口的历史基线和新增慢请求/部分超时记录见 [数据测量](./data-validation.md)。自定义 quote/holding fetcher 可通过 onRow 提前交付；未实现该回调时仍以完整返回数组交付，不自动从 provider 内部猜测进度。

HTTP 的 15 秒超时覆盖响应体读取；Python 单次请求默认 30 秒。`providers.signal` 将主动取消传到适配器，取消不触发新一轮降级。

## 5. 测试覆盖

数据连接诊断由 `runtime/data-readiness.ts` 编排，复用上述 adapter，首选与 fallbackOrder 都限定为所选源。与研究/Overview 的可用性回退分开：不能以 AKShare 成功证明 Tushare 凭证有效，也不能用 HTTP 200 空响应证明可用。AKShare 依赖检查复用 `runPython` 的解释器选择；结果记录样本范围、有效行数和失败类别，不写行情缓存。Doctor 默认最近 30 天，固定历史窗口的独立验收见下方记录。

独立验收：`bun run scripts/measure-data-refresh.ts` 输出合成冷/热缓存、错误/超时的分阶段 p50/p95；`bun run scripts/check-data-providers.ts` 使用当前行情配置，直接请求 A 股/指数/US/HK/基金固定历史窗口。`bun run scripts/check-data-providers.ts --public-only` 不读取保存的行情凭证，只验证五项 AKShare 公开路径；可加 `--output output/data-provider-public-new.json` 留存独立记录，已存在的显式目标不会被覆盖。两种矩阵均保留失败项，非全部通过时退出码 1，主动取消为 130；不调用模型、账户或下单接口，不用缓存证明连接可用。范围、当前结果与限制见 [数据测量与服务矩阵](./data-validation.md)。

真实 source facade 测量可运行 `bun run scripts/measure-public-source-facade.ts --samples 20 --output output/public-source-facade-latency-new.json`。它对 A 股、指数、美股和港股各执行 20 次独立冷取数，经过生产 `fetchBars`、公开 AKShare、缓存写入及不可变 DatasetRef 读取；每次成功后用同窗口 `auto` 请求核验热缓存。报告分别统计各标的与合计的冷/热耗时、失败率及最近秩 p50/p95，保留单次失败和预算耗尽记录。固定窗口为 2025-01-06–2025-01-17，默认单次预算 45 秒；显式输出文件不可覆盖。此测量不含基金净值、付费源、真实模型、账户或终端 flush，其结果与直接 provider 矩阵不能互相替代。

公开基金运行时可另运行 `bun run scripts/measure-public-fund-runtime.ts --samples 20 --output output/public-fund-runtime-latency-new.json`。它每次调用生产 `loadFundDcaData`，重新拉取 `270042.OF` 的完整净值历史，核验固定窗口及不可变 FundNavDatasetRef；不请求认购费，也没有热缓存阶段。结果须与 Bars 测量分开解释，详见 [修复后的实际基金基线](./data-validation.md#2026-09-16基金-nav-修订的提交证明与修复后实测)。

实际多标的面板可运行 `bun run scripts/measure-public-overview-runtime.ts --samples 20 --timeout-ms 60000 --output output/public-overview-runtime-latency-new.json`。独立目录中选择公开 AKShare，由真实 AppRuntime 同时请求五个默认指数与四条观察组合行（一个指数重复、实际八次请求），记录首个可用面板回调、完整刷新、请求排队/耗时和 TUI 行布局。数据窗口是运行当日向前 45 天；不读取行情缓存，也不测终端 flush。它测的是用户面板路径，不能用历史 Bars 或基金的单标的耗时替代。

模块测试现已覆盖每个配置的 source adapter：

- `src/source/tests/akshare.test.ts`
- `src/source/tests/akshare-global-bars.test.ts`
- `src/source/tests/tushare.test.ts`
- `src/source/tests/financial-datasets.test.ts`
- `src/source/tests/llmquant.test.ts`
- `src/source/tests/sources.test.ts`

覆盖意图：

- adapter payload 标准化
- AKShare 详细 bars payload、空数据与 endpoint attempts 契约
- AKShare 默认东方财富 → 新浪 → 腾讯内部链
- AKShare 空数据后 source orchestrator 降级到 Tushare
- snapshot 映射
- provider fallback order
- 实时获取空窗口回退
- source attribution 格式化
- 配置保存后 Agent tools 与 TUI 读取同一运行时配置
- Tushare 日线/搜索使用配置 token，且快照路径不依赖 `daily_basic` 权限
- Tushare 多行响应的代码身份、净值请求字段及错标响应不落盘的回退
- Financial Datasets / LLMQuant 已声明 ticker 的身份核对、显式窗口截断拒绝及实际回退归档
- HTTP 请求超时会作为可降级 provider error 交回 orchestrator

## 6. 维护规则

1. 在 `src/source/src/` 下添加新 provider。
2. 仅通过 `src/source/index.ts` 导出。
3. 当端点形态或优先级变化时更新本文档。
4. 添加一个 adapter 测试文件和至少一个编排回归测试。
5. provider 调用必须经过 `BarProviderAdapter`，不要在 runtime/Overview 内直接依赖 AKShare。
6. 添加或调整 AKShare 日线 endpoint 时，同时更新 `AkshareBarSource`、优先级归一化、嵌入式 Python 链及对应测试。
7. endpoint 失败必须保留 attempt；全部 endpoint 为空必须交回 source orchestrator，不能在 runtime 内自行切源。

---

## 7. Financial Datasets API 速记

数据层整合 open-source data 和第三方 API，包括 Yahoo Finance、SEC EDGAR 等，适合做结构化美股研究。

核心工具分组：

- 公司 / 财报 / 指标：`get_company_facts`, `get_earnings`, `get_financial_metrics`, `get_financial_metrics_snapshot`
- 三大报表 / 分部：`get_income_statement`, `get_balance_sheet`, `get_cash_flow_statement`, `get_segmented_financials`
- 持仓 / 内部人：`get_institutional_investors`, `get_institutional_holdings`, `get_insider_trades`
- 市场 / 新闻 / 利率：`get_stock_prices`, `get_stock_price`, `get_news`, `get_interest_rates`
- 披露 / KPI / 筛选：`get_filings`, `get_filing_items`, `list_filing_item_types`, `get_kpi_*`, `screen_stocks`

---

## 8. 外部数据源参考

以下为 WhyJ Quant 当前未接入，但在量化生态中常用的数据源，供未来扩展参考。

### 免费

| 名称 | 覆盖 | API 限制 |
|------|------|----------|
| AKShare | A 股/全球 | 无限制（易被反爬） |
| Yahoo Finance | 全球 | 无官方 API |
| FRED | 美国宏观 | 免费 API key |
| Wind 免费版 | A 股宏观 | 功能受限 |
| Tushare Pro | A 股 | 积分制（注册送积分） |
| JQData | A 股/期货/基金/指数/期权/因子/风险模型 | 聚宽 SDK，3 个月试用（申请即开通），覆盖前 15 月~近 3 月历史数据，日流量 100 万条 |

### 付费

| 名称 | 覆盖 | 特点 |
|------|------|------|
| JQData Pro | A 股/期货/基金/宏观 | 聚宽全量数据，年付/月付 |
| Wind 万得 | A 股/全球 | 行业标准，终端最全 |
| Choice 东方财富 | A 股/全球 | Wind 替代品 |
| Bloomberg | 全球 | 华尔街标准 |
| Quandl/Nasdaq Data Link | 全球 | 多源聚合 |
| Polygon.io | 美股 | 实时 + 历史 |
| Tushare Pro | A 股 | 积分越高数据越多 |

### JQData 试用模块清单

`pip install jqdatasdk` → 申请试用 → 3 个月有效期 · 日流量 100 万条 · 覆盖前 15 月~近 3 月

| 类别 | 数据模块 |
|------|---------|
| 沪深 A 股 | 股票列表、交易统计、融资融券、行业概念成分股、市场通(沪/深/港)、集合竞价、多频率分时 |
| 基金 | 交易标的列表、主体信息、投资组合、财务指标、分红、净值及业绩、融资融券、多频率分时 |
| A 股财务 | 单季度/年度财务、报告期财务、上市公司概况(上市信息/员工)、股东股本 |
| 指数 | 交易标的列表、多频率分时、成分股及权重 |
| 期货(商品+金融) | 所有期货信息、主力合约、连续指数、外盘日行情、龙虎榜、仓单、结算价、持仓量、合约信息、多频率分时 |
| 期权(商品+金融) | 所有期权信息、交易和持仓排名、风险指标、行权交收、合约调整、合约资料、每日盘前静态文件、日/周/月历史 |
| 特色因子 | 聚宽因子库、Alpha191、Alpha101、资金流因子 |
| 风险模型 | CNE5、CNE6、重点宽基指数风格暴露、因子分位数收益率 |

---

## 9. Python 量化库

### 数据获取

| 库 | 用途 | 市场 |
|----|------|------|
| [AKShare](https://github.com/akfamily/akshare) | 行情/财务/宏观/另类 | A 股/全球 |
| [Tushare](https://tushare.pro/) | 行情/财务/参考/指数 | A 股 |
| [yfinance](https://github.com/ranaroussi/yfinance) | Yahoo Finance 数据 | 全球 |
| [baostock](http://baostock.com/) | 证券宝 | A 股 |
| [efinance](https://github.com/Micro-sheep/efinance) | 东方财富 | A 股/基金 |
| [JQData](https://www.joinquant.com/help/api/doc?name=JQDatadoc) | 聚宽数据 SDK，行情/财务/指数/期货/基金/宏观/行业 | A 股/期货/基金 |

### 回测框架

| 库 | 特点 | 适用场景 |
|----|------|----------|
| [backtrader](https://github.com/mementum/backtrader) | 事件驱动、功能全面 | 复杂策略、多资产 |
| [vectorbt](https://github.com/polakowo/vectorbt) | 向量化、速度快 | 因子回测、参数优化 |
| [zipline-reloaded](https://github.com/stefan-jansen/zipline-reloaded) | Quantopian 继任者 | Pipeline 风格研究 |
| [vnpy](https://github.com/vnpy/vnpy) | 全栈量化平台 | A 股/期货实盘 |
| [Backtesting.py](https://github.com/kernc/backtesting.py) | 轻量交互 | 快速原型 |

### 因子分析

| 库 | 用途 |
|----|------|
| [alphalens](https://github.com/stefan-jansen/alphalens-reloaded) | 因子 IC/分层/换手分析 |
| [empyrical](https://github.com/stefan-jansen/empyrical-reloaded) | 风险/绩效指标计算 |
| [pyfolio](https://github.com/quantopian/pyfolio-reloaded) | 组合绩效 + 风险 tear sheet |

### 组合优化

| 库 | 用途 |
|----|------|
| [PyPortfolioOpt](https://github.com/robertmartin8/PyPortfolioOpt) | 均值-方差 / 风险平价 / 最大夏普 |
| [riskfolio-lib](https://github.com/dcajasn/Riskfolio-Lib) | 多层次组合优化 |
| [cvxpy](https://github.com/cvxpy/cvxpy) | 凸优化通用库 |

### 机器学习

| 库 | 用途 |
|----|------|
| [qlib](https://github.com/microsoft/qlib) | 微软量化 AI 平台 |
| [FinRL](https://github.com/AI4Finance-Foundation/FinRL) | 深度强化学习交易 |
| [FinGPT](https://github.com/AI4Finance-Foundation/FinGPT) | 金融 LLM |

---

## 10. API Reference（外部库）

### AKShare (A 股行情)

```python
import akshare as ak

# 日线
df = ak.stock_zh_a_hist(symbol="000001", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")
# 分钟线 (1/5/15/30/60)
df = ak.stock_zh_a_hist_min_em(symbol="000001", period="60", adjust="qfq")
# 指数成分
df = ak.index_stock_cons(symbol="000300")
# 行业分类
df = ak.stock_board_industry_name_em()
# 财务报表
df = ak.stock_financial_report_sina(stock="000001", symbol="资产负债表")
# 估值指标
df = ak.stock_a_lg_indicator(symbol="000001")
```

### yfinance (美股/全球)

```python
import yfinance as yf

df = yf.download("AAPL", start="2024-01-01", end="2024-12-31")
# 多股票
df = yf.download(["AAPL","MSFT","GOOG"], start="2024-01-01")
# A 股 (Shenzhen=\.SZ, Shanghai=\.SS)
df = yf.download("000001.SZ", start="2024-01-01")
```

### JQData (聚宽 SDK)

当前项目已不再内置 JQData 封装；以下内容仅作为外部参考。

```python
from jqdatasdk import auth, get_price, get_query_count, logout, get_all_securities, get_index_weights, get_valuation, get_fundamentals, query, valuation, income, balance, get_all_alpha_101, get_all_alpha_191

auth('手机号', '密码')
# 日线/分钟线
df = get_price('000001.XSHE', start_date='2024-01-01', end_date='2024-12-31', frequency='daily', fields=['open','close','high','low','volume'], fq='pre')
# 指数权重
df = get_index_weights('000300.XSHG', date='2024-12-31')
# 估值
df = get_valuation('000001.XSHE', start_date='2024-01-01', end_date='2024-12-31')
# 财务 (单季度)
q = query(valuation, income, balance).filter(valuation.code=='000001.XSHE', balance.stat_date=='2024q4', income.stat_date=='2024q4')
df = get_fundamentals(q, stat_date='2024q4')
# Alpha 因子
df = get_all_alpha_101(stocks)  # 101 Formulaic Alphas
df = get_all_alpha_191(stocks)  # GTJA 191
# 流量查询
get_query_count()  # {'total': 1000000, 'spare': 996927}
logout()
```

### Tushare

```python
import tushare as ts
ts.set_token('YOUR_TOKEN')
pro = ts.pro_api()

df = pro.daily(ts_code='000001.SZ', start_date='20240101', end_date='20241231')
df = pro.daily_basic(ts_code='000001.SZ', start_date='20240101')  # 每日指标(PE/PB)
df = pro.income(ts_code='000001.SZ', period='20241231')           # 利润表
df = pro.balancesheet(ts_code='000001.SZ', period='20241231')     # 资产负债表
df = pro.index_weight(index_code='000300.SH', start_date='20240101')
```

### Financial Datasets

```python
# Claude Code 中直接调用数据工具名，无需 import

# 公司信息
get_company_facts(ticker="AAPL")                          # → company_name, sector, CIK, exchange
# 股价
get_stock_prices(ticker="AAPL", start_date="2024-01-01", end_date="2024-12-31")
get_stock_price(ticker="AAPL")                            # 最新快照
# 财报
get_income_statement(ticker="AAPL", period="annual", limit=4)
get_balance_sheet(ticker="AAPL", period="quarterly", limit=4)
get_cash_flow_statement(ticker="AAPL", period="ttm")
# 估值
get_financial_metrics_snapshot(ticker="AAPL")             # PE/PB/PS/ROE/市值
get_financial_metrics(ticker="AAPL", period="annual", limit=4)
# 机构持仓 (13F)
get_institutional_holdings(ticker="AAPL", limit=10)
get_institutional_investors(name="Berkshire")
# 内部交易
get_insider_trades(ticker="AAPL", limit=20)
# SEC 文件
get_filings(ticker="AAPL", filing_type="10-K", limit=5)
get_filing_items(ticker="AAPL", filing_type="10-K", year=2024, item=["Item-1","Item-7"])
# 利率
get_interest_rates()
# 新闻
get_news(ticker="AAPL")
# 选股筛选
list_stock_screener_filters()
screen_stocks(filters=[{"field":"pe_ratio","operator":"lt","value":20},{"field":"sector","operator":"eq","value":"Technology"}])
```
