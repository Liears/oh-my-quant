# 数据测量与真实服务矩阵

历史基线核验日期：2026-09-14（Asia/Shanghai）；新增公开源矩阵为 2026-09-15。这些结果对应当前工作区，不能视为已发布版本或全部 F08/F21 通过。合成性能与真实服务分别运行，没有调用模型、账户或下单接口。

## 复跑方式

```powershell
bun run scripts/measure-data-refresh.ts
bun run scripts/measure-overview-refresh.ts
bun run scripts/check-data-providers.ts
bun run scripts/check-data-providers.ts --public-only
bun run scripts/check-data-providers.ts --public-only --output output/data-provider-public-new.json
```

第一项默认每个条件运行 10 次，可用 `--samples 20` 调整到 1–100 次。使用临时数据目录、真实文件缓存、现有 source 编排和本地 HTTP fixture；结束后还原环境并清理临时数据，不读取用户的行情凭证。继承代理曾使回环请求返回 502，脚本现仅为自身回环服务设置 NO_PROXY，结束后还原。

第二项通过真实 AppRuntime 入口测量 live Overview，共享队列、source 编排和 view 构造均为应用实现；首选源和回退 adapter 都固定到本地 HTTP，不读取行情凭证，不调用模型，也不读写行情缓存。

不带参数的矩阵读取当前保存的行情配置，执行真实请求，可能消耗供应商的数据请求配额。`--public-only` 不调用配置读取，只按市场使用 AKShare 的公开端点；两者均为五个固定窗口样本全部通过才退出 0，有失败/空数据/窗口不足退出 1，主动取消为 130。原始错误可能含配置内容，因此只保存错误类别和 HTTP 状态，不记录 key、请求头或原异常。缺数据不会被其他市场或已有缓存的结果替代。

输出分别为 [data-refresh-baseline.json](../output/data-refresh-baseline.json)、[overview-refresh-baseline.json](../output/overview-refresh-baseline.json)、[配置源矩阵](../output/data-provider-matrix.json) 与 [公开源矩阵](../output/data-provider-public-matrix.json)；不指定 `--output` 时再次运行只更新相应默认文件。显式 `--output PATH` 使用独占创建，目标文件已经存在时拒绝覆盖，适合留存新的独立验证记录。以下表格保留各次的日期记录。脚本不在默认确定性测试中自动运行。

## 合成刷新基线

环境：Windows x64 / Bun 1.3.14 / Intel Core i7-1260P。记录时间 `2026-09-13T23:32:26.023Z`。每标的 260 行合成日线，US 路由；并发 worker 上限 8，loopback 成功/错误响应延迟设为 8 ms。热缓存先完整预热，预热不计入样本。超时 fixture 延迟 60 ms、请求取消期限 20 ms；实际响应取消受系统定时器/事件循环调度影响。

每个条件有 10 个完整批次；单请求计数为标的数 × 10。下表为批次开始到 Overview view 构造完成的毫秒数，p50/p95 使用 nearest-rank；10 次样本的 p95 等于最大值，不能据此估计稳定的长期尾延迟。

| 标的数 | 条件 | batch p50 ms | batch p95 ms | 成功 / 失败 / 超时 | 测量期 HTTP 请求 |
|---:|---|---:|---:|---|---:|
| 1 | 冷缓存 | 29.441 | 40.548 | 10 / 0 / 0 | 10 |
| 1 | 热缓存 | 1.767 | 2.382 | 10 / 0 / 0 | 0 |
| 1 | HTTP 503 | 15.490 | 24.132 | 0 / 10 / 0 | 10 |
| 1 | 超时 | 31.077 | 33.335 | 0 / 10 / 10 | 10 |
| 10 | 冷缓存 | 94.207 | 108.505 | 100 / 0 / 0 | 100 |
| 10 | 热缓存 | 14.013 | 15.301 | 100 / 0 / 0 | 0 |
| 10 | HTTP 503 | 30.947 | 34.230 | 0 / 100 / 0 | 100 |
| 10 | 超时 | 61.617 | 65.480 | 0 / 100 / 100 | 100 |
| 50 | 冷缓存 | 469.162 | 512.746 | 500 / 0 / 0 | 500 |
| 50 | 热缓存 | 70.484 | 276.003 | 500 / 0 / 0 | 0 |
| 50 | HTTP 503 | 137.576 | 604.759 | 0 / 500 / 0 | 500 |
| 50 | 超时 | 216.562 | 219.437 | 0 / 500 / 500 | 500 |

超时数是失败数的子集。冷/热缓存的请求失败率均为 0；错误与超时是主动注入，失败率为 100%，不能用作生产可用率。脚本检查错误响应确为 503、超时请求确已取消、热缓存 HTTP 次数为 0，不接受其他错误冒充预定故障。50 标的热缓存及错误条件的长尾保留，当前没有证据将其归因到某一个组件。

分阶段字段和口径：

| 字段 | 测量边界 |
|---|---|
| queue | 整批提交到该标的 worker 开始，属于脚本的 8-worker 队列 |
| transport | loopback fetch 到响应文本读完，包含服务等待、传输及事件循环排程 |
| decode | JSON.parse |
| adapterNormalize | 合成 adapter 内的规范化；source 编排后续规范化仍包含在 request 内 |
| cacheRead / cacheWrite | 对真实 storage 异步端口的调用到完成，包含 await 排程；不是纯磁盘硬件时间 |
| request | 单标的 source.fetchBars 从调用到返回/失败，包含缓存、provider 和编排 |
| viewModel | buildOverviewPanelSections |
| renderView | buildOverviewView，40×24 字符区域的 view 构造 |
| batch | 整批提交到最后一项 view 构造结束 |

并发下阶段彼此重叠，不能把每项 p95 相加当作整批时间；未执行阶段为 null。完整逐阶段 p50/p95/count 在 JSON 中。例如 50 标的冷缓存有 500 份请求样本，cacheWrite p50/p95 为 5.515/8.647 ms，view 构造为 0.159/0.285 ms；不同样本口径不能互换。

该脚本未覆盖真实供应商等待、AKShare Python 冷启动、AppRuntime 的实际排队/60 秒刷新调度、frame-buffer flush 或终端呈现。Overview 正常运行使用 live 路径，不能用此处研究工具的热缓存结果宣称其刷新达到同样速度。它提供首次可复跑的局部基线，没有前后优化对照，不宣布“刷新已提速”。

## AppRuntime Overview 基线

环境同上，记录时间 `2026-09-14T00:02:54.082Z`。实际 `AppRuntime.refreshOverviewPanel()` → `OverviewRefresh` → `OverviewRequestPool` → `source.fetchLiveBars()` → 回环 HTTP；发布回调构造 40×24 Overview view。每轮读取临时观察组合，组合有 1/10/50 行，其中 `000300.SH` 与五个市场指数重复，所以唯一请求数分别为 5/14/54；每轮最多 8 个活跃请求。

每标的 32 行日线，窗口时钟固定为 2026-09-14；成功响应延迟 8 ms。partial 条件只有 `000001.SH` 返回 HTTP 503；timeout 条件全部响应延迟 70 ms、整轮期限 20 ms。每条件 10 次，分位数口径与上表相同。

| 组合行数 | 条件 | total p50 ms | total p95 ms | 测量期 HTTP 请求 |
|---:|---|---:|---:|---:|
| 1 | success | 15.557 | 27.393 | 50 |
| 1 | partial | 14.812 | 29.339 | 50 |
| 1 | timeout | 30.121 | 33.293 | 50 |
| 10 | success | 31.079 | 42.463 | 140 |
| 10 | partial | 30.809 | 33.097 | 140 |
| 10 | timeout | 30.716 | 35.340 | 80 |
| 50 | success | 109.244 | 121.281 | 540 |
| 50 | partial | 110.856 | 120.169 | 540 |
| 50 | timeout | 31.298 | 32.241 | 80 |

每个条件的 10 轮都符合预定 outcome。部分失败条件每轮恰有一个请求失败；超时条件的排队请求全部取消，10/50 行时每轮只有前 8 项发出 HTTP，其余请求的 fetchMs 为 null。20 ms 是取消期限，实际结束受事件循环/系统计时影响，测得约 30 ms，不能写成严格 20 ms 响应保证。

50 行成功时，请求 queue p50/p95 为 43.675/92.711 ms，fetch 为 15.643/18.624 ms；每轮 build 为 0.074/0.091 ms，publish 为 0.336/0.534 ms，回调中的 renderView 为 0.124/0.191 ms。publish 包含 renderView，pull 包含队列及 source 编排，不可相加。计时回调只接收公开标的、耗时和计数，不持久化组合金额或原 provider 异常。

当前已有实际刷新入口的局部基线；周期触发、取消/恢复通过短周期行为测试。尚未测真实上游等待、Python 冷启动、完整终端 flush 或 60 秒周期长期运行，没有前后对照或全链路性能预算。之前未显式指定合成首选源的脚本结果已由本次替换，不使用旧结果证明网络隔离。

## 真实服务矩阵

固定窗口 `2025-01-06` 至 `2025-01-17`；每项最大 45 秒。当时结果的请求时间为 `2026-09-13T23:27:34Z` 至 `23:27:51Z`，对应北京时间 2026-09-14。Bars 使用当时配置的市场兼容 provider 回退，AKShare 记录实际命中的内部端点；NAV 使用 DCA 相同的公开 NAV 接口。

| 对象 | 结果 | 实际来源 / 失败 | 行数 | 耗时 ms |
|---|---|---|---:|---:|
| 000001.SZ | pass | AKShare `stock_zh_a_daily`，首选 Tushare 及东方财富路径失败后回退成功 | 10 | 4555.157 |
| 000300.SH | pass | AKShare `stock_zh_index_hist_csindex`，前置 provider/端点失败后成功 | 10 | 8742.512 |
| AAPL | unavailable | LLMQuant HTTP 401；Financial Datasets HTTP 402 | 0 | 1452.513 |
| 00700.HK | unavailable | LLMQuant HTTP 401 | 0 | 383.274 |
| 270042.OF | unavailable | `fund_open_fund_info_em` 的单位/累计净值请求均返回错误 | 0 | 1842.120 |

本轮整体 `ok: false`，退出码 1。两项 pass 表示固定窗口有有效规范化数据且包含指定首末日期；各日期及内容 SHA-256 记录在 JSON 中。它不证明窗口内所有交易日齐全、供应商身份独立验证、全市场权限、历史当时可得性或价格复权正确，也不评价今天的实时性。NAV 使用 `navDate`，与 Bars 的 `date` 分开处理。

这份 2026-09-14 记录保留当时的失败状态；[2026-09-19 同配置复测](#2026-09-19已配置来源固定窗口复测与生产门面归档)区分了新增公开回退成功与仍未取得的付费源权限。继续测完整终端输出与真实刷新预算。AppRuntime 已接入阶段观测，取消、旧代次隔离、陈旧/不可用展示已有回归。真实服务问题不阻碍其他 PRD 切片，但失败矩阵不能作为 F08 全部完成的证据。

## 工程验证

Overview 阶段：`bun run test` 为 **810 pass / 0 fail，96 文件、6416 断言**；typecheck、architecture、build 通过。该阶段新增 10 项 Overview/source/展示回归，另在 comfortable 密度验证 28/40/60 列的行高、身份和来源状态；既有周期刷新、失败恢复及退出取消测试继续通过。

三个独立脚本不属于根 tsconfig 的 src 范围，已另外执行严格类型检查：

```powershell
bun run tsc --noEmit --target ESNext --module ESNext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --strict --types bun-types scripts/check-data-providers.ts scripts/measure-data-refresh.ts scripts/measure-overview-refresh.ts
```

测试及本地性能通过不替代上面的真实服务失败记录。排行榜报告浏览器/下载证据见 [R02 第七阶段](./feature-delivery.md#r02-第七阶段排行榜结果绑定与数据测量)。

## 数据诊断复核

R03 的 `probeDataConnection` 复用实际行情 adapter，并已接入 Doctor。HTTP 200 空响应不再返回 pass；AKShare 必须实际取得行情，包可导入只是依赖证据。生产诊断不使用缓存或跨源回退，返回样本、窗口、有效行数、as-of、错误类别和有限能力范围。

2026-09-14 独立真实检查：000001.SZ、2025-01-06–2025-01-17，AKShare 返回 10 行，Python 3.14.3 / AKShare 1.18.63，4400.552 ms；[安全结果](../output/data-readiness-akshare.json) 观测时间为 `2026-09-14T00:18:22.882Z`。该单源样本通过不改变前述 US/HK/基金失败行，也不证明其他 endpoint 权限。没有调用模型、账户或下单服务。

新增共享服务和 Doctor 入口共 10 项测试后，完整回归 **820 pass / 0 fail，98 文件、6500 断言**，typecheck、architecture、build 通过。用例覆盖 401/402/403、缺依赖、空/非法响应、窗口、无回退、只读快照、超时与取消；完整配置面板交互仍待实施，见 [R03 第一阶段](./feature-delivery.md#r03-第一阶段数据诊断的可用性证据)。

## 2026-09-15：渐进刷新与慢请求隔离

此前 Overview 等待整批 Promise.all 后才构造面板，一个慢请求超时会丢弃本轮已经取得的报价。现在 [数据行适配](../src/runtime/overview-data.ts) 通过 onRow 交付独立行，[刷新生命周期](../src/runtime/overview-refresh.ts) 接收本轮进度、合并展示并保留来源。首批在微任务结束时发布，后续更新按 16 ms 合并；成功、失败或超时结束时立即发布最终已返回集合。未返回项是 --，不把前一轮值伪装成本轮值；若本轮完全没有结果，则沿用原有 stale 旧面板。取消/被替换/退出后的回调不发布，也不续排请求。

`firstResultMs` 是本轮开始至首次包含本轮有效报价的 onPanel 回调结束时间；全部缺失为 null，旧值不参与。buildMs/publishMs 改为本轮渐进加最终更新的累计耗时；发布包含 view 构造，不含真实终端 flush。数据 as-of、逐行 fetchedAt 与面板更新时间仍分开。应用默认 120 秒取消期限、8 并发和轮次结束后 60 秒再刷新未变，没有把本地样本延迟当作生产 SLA。

复跑使用临时观察组合与回环 adapter，经真实 AppRuntime、source 编排、请求池和 40×24 view 构造，不访问真实行情、账户、缓存或模型：

```powershell
bun test src/runtime/overview-data.test.ts src/runtime/overview-refresh.test.ts src/app-runtime.test.ts
bun run scripts/measure-overview-refresh.ts --output output/overview-refresh-new.json
```

新增输出参数用于保留不同运行记录；不传参数仍写原 baseline 路径。本轮两个文件独立保留：[逐行发布测量](../output/overview-refresh-progressive-2026-09-15.json)、[合并更新后测量](../output/overview-refresh-coalesced-2026-09-15.json)。后者 SHA-256 为 `d421ce8c219ab9edc9584bef583bda9bb1702bbb8f195e74824a6d1f8e600cbb`。环境为 Windows / Bun 1.3.14 / i7-1260P，每条件 10 轮；p95 采用 nearest-rank，在此等于最大值。version=2 的 renderView 统计包括 loading、渐进和最终回调，不能与历史只测最终回调的 count 直接相除。

| 组合行数 | 条件 | 首个可用 p50 / p95 ms | 整轮 p50 / p95 ms | 每轮最终可用行 |
|---:|---|---:|---:|---:|
| 1 | 单个慢请求 | 13.822 / 28.707 | 156.671 / 169.212 | 6/6 |
| 10 | 单个慢请求 | 14.358 / 28.798 | 154.142 / 169.034 | 15/15 |
| 50 | 单个慢请求 | 13.005 / 27.961 | 168.023 / 172.466 | 55/55 |
| 1 | 单个请求超时 | 15.962 / 23.887 | 264.426 / 266.509 | 5/6 |
| 10 | 单个请求超时 | 15.304 / 27.915 | 263.315 / 266.278 | 14/15 |
| 50 | 单个请求超时 | 15.176 / 25.417 | 260.525 / 268.077 | 54/55 |

市场区另有五行，其中沪深300与组合重复，因此行数比组合多五、唯一请求数多四。慢请求 fixture 延迟 150 ms，其余 8 ms；部分超时 fixture 延迟 500 ms、整轮取消期限 250 ms，其余 8 ms。实际取消完成约 260–268 ms，受系统调度影响，不声称严格 250 ms。原 success/partial/all-timeout 三类也执行，全部超时的 firstResult 为 null。15 条件共 150 轮均符合预定 outcome、去重及首个有效结果检查；详细计数和阶段分位数在 JSON 中。

测量暴露了最初逐行发布的开销：50 行成功条件的 10 轮共有 560 次面板回调；合并后为 60 次，累计 publish p95 从 16.751 ms 降至 2.802 ms。两份记录使用相同 fixture，但不是随机化交叉实验，不能据此估计真实供应商/终端或长期延迟收益。新增测试验证超时保留本轮结果、旧值不混入、晚到隔离、退出清理、进度回调异常恢复，以及失败前仍在合并队列中的结果会被发布。针对实际 AppRuntime 的专项回归为 **45 pass / 0 fail**；F05/F08/F21 尚未全部完成。

最终工程验证：**1357 pass / 0 fail，167 文件、17269 断言，87.49 秒**，日志 `%TEMP%/whyj-coalesced-overview-final.log`。根 typecheck、测量脚本独立 strict typecheck、architecture（0 baseline violations）、build（2955 modules / 6.69 MB）及 whitespace 检查通过。本轮新增五项刷新行为测试；早一版渐进实现的 1356/1356 记录保留在 `%TEMP%/whyj-progressive-overview-final.log`，最终数字以合并更新后的完整回归为准。

## 2026-09-15：整轮截止时间与迟到结果

发现并复现定时器取消的边界缺陷：预算 20 ms，首批响应继续处理时同步占用事件循环 40 ms，超时回调尚未运行，微任务会继续派发剩余队列。修复前 55 个唯一标的全部进入 fetcher；修复后仅首批 8 个进入，47 个排队项取消，整轮报告 timeout。该 fixture 验证计时器延后时的行为，不测供应商响应速度。

[OverviewBudget](../src/runtime/overview-budget.ts) 集中维护从本轮开始计算的单调时钟截止时间与取消定时器。[请求池](../src/runtime/overview-data.ts) 在提交、出队和响应完成时检查同一预算，[刷新层](../src/runtime/overview-refresh.ts) 在组合读取后、接收行、渐进发布和接收整批结果前检查。注入 poolFactory 的实现需要把收到的 signal、budget 一起传给请求池；固定 HTTP 测量也使用此路径。无效的非整数、非正数或超出定时器范围的期限在构造刷新服务时拒绝。

第二项回归发现整批迟到结果曾在检查期限前替换临时数组，超时处理因而会展示未按时接收的数据。现在先检查再替换；超时保留本轮此前接收的部分结果，未返回项为 --，下一轮可正常成功。旧轮替换、退出取消、失败、无数据、来源日期及后台周期的既有回归仍保留。

默认期限仍为 120 秒，整轮结束后 60 秒再刷新，每轮最多 8 个活跃请求。截止检查不能抢占正在执行的同步 JavaScript，也不包含终端 flush 的硬时限，不能把取消期限当作严格响应 SLA；它保证恢复到检查边界后不再派发/接收过期工作。真实上游故障、Python 冷启动、全终端延迟预算和历史当时可得性仍待验收，F08/F21 保持部分完成。

专项复跑：`bun test src/runtime/overview-refresh.test.ts src/runtime/overview-data.test.ts src/app-runtime.test.ts`，48 pass / 0 fail。新增三项覆盖延后的超时回调、部分结果与下轮恢复、非法期限；使用临时观察配置和合成响应，不访问真实行情、模型或账户。

同日回环 HTTP 复跑保存在 [overview-refresh-budget-2026-09-15.json](../output/overview-refresh-budget-2026-09-15.json)，SHA-256 `987d6ecfeac47ec8f2a74abddae368a2b812bfbf133c2f7a62adfed0ce8231c7`。1/10/50 行 × success/partial/timeout/slow/partial-timeout × 10 次，共 150 轮均符合预定结果和去重检查。10/50 行全部超时条件每轮仅发出 8 个请求；50 行部分超时保留 54/55 行。该次与全量回归并行运行，计时值保留但不用于前后性能比较或生产预算定标。

最终工程验证：Windows / Bun 1.3.14，全量 **1427 pass / 0 fail，173 文件、18479 断言，116.00 秒**；日志 `%TEMP%/whyj-overview-budget-tests.log`。根 typecheck、测量脚本独立 strict typecheck、architecture（0 baseline violations）、build（2963 modules / 6.71 MB）和 whitespace 检查通过。

## 2026-09-15：研究缓存与实际响应一致性

复现了累计历史与本次响应混用的问题：合成旧行情在 1 月 1/2/3 日的收盘价为 100/50/120，同窗口新响应仅含 1/3 日的 110/121。直接使用新响应计算一阶动量为 10%，原热缓存却补回旧的 2 日价格 50，产生 142%。这不是数值公式差异，而是同一请求进入计算的数据日期发生了变化；不能假设供应商未返回的日期仍应沿用旧值。

[日线存储](../src/storage/src/bars.ts) 在同一原子快照中保存最近成功响应的 `meta.fetchedDates`，包含规范化、请求窗口过滤后的实际日期。读取校验非空、排序唯一、日期存在及窗口边界，再从累计历史投影这些行。fresh 复用和过期后的 stale-cache 均使用同一集合；窄窗口更新不会使其他旧行重新变成最新响应。显式 `loadBars()` 仍读取累计历史，旧不可变版本和原引用保持可读。缺少新字段的历史快照不被原地改写，只能作为 stale 数据；损坏的日期集合即使重算了内容哈希也会被拒绝。

[新增九项回归](../src/storage/test/bar-response-cache.test.ts) 覆盖刷新后立即命中缓存、离线降级、窄窗口、四种可选日期边界、旧版本兼容和畸形日期集合。首项通过实际 source 编排、存储、`compute_factor` 与研究归档验证器确认 10% 的结果，并检查旧档案字节及数据引用。测试采用临时 OHQUANT_DIR、合成行情和注入 adapter；全局 fetch 哨兵禁止外部网络，不读取真实账户或调用模型。

复跑方式：

```powershell
# 本次修复及相邻存储、数据源回归
bun test src/storage/test/bar-response-cache.test.ts src/storage/test/bars.test.ts src/storage/test/snapshots.test.ts src/source/tests/sources.test.ts

# 工程完整检查，依次确认退出码为 0
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

修复前新测试 **0 pass / 9 fail**；修复后四文件专项 **47 pass / 0 fail**。补入实际因子链路断言后的全量为 **1559 pass / 0 fail，186 文件，157.33 秒**，日志 `%TEMP%/whyj-response-cache-full.log`。随后仅修正新测试的 fetch mock 和 SourceFetchOptions 类型声明，再跑新文件 **9 pass / 0 fail、78 断言**；根 typecheck、architecture（0 baseline violations）和 build（2977 modules / 6.75 MB）均通过，日志 `%TEMP%/whyj-response-cache-checks-final.log`。

该门槛验证响应与缓存一致，不证明交易日完整、供应商修订原因、复权正确、历史当时可得性或真实服务权限。日期间隔和覆盖仍需由研究工具及后续数据质量契约解释，F08/F21 继续保持部分完成。

## 2026-09-15：公开源跨市场回退与固定窗口复核

原配置源矩阵（上文 2026-09-14 表）仍保留当时的 401/402 和基金接口失败记录。本轮将 AKShare 的公开新浪日线作为 US/HK 市场兼容链的末级 provider，并修正矩阵脚本中 AKShare 诊断 adapter 将所有市场错误路由到 A 股接口的问题。配置源的订阅状态并未重新验证。

`bun run scripts/check-data-providers.ts --public-only` 不读取保存的行情配置，只调用 AKShare 公开接口、复用生产 source 编排、市场身份与日期窗口过滤。固定窗口仍是 2025-01-06–2025-01-17；[结果文件](../output/data-provider-public-matrix.json) 观测时间为 2026-09-15 05:16–05:17 UTC，整体 `ok: true`、退出码 0。

| 对象 | 实际 AKShare 端点 | 有效行数 | 首末日期 | 耗时 ms |
|---|---|---:|---|---:|
| 000001.SZ | `stock_zh_a_daily` | 10 | 01-06 / 01-17 | 4865.364 |
| 000300.SH | `stock_zh_index_hist_csindex` | 10 | 01-06 / 01-17 | 14104.246 |
| AAPL | `stock_us_daily` | 9 | 01-06 / 01-17 | 2487.6 |
| 00700.HK | `stock_hk_daily` | 10 | 01-06 / 01-17 | 1799.534 |
| 270042.OF | `fund_open_fund_info_em` 单位/累计净值 | 10 | 01-06 / 01-17 | 2721.578 |

每项记录逐日期和内容哈希，公开源只验证本次样本与边界；它不证明窗口内交易日完整、长期上游可用性、复权正确、当时可得性或已配置付费端点的权限。基金端点本轮恢复成功不能抹去上一轮失败。US/HK 接口以 `adjust=""` 返回未复权日线；本次样本当时仍将美股缺失的成交额填成 0，后续修复见 [缺失成交额与真实零值](#2026-09-15缺失成交额与真实零值)。F08/F21 仍为部分完成。

工具能力目录同步声明 US/HK 的公开价格路由与 Python 依赖；未检查时只标为 unverified，缺 Python 且无其他价格凭证时 blocked，单次价格样本不升级新闻研究。`research_news` 默认仍选择新闻端点，价格 `daily-series` 可另行检查。确定性专项 **83 pass / 0 fail**，最终完整回归 **1574 pass / 0 fail、187 文件、21085 次 expect、121.96 秒**；根类型检查、三个测量脚本独立 strict 类型检查、架构检查（0 baseline violations）及构建（2979 modules / 6.76 MB）通过。全量日志在 `%TEMP%/whyj-public-fallback-tool-readiness-final.log`。这些工程检查不替代上面的公开服务单次观察或未复跑的配置源权限矩阵。

## 2026-09-15：市场身份入口与缓存隔离

在公开跨市场回退之后补查请求入口，复现 `fetchBars("00700.HK", "US")` 会直接返回注入的美股 fresh 缓存，`pullBarsFromProviders("AAPL", "HK")` 会调用港股链里的替换 adapter。两条行为测试在修复前均失败。`normalizeSymbol(symbol, market)` 现在核对规范化后的代码所属市场；因此错误市场代码在缓存读取、provider 调用和归档写入之前报错，合法 A 股六位代码的交易所后缀补全保持原样。进一步复现 `fetch_bars` 错市场输入会把异常传入 Pi 工具链；工具现在先验证代码与市场，返回 `INPUT_INVALID_SYMBOL`，`fetch_snapshot` 也拒绝非法市场码。对应行为测试确保行情 runtime 未被调用。

复跑入口：`bun test src/source/tests/sources.test.ts src/market/symbols.test.ts src/source/tests/akshare-global-bars.test.ts src/tools/data-tools.test.ts`。修复后四文件专项 **40 pass / 0 fail**；最终 `bun run test` **1577 pass / 0 fail、187 文件、21097 次 expect、122.36 秒**，根 `bun run typecheck`、`bun run check:architecture`（0 baseline violations）与 `bun run build`（2979 modules / 6.76 MB）通过，日志 `%TEMP%/whyj-market-identity-tools-full.log`。该本地回归验证请求身份与缓存隔离，不重新验证已保存的付费数据权限、交易日完整性、复权或历史当时可得性；F08/F21/F24 仍为部分完成。

## 2026-09-15：OHLC 一致性与损坏响应隔离

数据源返回有限、正数但相互矛盾的开高低收时，原规范化路径仍接受该行，例如 `high < low` 或开/收价落在高低价区间外。新增两条行为回归先复现这个问题：公共规范化接受矛盾行，`fetchBars` 将该响应视为首选源成功并写入缓存。现在 [共同规范化入口](../src/market/bars.ts) 校验 `low <= open/close <= high`，矛盾行不形成可用响应；source 按市场兼容顺序尝试下一供应商，只保存实际成功的响应。storage 入口也复用该校验：无效新响应不更新 fresh head、抓取时间或旧不可变 DatasetRef；即使有人把损坏 head 的内容哈希重新算对，读取时仍拒绝矛盾 OHLC，原 head 文件及旧归档保持原样。

另一个回归复现了无界抓取的覆盖误判：只返回 2026-01-01–01-03 的响应，之前也能作为 2025-12-31 或 2026-01-04 请求的 fresh 缓存，source 不再查询 provider。[缓存读取](../src/storage/src/bars.ts) 现在对无界抓取进一步比对最近实际响应的首末日期；超出该范围的有界请求不声称 fresh，source 会重新查询，失败时既有响应仍可明确作为 stale-cache 降级。显式有界抓取继续按请求范围元数据判断覆盖，日期之间的交易日是否完整仍未判定。

复跑：

```powershell
bun test src/market/bars.test.ts src/source/tests/sources.test.ts src/storage/test/bars.test.ts src/storage/test/bar-response-cache.test.ts
bun run scripts/check-data-providers.ts --public-only --output output/data-provider-public-new.json
```

四文件专项 **50 pass / 0 fail**，覆盖矛盾高低价、开/收价越界、源回退、无效写入、重算哈希的损坏 head 和无界缓存的实际覆盖；两个问题均在修复前由行为回归复现。OHLC 生产修复后的第一轮全量回归 **1592 pass / 0 fail、190 文件、21195 次 expect、148.06 秒**，日志 `%TEMP%/whyj-ohlc-full-2026-09-15.log`。随后新增损坏 head 与无界覆盖测试，第二轮全量出现 **1592 pass / 2 fail**：既有报告共享测试只预存 2026-01 起的合成 Bars，却让不带窗口的工具请求过去一年；新覆盖规则拒绝这份数据，测试误入真实供应商请求并超时；同文件的归档缺失断言也失败。修正该测试 fixture 为覆盖工具默认窗口的本地 400 行合成数据，保留固定 2026-01 的人工账本用例；报告专项 **6 pass / 0 fail**。最终单独运行 `bun run test` 为 **1594 pass / 0 fail、190 文件、21207 次 expect、151.41 秒**，日志 `%TEMP%/whyj-data-integrity-full-fixed-2026-09-15.log`。根 typecheck、architecture（0 baseline violations）、build（2983 modules / 6.78 MB）及矩阵脚本独立 strict TypeScript 检查通过。

公开源再次按 2025-01-06–2025-01-17 固定窗口请求，结果保存在 [独立矩阵](../output/data-provider-public-matrix-ohlc-2026-09-15.json)，观测时间 2026-09-15 07:20:17–07:20:46 UTC，SHA-256 `46aa8d0cbd4a4b97d8a9b07ea50b683efa8b7db7fed43cba81624fdbcd163a04`。整体 `ok: true`、退出码 0，未读取保存的行情凭证。

| 对象 | 实际端点 | 有效行数 | 耗时 ms |
|---|---|---:|---:|
| 000001.SZ | `stock_zh_a_hist` | 10 | 2184.616 |
| 000300.SH | `stock_zh_index_hist_csindex` | 10 | 12984.835 |
| AAPL | `stock_us_daily` | 9 | 9108.870 |
| 00700.HK | `stock_hk_daily` | 10 | 1901.551 |
| 270042.OF | `fund_open_fund_info_em` 单位/累计净值 | 10 | 2894.195 |

沪深300的两个前置公开子端点报错后由同一 AKShare provider 的第三端点成功。这五项只证明固定窗口首末日期和当前规范化路径的样本有效，不证明交易日完整、供应商长期可用、已保存的付费数据权限、复权、修订时点或历史当时可得性。F08/F21 继续保持部分完成。

## 2026-09-15：缺失成交额与真实零值

检查公开 US/HK 日线和 HTTP 美股 adapter 时发现：供应商没有返回成交额时，旧 adapter 仍把 `amount` 填为 0；`fetch_snapshot` 随后向用户显示这个数值，容易误判为真实零成交额。[AKShare 股票接口文档](https://akshare.akfamily.xyz/data/stock/stock.html)列出的 `stock_us_daily`、`stock_hk_daily` 未复权日线示例为 OHLCV，未列成交额。实际港股端点在本次复跑返回了额外的非空 `amount` 字段，新 adapter 按供应商原值保留；字段单位尚未独立核对。旧版数据源文档已保留当时的 0 口径，并在上面固定窗口样本处标明修复前状态。

[日线规范化](../src/market/bars.ts) 现在要求日期与 OHLCV 有效，允许成交额缺字段时保存为 `null`；非空但非法、负数的成交额仍拒绝，供应商真实返回 0 时保持 0。AKShare US/HK、A 股腾讯手数映射、开放基金 NAV、Financial Datasets、LLMQuant Data 及 Tushare 缺值都沿用这个语义。[紧凑快照](../src/tools/data-tools.ts) 的文本显示 `amount  unavailable`，结构化值为 `null`；AKQuant 输入校验与 Python 调用沿用可空的归档数据，回测策略只用价格与成交量，不把缺失成交额造为零。新抓取的缓存 head 和不可变 DatasetRef 可区分 `null` 与真实零值。

行为回归先复现共同规范化、公开美股 adapter 和快照的三个失败；修复后验证缺失/真实零/非法值、US/HK 路由、HTTP adapter、Tushare 缺值、缓存与不可变归档的往返，以及 AKQuant 的数据哈希。复跑：

```powershell
bun test src/market/bars.test.ts src/source/tests/akshare-global-bars.test.ts src/source/tests/financial-datasets.test.ts src/source/tests/llmquant.test.ts src/source/tests/tushare.test.ts src/storage/test/bars.test.ts src/tools/data-tools.test.ts src/alpha/test/alpha.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

Windows / Bun 1.3.14 最终全量 **1603 pass / 0 fail，191 文件、21249 次 expect、170.53 秒**，日志 `%TEMP%/whyj-turnover-full-2026-09-15.log`；根 typecheck、三个测量/矩阵脚本的独立 strict typecheck、architecture（0 baseline violations）、build（2983 modules / 6.78 MB）与 whitespace 检查通过。公开源固定窗口 2025-01-06–2025-01-17 复跑 [五项矩阵](../output/data-provider-public-matrix-turnover-2026-09-15.json) 均通过，观测时间 2026-09-15 08:33:21–08:33:45 UTC，SHA-256 `9091f5ab711ddc9d379bb03701cbf53843745214b6c6420ad5c38c724f3171b8`。矩阵只存有效行、日期、端点和哈希；另直接调用实际 US/HK adapter 同窗口确认 AAPL 9 行的 `amount` 全为 `null`，00700.HK 10 行都有供应商返回的非空数值。该直接检查没有调用模型、账户或下单接口。

已有临时 Python 环境的真实 AKQuant 0.3.58 另通过六个合成场景；新增 `amount:null` 的输入与基线同为最终权益 1017.1402、两笔成交，输入哈希不同，见 [Alpha 实测](./alpha-backtest.md#模块调用与复跑)。

旧版 v1 不可变归档的数字 0 不带原始字段存在性证据，因此保留原字节和原哈希，不能自动判定是否误填。此阶段的离线快照仍可能看到旧 0；后续 [旧缓存口径标记](#2026-09-15旧缓存成交额口径标记)修正工具展示。联网重新抓取会形成新修订，不能把旧归档伪装为当时正确。真实供应商未来若改变字段集需重新核对成交额单位、复权和时间口径。当前变更只纠正新观测与新归档的缺值语义，不证明交易日完整、历史当时可得性或付费源权限；F08/F21 继续保持部分完成。

## 2026-09-15：旧缓存成交额口径标记

上一阶段的新抓取已保存 `amount:null`，但老缓存和不可变归档可能含有由旧 adapter 填入的 0。不能凭数值判定这 0 是真实供应商记录还是填充值，也不能重写旧归档后仍沿用原 DatasetRef 哈希。现在新 `snapshot.json` 的 `meta.turnoverSemantics` 标记 `nullable`，表示最近一次成功响应保留成交额缺值；没有标记的旧 head 按 `legacy-unknown` 传过缓存读取、source 编排和工具结果。`fetch_snapshot` 在旧缓存遇到 0 时投影为 `amount:null`，文本显示 unavailable，结构化补 `amountEvidence: legacy-unknown`；有标记的缓存或实时 provider 报告零值时仍显示 0。非零旧值保留，旧归档原字节及哈希不变。

行为用例先复现工具把旧缓存 0 显示为已报告零值，以及存储/编排没有口径标记的两个失败。修复后以真实临时目录构造带正确 SHA-256 的旧 head 和旧不可变版本；通过实际 storage → source-runtime → Pi 工具入口确认旧 0 的快照为 unavailable，新写入的真实 0 仍显示 0，两个归档版本各自可读，整个过程不请求外部 provider。复跑：

```powershell
bun test src/tools/data-tools.test.ts src/storage/test/bar-response-cache.test.ts src/storage/test/snapshots.test.ts src/source/tests/sources.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

四文件专项 **57 pass / 0 fail，258 次 expect**；完整回归 **1606 pass / 0 fail、191 文件、21268 次 expect、172.52 秒**，日志 `%TEMP%/whyj-legacy-turnover-full-2026-09-15.log`。随后加入输出背压回归的最终工程验证为 **1610 pass / 0 fail**，详情见 [终端输出记录](./terminal-workflow-audit.md#终端输出背压与整帧合并2026-09-15)。根 typecheck、architecture、build 及 whitespace 检查通过。

该展示修正只解决工具快照对旧缓存数值 0 的可解释性；直接 `loadDataset()` 仍按原始历史版本返回旧 0，并且无法推断当年真实字段存在性。用户需要新抓取获得带标记的版本；供应商权限、历史当时可得性、交易日完整性和整体终端响应预算仍属于 F08/F21 未完成范围。

## 2026-09-15：AKShare 实际端点进入响应与不可变行情引用

同一 `source: akshare` 的 A 股指数行情可能来自东财、中证或新浪。生产编排此前只保留 provider 名称；AKShare 内部回退成功后，`fetch_bars` 回执、缓存和 DatasetRef 均不能指出实际命中的函数，复核来源及复权假设时会丢失关键事实。[来源适配器](../src/source/src/source-providers.ts)现在使用 AKShare 的详细返回值，只有有效日线和安全的端点方法名同时存在时，才把 `providerEndpoint` 传给 source 结果、成功尝试记录及工具回执。替换 adapter 原有的纯 `Bar[]` 返回仍可使用；没有可核验端点时不生成此字段，URL/凭证样式的标签也不会进入归档。

[行情快照](../src/storage/src/bars.ts)将 `meta.lastResponseEndpoint` 限定为最近一次成功抓取，不把它解释为累计历史所有行的来源；本次响应的不可变 DatasetRef 则保存 `providerEndpoint`，读取归档时要求它与对应 revision 及 `fetchedDates` 的实际响应日期集合匹配。带端点但没有响应日期集合的 head 会被拒绝；即使引用内容哈希重算正确，也不能把累计历史中的旧行标成最新端点。新抓取的热缓存、过期后的离线回退、`fetch_bars` 和 `fetch_snapshot` 继续显示该端点。旧快照及旧 DatasetRef 没有该字段，仍按原版本读取，不补造历史端点。

确定性行为回归先复现 6 项失败，复核归档时又复现 1 项旧行冒充最新端点的反例；四文件专项在修复后为 **66 pass / 0 fail**，覆盖有窗口的源归一化、实际成功端点、无端点/不安全标签、窗口重试、原子修订、旧版引用、损坏 head、热缓存及离线回退。复跑方式：

```powershell
bun test src/source/tests/sources.test.ts src/storage/test/bars.test.ts src/storage/test/bar-response-cache.test.ts src/tools/data-tools.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

另从生产 `pullBarsFromProviders` 以公开 AKShare 直接请求固定窗口 `2025-01-06` 至 `2025-01-17`，每项最大等待 45 秒：`000300.SH` 返回 10 行与 `stock_zh_index_hist_csindex`，`AAPL` 返回 9 行与 `stock_us_daily`，`00700.HK` 返回 10 行与 `stock_hk_daily`；三项首末日期均与窗口一致，外层 `source` 均为 `akshare`。此前同窗口的 AKShare 详细检查显示两个东财指数接口失败后中证接口成功；外层成功尝试只代表 AKShare provider，不枚举内部每个失败端点。真实样本未读取本地行情缓存或付费凭证。固定窗口与合成归档回归不能证明长期可用、交易日完整、复权、修订当时可得性或真实供应商权限，F08/F21 继续保持部分完成。

最终 Windows / Bun 1.3.14 全量 **1625 pass / 0 fail、191 文件、21734 次 expect、129.78 秒**，日志 `%TEMP%/whyj-akshare-endpoint-final-full-2026-09-15.log`；根 typecheck、architecture（0 baseline violations）、build（2988 modules / 6.82 MB）与 whitespace 检查通过。工程回归和公开固定窗口分别提供确定性与当前服务证据，不能互相替代。

## 2026-09-15：应用观察截止与历史归档读取

以前 `fetch_bars` 展示最后一条价格的日期，但没有明确报告应用何时取得该响应。历史价格日期可能被误认为该价格在研究截止日已经可用。现在 `fetch_bars`、`fetch_snapshot`、因子、回测和风险工具分别展示 `Price date` 与 `App observed`；结构化结果携带 `latestBarDate`、`observationAt` 和 `historicalAvailability`。没有应用观察时点时明确为 `unverified`，不从价格日期推造获取时间。

需要核对“截至某 UTC 时刻本应用已观察到什么”时，调用 `fetch_bars_archive`，输入 `symbol`、`market`、`start`、`end` 和必填 `observed_before: YYYY-MM-DDTHH:mm:ss.sssZ`；普通 `fetch_bars` 也支持可选同名参数。此模式仅从应用本地不可变修订中选择抓取时间不晚于截止且单次响应覆盖所需窗口的版本。它不使用最新缓存 head、跨响应补齐日期、不发网络/Python 请求、不写新快照。无匹配版本返回 `DATA_NO_ASOF_ARCHIVE`，坏修订返回 `DATA_ASOF_ARCHIVE_UNAVAILABLE`，非法 UTC 时刻在读取前返回 `DATA_INVALID_OBSERVATION_CUTOFF`。回执的 `historicalBoundary.evidence: app-archive` 与 `observationAt` 指明证据类型。Doctor 对专门工具显示 `local`，表示无需行情源，不表示档案已经存在。

合成回归在临时目录构造先后两个价格版本和带正确哈希的模拟旧观察修订，验证截止只选旧单次响应、当前 head 不变、provider/save 未被调用、缺行不能拼接、损坏不擦除、错误码和时间标签。模拟旧时刻由 fixture 指定，不能用作真实历史发布证据。复跑：

```powershell
bun test src/storage/test/bars-asof.test.ts src/runtime/tool-readiness.test.ts src/tools/quant-tools.test.ts src/tools/data-tools.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

本次 Windows / Bun 1.3.14 验证：专项归档/能力/注册表 **13 pass / 0 fail**，任务装配/Pi 消息 **22 pass / 0 fail**；`bun run test` 围栏通过，最终全量 **1639 pass / 0 fail、193 文件、21838 次 expect**。根 typecheck、architecture（0 baseline violations）、build（2998 modules / 6.85 MB）、构建产物 `--help` 与 `git diff --check` 通过。回归只覆盖确定性合成条件；没有新增真实供应商历史时点样本。

这个边界只证明应用本地档案声称在指定时刻观察过某完整响应；本地时钟、源发布/修订时间、复权与交易日完整性还需要独立来源与真实服务验收。这份 9 月 15 日记录时，`compute_factor`、`run_backtest`、`check_risk` 尚不接受 `observed_before`；当前实现及限定范围见 [常用工具观察截止](#2026-09-16常用研究工具的显式观察截止)。F08/F21/F24 仍为部分完成。

## 2026-09-15：归档时点研究计算

`analyze_archived_bars` 将归档观察截止带入因子、SMA 回测和风险研究。用户需明确 `symbol`、`market`、`start`、`end`、`observed_before` 和 `analysis: factor | backtest | risk`；因子模式另需 `factor`。日期窗口包含全部 warmup 观察，不补借窗口外价格。比如只有本应用确实保存了符合条件的旧响应时，以下参数才会得到研究结果：

```json
{"symbol":"AAPL","market":"US","source":"financial-datasets","start":"2025-01-01","end":"2025-03-21","observed_before":"2025-03-22T00:00:00.000Z","analysis":"backtest","fast":5,"slow":20}
```

工具只绑定一次不可变旧响应，调用原有因子/回测/风险纯计算；它不请求当前 provider、读取后来缓存 head 或修改行情设置。缺归档、损坏归档、非法截止和缺少模式参数分别返回结构化错误，数据行不足仍按原计算工具的数据不足处理。文本和 details 包含价格日期、应用观察 UTC、原 DatasetRef、截止及未证明供应商发布时间/完整交易日的边界。能力目录的 `local` 只说明可离线执行，不保证归档或足够价格行存在。

研究报告和会话恢复按同一 DatasetRef 读取原始响应、检查截止与抓取时刻、重新运行原计算核对指标。报告引用净化现保留安全的实际 provider 方法名，否则带端点的合法修订会因引用缺字段而无法恢复；URL/凭证样式标签继续拒绝。任务验收需声明相同的观察截止、日期和模式；错误版本、改写观察时间/收益或不同截止均不升级为 verified。测试先复现了带端点研究“工具成功、报告无绑定”的失败，再修正引用投影并验证非法端点拒绝。临时目录的旧观察版本带正确哈希，不能代替真实供应商的历史发表记录。复跑：

```powershell
bun test src/storage/test/archived-analysis.test.ts src/runtime/tool-readiness.test.ts src/research/tasks.test.ts src/tools/research-task-tool.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

本轮 Windows / Bun 1.3.14：归档/报告/任务/Pi 定向 **43 pass / 0 fail**；端点引用修复后的报告与状态专项 **19 pass / 0 fail**。`bun run test` 围栏通过，最终全量 **1644 pass / 0 fail、194 文件、21909 次 expect**；根 typecheck、architecture（0 baseline violations）、build（3001 modules / 6.86 MB）、构建产物 `--help` 与 whitespace 检查通过。所有归档截止反例均为合成应用观察，未新增真实历史发布样本。

这份 9 月 15 日记录时，普通三工具只有自动刷新路径；当前已增加显式归档截止分支，见 [常用工具观察截止](#2026-09-16常用研究工具的显式观察截止)。应用本地时钟可信度、provider 当时发布/修订、复权与交易日完整性、真实模型是否选对工具、付费源权限及总体刷新预算尚待独立验证，F08/F21/F24 保持部分完成。

## 2026-09-15：公开历史矩阵再测与失败诊断边界

以生产 `check-data-providers.ts --public-only` 隔离复跑固定 `2025-01-06`–`2025-01-17` 窗口，时间为 `2026-09-15T13:11:17Z`–`13:11:43Z`。本轮不读取保存的行情凭证、公开缓存、模型或账户；五项结果均为 `pass`，表示规范化响应含所请求的首末日期，**不代表交易日全集或历史当时已发布**。独立 [原始矩阵](../output/data-provider-public-2026-09-15-continuation.json) SHA-256 为 `8b0b51ee08c18bd77c3b864861ee5a6129d3d8d5cd90bb584898deafe0290690`，输出目标在运行前不存在，脚本没有覆盖旧失败记录。

| 样本 | 实际 AKShare 端点 | 窗口内行数 | 单项耗时 ms |
|---|---|---:|---:|
| `000001.SZ` | `stock_zh_a_daily`，先前 `stock_zh_a_hist` 失败 | 10 | 5507.777 |
| `000300.SH` | `stock_zh_index_hist_csindex`，前两候选失败 | 10 | 12911.953 |
| `AAPL` | `stock_us_daily` | 9 | 3002.902 |
| `00700.HK` | `stock_hk_daily` | 10 | 1883.441 |
| `270042.OF` 净值 | `fund_open_fund_info_em` 单位/累计净值 | 10 | 2787.324 |

此前配置源矩阵的 401/402 与上游失败属于另一轮、另一来源/权限范围；公开 AKShare 5/5 不证明付费接口能用，9/10 行也不能单凭工作日推断缺档。源发布时间、复权、修订、交易所日历与真实 Overview 长期刷新仍未验收。

本轮还先用合成异常复现 `attempts.error` 可带出未知 URL 路径、查询参数和 header 私密值。跨 provider [失败边界](../src/source/src/source-providers.ts) 改为仅返回固定类别，不带任意原始异常文本；401/403/超时与连接失败仍能区分。[数据配置诊断](../src/runtime/data-readiness.ts) 继续识别鉴权和权限类别，用户可看到对应操作提示。两文件定向 46 项通过、0 失败，包含私密路径/查询/header、无效 token/权限类别及既有回退和取消；这不覆盖其他独立 provider 的 endpoint 级详细日志或外部凭证安全验收。

复跑：

```powershell
bun run scripts/check-data-providers.ts --public-only --output output/data-provider-public-new.json
bun test src/source/tests/sources.test.ts src/runtime/data-readiness.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

显式矩阵输出必须选择一个尚不存在的新路径。真实服务记录与确定性反例分别说明当前公开端点可用和本地错误边界；F08/F21 仍为部分完成。

最终工程验证：Windows / Bun 1.3.14，`bun run test` **1652 pass / 0 fail、195 文件、21960 次 expect、172.87 秒**；研究任务失败续问、source 和数据配置三文件专项 **52 pass / 0 fail**。根 typecheck、architecture（0 baseline violations）、build（3001 modules / 6.86 MB）、涉及文件的 whitespace 与本地路径检查通过。首次全量在旧研究矩阵的原始异常文本断言处 1651/1652；改为核验稳定错误类别、不包含原异常，并保留同参数成功关联/恢复的行为检查后复跑通过。失败记录与最终结果分别保留，不把先前失败轮次写成通过。

## 2026-09-15：普通取数的供应商链预算

普通 `fetch_bars` 和自动价格分析此前只有各家 HTTP/Python 客户端自己的超时，没有一次供应商回退链共享的上限；一个不响应 signal 的替换 adapter 可以一直阻塞首选源，使后续回退和缓存状态迟迟不返回。新增 [ProviderBudget](../src/source/src/provider-budget.ts) 按单调时钟检查同一截止，并在等待 adapter 时与取消信号竞速；[来源编排](../src/source/src/source-providers.ts) 在每家尝试前后检查同一预算。生产普通取数默认每条 provider 链 60 秒；自定义来源调用可显式设 `providers.budgetMs`，非法、非正或超出定时器范围的值在调用 adapter 前拒绝。历史归档读取不启动该预算，Overview 仍使用自己的并发整轮预算。

预算到期后，当前尝试只保留固定的 timeout 类别，后续供应商不再派发；即使定时器被同步响应解码延后，超时后的成功行也被丢弃。已有兼容旧缓存时，`fetchBars` 返回 `origin: stale-cache`、`budgetExhausted: true` 与原数据引用，不写入迟到行；没有缓存则返回 unavailable。`fetch_bars`/`fetch_snapshot` 的可见文本和结构化回执说明刷新超时，避免用户把旧价格看成刚刷新。用户原有外部取消仍抛出取消原因，不执行离线回退；实时窗口因本链预算耗尽时，不再启动新的无日期窗口请求。

合成反例覆盖快失败→第二供应商成功、无限等待 adapter 在短预算结束、同步阻塞导致定时器延后、迟到数据不保存、陈旧缓存来源、用户取消不回退、无界窗口不重试，以及工具可见的超时标签。P0 回测权益/CAGR 的现有独立账本 [15 项回归](../src/quant/backtest-correctness.test.ts) 本轮也复跑通过，确认历史缺陷当前已修复；这不能代替真实市场下的供应商及时性测量。

```powershell
bun test src/source/tests/sources.test.ts src/tools/data-tools.test.ts src/runtime/source-runtime.test.ts
bun test src/quant/backtest-correctness.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

专项取数 **54/54、174 次 expect**，P0 独立算术 **15/15、68 次 expect**；typecheck 与 architecture（0 baseline violations）通过。首次全量 **1665 pass / 1 fail、22028 次 expect、175.02 秒**，失败于旧的八独立进程组合持久化用例；该文件单独 **9/9**、随后带完整日志的全量 **1666 pass / 0 fail、196 文件、22030 次 expect、179.76 秒**，日志 `%TEMP%/whyj-provider-budget-full-final-2026-09-15.log`。未修改持久化实现，也未从单独和第二次通过推断首次失败根因。最终 typecheck、architecture（0 baseline violations）、build（3002 modules / 6.87 MB）通过。60 秒约束的是普通单标的 provider 链，不是本地缓存/保存耗时、多个标的并发 Overview、网络供应商的长期稳定速度、付费源权限，亦不证明复权和历史当时可得性；F08/F21 继续保持部分完成.

## 2026-09-15：单次取数完整请求截止

前一节只将 [ProviderBudget](../src/source/src/provider-budget.ts) 用于 provider 链；一次普通 `fetch_bars` 还可能卡在自定义缓存读取、等待存储锁的归档写入或失败后的离线缓存复查。现在 [source facade](../src/source/src/sources.ts) 在非历史请求上建立一个完整请求预算，将同一实例传入 [provider 链](../src/source/src/source-providers.ts)，并以取消竞速包住每次缓存检查与 `saveBars`。生产 [source runtime](../src/runtime/source-runtime.ts) 对普通取数、实时窗口取数和 A 股代码搜索均设 60 秒默认值；显式 `providers.budgetMs` 仍可缩短普通/实时请求。实时的有界请求及 `latest-available` 重试不再各获一次新预算。

2026-09-19 补充运行时预算合并边界：调用方构造 `providers: { budgetMs: undefined }` 时仍使用默认 60 秒，不再意外关闭计时器；显式较短值保留，合法较长值收紧到 60 秒，无效的超大计时值仍拒绝。此上限只用于 storage-backed runtime 的普通/实时请求，直接使用通用 source facade 的调用另按其传入预算执行；它也不能抢占同步文件解析或锁内提交。

普通请求在等待 provider 前只检查市场兼容缓存：auto 的有效 fresh 可立即返回，显式 source 仍请求 provider，但已检查行可用于离线降级。预算耗尽时不再启动后续 provider/保存/缓存查询，已有旧行带 `origin: stale-cache` 与 `budgetExhausted: true`，无行则 unavailable。保存阶段若超过期限而没有已提交 DatasetRef，不把本次 provider 行当可恢复数据；如果同步提交已完成并返回有效 DatasetRef，即使单调时钟发现超期也交付该已归档结果并标记 `budgetExhausted: true`。provider 全部快失败且预算尚在时仍复查缓存，以便使用其他进程期间写入的版本。实际 Tushare、LLMQuant 与 Financial Datasets adapter 现接收预算 signal，搜索也把它传给 Tushare HTTP；不响应 signal 的替换依赖只会被调用方停止等待，不能阻止它自行继续执行副作用。用户显式取消仍抛出原取消原因，不使用旧缓存代答。

确定性回归覆盖无限等待缓存、同步解码越过截止、已检查旧行、并发新缓存、保存无返回、同步有效归档提交超期、实时双窗口共用截止、本地 HTTP 搜索超时和取消；工具文本从“provider-chain”改为“source request”预算，并在快照确由旧缓存提供时才说 cached。包含归档只读与工具取消的五文件专项 **68 pass / 0 fail、313 次 expect**，修正并发新缓存选择后两文件专项 **61 pass / 0 fail、190 次 expect**；根 typecheck 与 architecture（0 baseline violations）通过。完整回归与构建见下方最终记录。

此截止约束异步等待和下一步派发；同步文件解析/锁内提交无法抢占，故不等于硬 60 秒 SLA。多标的 Overview 整轮预算仍独立。真实供应商权限、交易日全集、历史发布与复权/修订尚无新增验收，F08/F21 保持部分完成。

最终 Windows / Bun 1.3.14 工程全量 **1676 pass / 0 fail、197 文件、22066 次 expect、170.87 秒**，日志 `%TEMP%/whyj-source-whole-budget-full-2026-09-15.log`；根 typecheck、architecture（0 baseline violations）、build（3003 modules / 6.88 MB）与涉及已跟踪文件的 whitespace 检查通过。前述并发缓存版本选择和工具文案均包含在全量中。

另以生产 `check-data-providers.ts --public-only` 在 2026-09-15 14:54:36–14:55:04 UTC 隔离复跑 2025-01-06–2025-01-17 固定窗口，[新矩阵](../output/data-provider-public-whole-budget-2026-09-15.json) 5/5 为 `pass`，SHA-256 `39515889F2FADE83C6526E08FD75A82B99255BAAAE7453045518A1DD1D64903D`。`000001.SZ` 东财失败后新浪 10 行，`000300.SH` 前两个指数候选失败后中证 10 行；AAPL 新浪 9 行，`00700.HK` 新浪 10 行，`270042.OF` 东财净值 10 行。这个脚本直接走 provider pull 与每项 45 秒取消，未读公开缓存、保存的数据凭证、模型或账户；**它没有经过本轮 `fetchBars` 的缓存/保存总期限**。首末日期命中不证明中间所有交易日、复权、历史发布时间或付费源权限。

在独立临时 `OHQUANT_DIR` 的另一项实际 facade 检查中，`fetchBars(AAPL, US, 2025-01-06..2025-01-17, auto)` 限定公开 `akshare` 路由及单次 45 秒预算，首次由 `stock_us_daily` 返回 9 行，保存的 DatasetRef 修订为 `04efd6cbe37aaba4a2c500ca6b4ff872aea8bcad1466be838e9d34d216116ca7`，按该引用重新读取仍为 9 行；同窗口第二次返回 `origin: cache` 和同一修订。整个独立命令约 3.63 秒、退出 0，运行后删除临时目录。这验证了当时的公开取数→新提交协议归档→热缓存正路径，不证明预算耗尽分支、真实多标的 p95、长期上游稳定性或付费权限。

## 2026-09-15 Bars 修订提交边界

普通 source 请求的新期限会在异步等待 `saveBars` 时停止等待，但若存储已写完不可变归档、尚未写入当前 head，取消或进程崩溃留下的文件不能被当作已成功观察。原归档扫描只校验内容和抓取时间，未证明该修订已被提交为 head；因此先通过文件事件在两次写入之间取消，复现过多一份孤立历史修订，再修正取消清理，并补上能容忍真正进程退出的提交协议。

新 [Bars 存储](../src/storage/src/bars.ts) 的每次修订带 `head-or-marker-v1`：归档原子写入后提交 head，之后写入绑定整个修订哈希的 `.commit` 标记；下一次写入先为旧 head 补齐标记。历史截止与 `loadDataset()` 只承认当前有效 head 或标记校验通过的新协议归档。真实 Bun 子进程在“immutable bars revision”事件立即退出时，未标记归档留在磁盘，但旧 head 保持原版本，截止查询返回空且指向孤立版本的引用失败；正常下一次保存后原旧版本仍可读。另一子进程在“bars snapshot”事件退出时，新 head 有效而标记未写，当前缓存、归档查询及引用可读；随后正常保存补齐标记。损坏旧标记会显式报归档不可用，当前有效 head 不受影响。成功完成的修订即使后续 head 被人工破坏，也可凭标记按旧引用读取。

```powershell
bun test src/storage/test/bars-asof.test.ts src/storage/test/archived-analysis.test.ts src/storage/test/bars.test.ts src/storage/test/bar-response-cache.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

四文件定向 **34 pass / 0 fail、236 次 expect**；含既有八进程合并和实际强制 kill 的两文件专项 **15 pass / 0 fail、102 次 expect**。第一次全量 **1679 pass / 1 fail**：旧崩溃测试把 `revisions/` 全部目录项计为两份 `.json`，新协议增加旧 head 的 `.commit` 后目录为三项。失败不在恢复逻辑；将断言改为两份 `.json` 和一份对应旧 revision 的 `.commit` 后，最终 `bun run test` **1680 pass / 0 fail、197 文件、22093 次 expect、174.70 秒**，日志 `%TEMP%/whyj-source-commit-protocol-full-final-2026-09-15.log`。根 typecheck、architecture（0 baseline violations）、build（3003 modules / 6.88 MB）、已跟踪文件 `git diff --check`、新增文件行尾空白和四份文档本地链接检查通过。第一次失败日志保留在 `%TEMP%/whyj-source-commit-protocol-full-2026-09-15.log`，不把它写成通过。

故障测试验证的是本机进程死亡和原子 rename 边界，不是断电持久性。旧 v1 修订没有协议字段，此时仍按原兼容规则读取，无法回溯区分旧实现的孤立归档与已提交观察；后续修正见下节。新标记也只证明本地提交，不证明供应商在该历史时刻发布、交易日完整或复权正确。F08/F21 仍为部分完成。

## 2026-09-16：旧 Bars 修订的提交证明边界

旧版 Bars 修订没有 `archiveCommitProtocol` 字段，也没有 `.commit` 文件。旧读取规则把这类归档直接当作已提交，因此一个只写入归档、未成为 head 的孤立旧修订，能被 `fetch_bars_archive` 当成截止前观察，并可由伪造的 DatasetRef 重放。合成反例在修复前复现：未标记的旧孤立版本价格 777 进入历史结果，本应返回空。

现在 [提交判断](../src/storage/src/bars.ts) 对任何非当前有效 head 的 Bars 修订统一要求绑定该修订内容的有效 `.commit`；未标记旧孤立归档既不进入历史查询，也不能作为 DatasetRef 读取。当前有效的旧 head 仍可用于当前缓存；下一次保存先把它补入不可变归档（若尚不存在）并写提交标记，再替换 head。旧 head 原有修订哈希与其引用不变，补证后可继续复现。修复不凭价格日期或文件存在时间把更早的旧归档自动升级为观察；无法追溯证明的旧历史修订仍留在磁盘，但历史查询跳过，旧引用读取显式报 `uncommitted`。损坏的旧归档或提交标记会阻止替换 head，避免认证不一致版本。

```powershell
bun test src/storage/test/bars-asof.test.ts src/storage/test/bar-response-cache.test.ts src/storage/test/bars.test.ts src/storage/test/snapshots.test.ts src/tools/data-tools.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

五文件专项 **47 pass / 0 fail、305 次 expect**，日志 `%TEMP%/whyj-legacy-bars-commit-targeted-2026-09-16.log`；完整 `bun run test` **1689 pass / 0 fail、198 文件、22151 次 expect、184.12 秒**，日志 `%TEMP%/whyj-legacy-bars-commit-full-2026-09-16.log`。根 typecheck、architecture（0 baseline violations）、test fence、build（3003 modules / 6.88 MB）通过。合成反例证明旧孤立版本被排除、旧 head 在下一次成功保存后有可读归档和标记；它不证明断电持久性、旧系统更早修订的真实提交历史或供应商历史发布时点。F08/F21 保持部分完成。

## 2026-09-16：单次取数的来源偏好与凭证读取边界

此前普通 [取数 facade](../src/source/src/sources.ts) 在创建 60 秒预算前调用同步 `getPreferredSource`；慢设置解析可以越过期限，然后又获得完整新预算，继续命中 fresh 缓存或派发 provider。生产 [source runtime](../src/runtime/source-runtime.ts) 还在进入 facade 前读取并合并供应商凭证，即使调用者显式选择来源且只需现有缓存。修复前两条反例分别得到越期 fresh 缓存、以及 malformed `settings.json` 阻断显式来源的离线缓存；预期是报告超期并停止派发、或在不需要设置的情况下返回已有旧行。

现在普通 facade 在读取来源偏好前创建同一 [单调预算](../src/source/src/provider-budget.ts)，偏好选择后检查期限；越期时不再读取缓存或派发 provider。生产 runtime 将凭证读取注入为 `loadCredentials` 函数，不在每个取数/实时请求开始时同步解析 settings。[供应商编排](../src/source/src/source-providers.ts) 只在内置付费适配器实际派发时取一次凭证，并在同步解码后再次检查同一期限：越期不再发 HTTP；已由调用者替换的 adapter 和公开 AKShare 路由无需读取付费凭证。A 股代码搜索也在请求预算内惰性读取，非 A 股搜索不打开凭证设置。显式来源的离线缓存可在坏设置下保留 `stale-cache`、原 DatasetRef 与 provider 失败诊断，不把旧行情改称新响应。

三条独立反例在修复前失败：慢偏好仍返回 `origin: cache`，坏 settings 抛出 `ESTORAGEFORMAT`，慢付费凭证加载后仍发出一条 HTTP。修正后，真实 Tushare 客户端通过本地 `Bun.serve` 收到惰性加载的测试 token、请求路径与固定日线字段，返回 1 行；受控 fetch 证明同步越期不派发，搜索越期/非 A 股不读取凭证。两文件专项 **58 pass / 0 fail、159 次 expect**，根 typecheck 和 architecture（0 baseline violations）通过。本机继承的代理设置最初使 loopback socket connection closed、服务端 0 次命中；显式把 `NO_PROXY` 设为 `127.0.0.1,localhost` 后，同一客户端/本地服务正路径成功。该测试运行后恢复原环境值；本地假服务不证明真实付费源权限或网络稳定性。

```powershell
bun test src/source/tests/sources.test.ts src/runtime/source-runtime.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run test:fence
bun run build
```

最终完整 `bun run test` **1697 pass / 0 fail、199 文件、22203 次 expect、223.85 秒**，日志 `%TEMP%/whyj-lazy-source-settings-full-loopback-2026-09-16.log`；根 typecheck、architecture（0 baseline violations）、test fence、build（3011 modules / 6.91 MB）通过。首次完整回归在受控 fetch 正路径下也为 1697/1697，日志 `%TEMP%/whyj-lazy-source-settings-full-2026-09-16.log`；最终数字采用改为真实 loopback 正路径后的第二轮。预算仍无法抢占同步 settings 解析、文件读写或锁内提交；这次修正的是截止后的派发和不必要的凭证读取，不是硬 60 秒端到端 SLA。真实多标的 p95、付费源权限、历史发布时间及完整交易日仍待测，F08/F21 保持部分完成。

## 2026-09-16：公开源经生产 facade 的真实耗时基线

此前的合成刷新测量含受控网络与 Overview 构造，[公开服务矩阵](../output/data-provider-public-whole-budget-2026-09-15.json) 则直接拉取 provider，都不能给出实际 `fetchBars` 经缓存与归档写入后的耗时。新 [测量脚本](../scripts/measure-public-source-facade.ts) 走生产 source runtime：每次 cold 使用独立临时 `OHQUANT_DIR`、显式公开 `akshare`，同一 2025-01-06–2025-01-17 日线窗口和 45 秒请求预算；核验首末日期、实际 endpoint、DatasetRef 的归档重读，再以 `auto` 请求相同窗口核验 `origin: cache`、同一修订与行值。每个标的 20 次，顺序执行，所有单次回执与失败类别均保留在 [原始产物](../output/public-source-facade-latency-2026-09-16.json)。Windows / Bun 1.3.14，观测起止为 **2026-09-15 17:19:35–17:26:17 UTC**（上海时间 9 月 16 日 01:19–01:26）；产物 SHA-256 `79AFFA9482AF59A0F4CB4495BC7A6930D540A5A151B2A013DC649BE274F7EF0B`，内嵌的五个代码文件哈希与当前工作区匹配。

| 固定标的 | 实际 AKShare endpoint | cold 成功/失败 | cold p50 / p95 / 最大值 | hot 成功/失败 | hot p50 / p95 |
|---|---|---:|---:|---:|---:|
| `000001.SZ` A 股 | `stock_zh_a_daily` | 20 / 0 | 4525.980 / 4982.980 / 5147.480 ms | 20 / 0 | 4.010 / 8.550 ms |
| `000300.SH` 指数 | `stock_zh_index_hist_csindex` | 20 / 0 | 11046.460 / 11986.990 / 12251.860 ms | 20 / 0 | 4.580 / 10.180 ms |
| `AAPL` 美股 | `stock_us_daily` | 20 / 0 | 2638.880 / 2789.460 / 2887.930 ms | 20 / 0 | 4.570 / 6.170 ms |
| `00700.HK` 港股 | `stock_hk_daily` | 20 / 0 | 1807.330 / 2012.670 / 2037.950 ms | 20 / 0 | 4.070 / 7.030 ms |

合计 cold **80/80、失败率 0/80、p50 2887.933 ms、p95 11385.694 ms**；条件性的 hot **80/80、失败率 0/80、p50 4.569 ms、p95 7.768 ms**。p50/p95 用最近秩、仅对成功样本排序；产物还分别给出全部尝试与成功尝试的分位数。80 次 cold 均为 provider 新取数且无预算耗尽，80 次 hot 均命中 cache、版本和内容重放核验通过。整体 p95 混合不同市场，判断单市场预算应看对应标的列，尤其指数的 11.987 秒 p95。此次未改变代码的刷新算法，也没有前后同条件对照，所以这些数值是基线而非“提速”收益。

本 Bars 测量覆盖四条公开日线正路径及本地保存/读取，不包含下节单独测量的基金 NAV、收费 provider 的真实权限、Overview 多标的并发、UI 构造/终端 flush、错误/超时的上游发生频率或连续多日稳定性。固定历史窗口现在返回首末日期，不证明每个交易日完整、复权口径或当年何时已发布；45 秒异步预算也无法硬抢占同步文件操作。F08/F21 继续部分完成，后续须采集更多基金类别/费率、付费源、真实多标的面板与跨日失败分布。

## 2026-09-16：公开基金净值经生产运行时的真实耗时基线

[基金测量脚本](../scripts/measure-public-fund-runtime.ts) 使用生产 `loadFundDcaData("270042.OF", false, signal)`，每次在独立临时数据目录重新请求 `fund_open_fund_info_em`，规范化基金身份，冻结不可变 FundNavDatasetRef，并以 `loadFundNavDataset` 核对归档行值。关闭认购费请求，不读账户/模型；单次异步取消信号为 45 秒。上游接口返回完整净值历史，脚本只检查其中 2025-01-06–2025-01-17 的固定窗口首末日期，**不是服务端窗口取数，也没有 hot cache 阶段**。

Windows / Bun 1.3.14 的 [20 次原始记录](../output/public-fund-runtime-latency-2026-09-16.json) 起止于 **2026-09-15 17:33:09–17:34:07 UTC**（上海时间 9 月 16 日 01:33–01:34）。**20/20 通过、失败率 0/20、最近秩 p50 2830.735 ms、p95 3082.979 ms、最大值 3094.969 ms**；每次返回 3393 条净值，其中固定窗口 10 条，归档可按原引用重读。产物 SHA-256 `D5A315A1387C0B1DC462D12C7C7E68324EB58B295D84B90859549D9E7532D1FF`，内嵌五个相关代码文件哈希在测量时匹配工作区；下文的提交协议修正随后改变了 `fund-nav.ts`，这份旧产物不代表修正后版本。单次先行冒烟也 1/1 通过，记录于 [冒烟产物](../output/public-fund-runtime-smoke-2026-09-16.json)。

该样本与四标的 Bars 测量的 endpoint、数据量、缓存语义不同，不能比较两个 p95 来声称一种市场更快。20 次成功也无法估计跨日失败或上游变更概率；净值日期不证明当年何时已发布，未验证认购费历史、其它基金类别、付费权限、真实多标的面板或同步文件操作的硬截止。F08/F21 的公开基金正路径证据已补，整体状态仍是部分完成。

## 2026-09-16：公开源真实 AppRuntime Overview 首屏与整轮基线

[面板测量脚本](../scripts/measure-public-overview-runtime.ts) 使用生产 AppRuntime/OverviewRefresh、五个默认指数与四条观察组合行（含一条重复指数），隔离设置选择公开 AKShare，真实 `fetchLiveBars` 与默认八并发/去重池工作。`onPanel` 每次实际构造 100 列 TUI 行布局；`onMarketRefresh` 记录从启动到首次含本轮可用报价的应用回调结束 `firstResultMs`、整轮 `totalMs`、请求排队/拉取、累计 panel build/publish。运行时滚动请求最近 45 天、不读写行情缓存；面板整体期限在本次测量设为 60 秒。产物只留标的、阶段时间和状态，不留价格或账户值。

Windows / Bun 1.3.14 的 [20 轮原始记录](../output/public-overview-runtime-latency-2026-09-16.json) 起止于 **2026-09-15 17:41:45–17:46:13 UTC**（上海时间 9 月 16 日 01:41–01:46），SHA-256 `9E8AA4058C89E271A614EF02EAFF2B59B831F4F8CA71A6D274010DFA10CAE311`；产物内嵌六个生产/测量代码文件哈希均匹配当前工作区。**20/20 轮完整成功、每轮 9/9 行可用、8 次去重请求，合计 160/160 请求成功，无整体超时**。最近秩分位数：首个可用应用面板回调 **p50 3219.243 / p95 3921.546 / 最大 4006.494 ms**；整轮 **p50 13268.445 / p95 13765.209 / 最大 16869.100 ms**。20 个完整轮的 build 累计 p50/p95 为 **0.550/1.012 ms**，publish 累计为 **1.786/3.082 ms**（含实际 TUI 行布局回调）；八条请求的按标的排队 p95 约 0.03 ms 或更低。

| 实际请求 | 20 次 fetch p50 / p95 |
|---|---:|
| `000001.SH` 上证指数 | 12276.860 / 13764.140 ms |
| `000300.SH` 沪深300 | 12387.830 / 13144.750 ms |
| `000905.SH` 中证500 | 12486.580 / 13649.200 ms |
| `399001.SZ` 深证成指 | 12841.620 / 13414.920 ms |
| `399006.SZ` 创业板指 | 13003.920 / 13406.680 ms |
| `000001.SZ` A 股 | 6044.300 / 6821.850 ms |
| `AAPL` 美股 | 4034.110 / 4921.240 ms |
| `00700.HK` 港股 | 3184.870 / 3869.180 ms |

五个指数请求占整轮长尾，`000300.SH` 在默认指数和组合中共用一次请求；首屏由先返回的其它报价渐进发布，故须分别看首屏与整轮。这一环境/窗口的正路径观察没有同条件优化前对照，不宣称速度收益。`firstResultMs` 到应用回调及 TUI 行布局结束，不等于终端 flush 或物理屏幕可见；20 轮不足以推断跨日故障率、不同组合规模、收费源权限及长期开启后的周期刷新。固定历史 Bars、基金 NAV 与最近 45 天 Overview 是三套不同请求，分位数不得混作同一个 SLA。F05/F08/F21 保持部分完成。

## 2026-09-16：基金 NAV 修订的提交证明与修复后实测

旧 [基金归档](../src/storage/src/fund-nav.ts) 在不可变 `.json` 写入后直接返回引用，读取端只校验文件内容。真实 Bun 子进程在 `immutable public NAV revision` 文件事件后立即退出，`archiveFundNav` 从未返回，但父进程从遗留文件构造的引用仍被读取；修复前故障反例 **0 pass / 1 fail**，实际错误地接受未交付的净值观察。现在同一写锁内先原子保存修订，再原子保存绑定整份修订哈希的 `.commit` 标记，标记完成才返回。`loadFundNavDataset()` 对无标记/损坏标记显式失败；取消落在两次写入间会清理孤立文件，进程死亡留下的无标记文件虽可见却不可重放；标记写完后的进程死亡仍可按同一引用重读。八个独立写进程仍只提交一份版本；同时间戳已存在但无有效标记的文件不被悄悄补证。

旧系统保存的 NAV 修订没有标记，且没有 Bars 那样可证明曾提交的当前 head。旧无标记引用现在报告 `uncommitted`；这会使依赖它的历史研究/报告明确显示证据不可用，而不是从今天的净值重新拼接旧研究。原文件保留供人工核对；若需要新研究引用，应重新拉取公开净值并生成新的已标记修订。此规则证明本地提交，不证明基金在历史日期何时公布净值；测试针对进程死亡，不证明所有文件系统断电持久性。

基金归档、DCA、年报及两类报告五文件专项最终 **50 pass / 0 fail、409 次 expect**；中途两项旧测试仍把归档目录当作只有 `.json`，在新协议产生 `.commit` 后失败，改为分别核对一份修订和一份标记，最终结果包含该修正。完整 `bun run test` **1701 pass / 0 fail、199 文件、22218 次 expect、223.54 秒**，日志 `%TEMP%/whyj-fund-nav-commit-full-2026-09-16.log`；根 typecheck、architecture（0 baseline violations）、test fence、build（3011 modules / 6.91 MB）通过。

修复后另用相同 [公开基金测量脚本](../scripts/measure-public-fund-runtime.ts) 采集 [20 次实际运行](../output/public-fund-runtime-latency-commit-2026-09-16.json)：**20/20 新拉取及有标记归档重读通过，失败率 0/20、p50 2864.315 ms、p95 3260.269 ms、最大 3541.846 ms**；每次 3393 条净值，固定窗口 10 条。观测为 **2026-09-15 18:01:34–18:02:33 UTC**（上海时间 9 月 16 日 02:01–02:02），产物 SHA-256 `E256A6713CE68FC71C6B51E749CC317C4343ECCF412824667FEF4F9E63ACC63C`，内嵌五个代码文件哈希与当前工作区一致。上节旧基线与本次是不同时间的公开服务运行，不能从两个 p95 的差推断标记协议的性能代价；公开源跨日稳定性、费率历史、付费权限及整端同步写入硬期限仍待验收。F08/F21 保持部分完成。

## 2026-09-16：常用研究工具的显式观察截止

[因子、回测和风险工具](../src/tools/quant-tools.ts)默认仍经自动刷新准备价格；显式给出 `observed_before` 后，要求 `market`、`start`、`end`，可选 `source`，转为只读本应用截至精确 UTC 时刻保存的一个完整不可变响应。`source` 是首选归档来源，若按既有回退顺序选到其它来源，回执的 `dataset.source` 是实际来源。没有旧响应返回 `DATA_NO_ASOF_ARCHIVE`，归档损坏或结果不匹配返回 `DATA_ASOF_ARCHIVE_UNAVAILABLE`，非法时刻与缺日期/市场在读取前失败；数据行不足仍按各计算工具的原门槛处理。宿主替换当前价格端口却未提供独立归档端口时，返回配置类 `DATA_ARCHIVE_PORT_UNAVAILABLE`，提示注入 `archiveAnalysisData`；配置当前行情 API key 不能回答历史任务。

```json
{"symbol":"AAPL","market":"US","source":"financial-datasets","start":"2025-01-01","end":"2025-03-21","observed_before":"2025-03-22T00:00:00.000Z","fast":5,"slow":20}
```

复跑实现、归档和任务回归：

```powershell
bun test src/storage/test/archived-analysis.test.ts src/tools/quant-tools.test.ts src/research/tasks.test.ts src/research/state.test.ts src/runtime/tool-readiness.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

[共享分析数据端口](../src/runtime/analysis-data.ts)在归档分支不把当前 head 的价格作为计算输入，不准备供应商凭证、不调用 provider 或写新修订；[报告重审](../src/research/observation-boundary.ts)要求原调用的市场、日期、截止与 DatasetRef 的抓取时刻、来源和修订相符，并独立重算指标。[研究任务](../src/research/tasks.ts)须声明相同截止，未声明截止的普通任务不会由历史模式结果悄悄满足。[同一旧响应的三工具回归](../src/storage/test/archived-analysis.test.ts)用正确哈希的模拟旧应用观察与后来改写价格，验证不触发网络、未读坏配置、报告/恢复重审和失败关闭。模拟旧抓取时刻不证明供应商当时发布、交易日完整、复权或本地钟准确；F08/F21/F24 继续保持部分完成。

最终全量 `bun run test` **1744 pass / 0 fail、209 文件、22814 次断言、268.10 秒**，日志 `%TEMP%/ohq-ordinary-asof-final-2026-09-16.log`；缺归档端口错误与历史工具专项 11/11。根 typecheck、architecture（0 baseline violations）、test fence、build（3026 modules / 6.97 MB）及 `git diff --check` 通过。

## 2026-09-18：A/US/HK 股票请求的供应商与归档耗时

为补 F08 的真实耗时分布，在显式 AkShare、固定 2026-09-01 至 09-17 窗口下，各对 `000001.SZ`、`AAPL`、`00700.HK` 连续请求五次。最初的 [Source 门面采样](../output/provider-latency-akshare-2026-09-18.json)三市场各 5/5 返回供应商数据，但默认依赖的 `saveBars` 是空操作，DatasetRef 全为 null；这只证明供应商层响应，**不能**作为应用归档耗时。随后改走 [storage-backed runtime](../src/runtime/source-runtime.ts) 的 `fetchBars`，每次取回 DatasetRef 后立即 `loadDataset`，要求精确行序和数值相等。[运行时原始样本](../output/provider-latency-akshare-runtime-2026-09-18.json)为 **15/15 provider-origin、15/15 归档重读匹配**，无陈旧缓存替代或预算超时；文件 SHA-256 为 `DF07EA69309508437C65550AA3B7E47F821BDE76D86F57AD769351D4C600D3DE`：

| 市场 / 样本 | 实际端点 | 每次窗口行数 | p50 ms | p95 ms |
|---|---|---:|---:|---:|
| A / 000001.SZ | `stock_zh_a_daily` | 13 | 5856 | 6945 |
| US / AAPL | `stock_us_daily` | 12 | 2834 | 3039 |
| HK / 00700.HK | `stock_hk_daily` | 13 | 2035 | 4977 |

[复跑脚本](../scripts/measure-provider-latency.ts)明确调用该 runtime 端口，在独立 TEMP 根目录运行、保留归档以便复核、要求新输出文件，并逐次保存端点、来源、实际行数、不可变修订/内容哈希及归档重读结果。一次三市场各一条的[脚本冒烟结果](../output/provider-latency-script-smoke-2026-09-18.json)也全部重读匹配；已有输出路径在网络请求前失败。复跑时提供尚不存在的输出文件：

```powershell
bun run scripts/measure-provider-latency.ts --start 2026-09-01 --end 2026-09-17 --samples 5 --output output/provider-latency-new.json
bun run tsc --noEmit --target ESNext --module ESNext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --strict --types bun-types scripts/measure-provider-latency.ts
```

五次样本的 p95 即最大值，不能当作长期服务分布；同一进程和 TEMP 根目录使后续请求为温态，显式来源虽绕过新鲜缓存直接请求供应商，仍会检查兼容缓存。窗口只有各市场一只股票，缺付费端点权限、更多日期/证券、真实异常分布、整轮研究模型耗时与同步文件操作硬时限；F08/F21 保持部分完成。

脚本严格类型检查、三市场各一次的实际冒烟和已有输出的联网前拒绝通过。最终 `bun run test` **1771/1771、214 文件、22899 次断言、283.54 秒**，日志 `%TEMP%/whyj-f08-latency-full.log`；根 typecheck、architecture（0 baseline violations）、build、三份改动文档的 272 个本地链接及 `git diff --check` 通过。此工程回归与上表公开网络采样分别提供代码和供应商证据，不相互替代。

## 2026-09-19：已配置来源固定窗口复测与生产门面归档

同一 2025-01-06–2025-01-17 历史窗口，重新运行[配置源矩阵脚本](../scripts/check-data-providers.ts)。[原始矩阵](../output/data-provider-matrix-categorized-2026-09-19.json)于北京时间 2026-09-19 凌晨完成，五项均含指定首末日期、`ok: true`，SHA-256 为 `010CEC9277AA27C3F11625837C05A9F60BE614F2557387F8DF17220BABCA1B32`。A 股、指数、US、HK、基金 NAV 分别得到 10、10、9、10、10 行，最终均来自公开 AKShare。付费尝试没有成功：A 股和指数的 Tushare 为 `permission-denied`，US 的 LLMQuant 为 HTTP 401、Financial Datasets 为 HTTP 402，HK 的 LLMQuant 为 HTTP 401。脚本现把 Tushare 权限错误归为安全类别，不保存原始供应商异常。五项成功是**兼容回退可用**，不能写成付费源权限已开通；2026-09-14 的失败记录反映当时尚无 US/HK 公开回退及基金端点失败，仍作为历史证据保留。

另以扩展后的[生产门面测量脚本](../scripts/measure-provider-latency.ts)运行 `--configured`：先读取当前来源偏好和凭证，再切到独立临时数据目录，调用实际 `runtime/source-runtime.fetchBars`，保存并按 DatasetRef 重读；随后同窗口 `auto` 请求核对同一修订、逐行值及 `origin: cache`。[六次原始回执](../output/configured-provider-facade-2026-09-19.json) SHA-256 为 `67C1A7F5BBA8130945A001DEF2F60072E6442021819D7FDE97982A483ADA3AC4`，只保留来源、成功/失败状态、受限端点名、行数、耗时和归档摘要，不输出凭证或原始错误：

| 标的 | 配置源尝试 → 最终端点 | 两次冷请求 ms | 两次热缓存 ms | 归档 / 缓存核对 |
|---|---|---:|---:|---:|
| A `000001.SZ` | Tushare 失败 → `stock_zh_a_daily` | 5859、4579 | 2、1 | 2/2、2/2 |
| US `AAPL` | LLMQuant / Financial Datasets 失败 → `stock_us_daily` | 4875、3328 | 2、1 | 2/2、2/2 |
| HK `00700.HK` | LLMQuant 失败 → `stock_hk_daily` | 2342、2133 | 1、1 | 2/2、2/2 |

六次冷请求均为 provider 新取数、归档重读匹配、无预算耗尽；六次热请求均命中本次新建缓存。此脚本的显式来源每次仍触发供应商，热请求单独使用 `auto`；两次样本不支持长期 p95 或失败率估计。基金 NAV 只在上面的直接矩阵复测，不属于本次 Bars 门面六样本。公开回退和本地修订复用已验证，但付费服务权限、历史发布时点、完整交易日、复权/修订规则、跨日稳定性、真实多标的付费面板以及同步文件操作的硬时限均未通过；F08/F21 保持部分完成。

```powershell
bun run scripts/check-data-providers.ts --output output/data-provider-matrix-new.json
bun run scripts/measure-provider-latency.ts --start 2025-01-06 --end 2025-01-17 --samples 2 --configured --output output/configured-provider-facade-new.json
bun run tsc --noEmit --strict --module ESNext --moduleResolution bundler --target ESNext --allowImportingTsExtensions --types bun-types --skipLibCheck scripts/check-data-providers.ts scripts/measure-provider-latency.ts
```

两脚本要求新输出路径；已存在的测量文件会在联网前拒绝。首个脚本访问配置源，第二个脚本还在临时数据根中保存归档。两者不请求模型、账户或订单。此阶段完整 `bun run test` **1811/1811、222 文件、23185 次断言**，日志 `%TEMP%/ohq-configured-provider-full-2026-09-19.log`；根 typecheck、两脚本独立 strict typecheck、architecture（0 baseline violations）和 build（3043 modules）均通过。工程回归与上述真实服务样本各自证明不同边界。

## 2026-10-09：普通取数的异步本地 I/O 与取消边界

此前完整请求预算能停止等待 Promise，却无法在生产 Bars 存储内部的 `readFileSync`、`readdirSync`、同步锁获取或原子写入占住事件循环时触发计时器；来源偏好和付费凭证也通过同步 `loadSettings()` 读取。现在 [storage-backed source runtime](../src/runtime/source-runtime.ts)使用只读异步设置快照，`SourceRuntimeDeps` 的 preference/cache/archive 与 provider credential 端口接收同一 AbortSignal。[Bars 存储](../src/storage/src/bars.ts)将普通取数使用的快照、revision 目录、commit marker、跨进程锁、临时文件写入、fsync、rename 与失败清理改为异步操作；已固定 DatasetRef 的 `loadDataset()` 继续同步读取本地不可变 revision，不属于 provider 刷新期限。

取消边界在每次异步读取、锁后、写入和 rename 前复查。预算到期时 facade 可停止等待；未开始的保存不会创建 data 目录，写到临时文件但尚未 rename 的提交会清理临时文件。已经派发给操作系统的单次 fsync/rename，以及第三方替换端口中的同步 JavaScript，不能被 JavaScript 计时器强制中断；后者保留反例，返回后仍按单调时钟判定超期，不再派发后续工作。

专项 **104/104、499 次断言**覆盖 async settings/credentials、signal 透传、cache/archive/commit 预取消、并发 revision 合并、旧协议认证、损坏文件、Windows 异步锁的瞬时/持续/取消/错误 syscall 及完整来源预算；全 source 模块 **185/185、517 次断言**通过。最终全量 `bun run test` **1877/1877、224 个文件、23773 次断言、383.72 秒**；typecheck、architecture（0 baseline violations）、test fence 及 **3052 modules、7.1 MB** 的生产构建均通过。该切片关闭 PRD 中生产普通取数的同步文件 I/O 缺口，不证明真实付费权限、长期供应商延迟、历史发布时点、交易日完整或复权规则，F08/F21 继续部分完成。

## 2026-10-11：Pi 升级期间的公开源固定窗口复核

在 Bun 1.3.14 / Node 25.8.1 下执行 `bun run scripts/check-data-providers.ts --public-only --output output/data-provider-public-matrix-2026-10-11.json`。[原始结果](../output/data-provider-public-matrix-2026-10-11.json)的五项均为 pass，窗口为 2025-01-06–2025-01-17；SHA-256 为 `17A59FE864C07C51E8F5B9A969BEDBAC1D8E3EF3CEBDEA0C89D9AACEAFE952E1`。脚本不加载已保存的数据凭证，不写行情缓存，不调用模型或账户/订单接口。

| 标的 | 最终端点 | 窗口行数 | 单次耗时 ms |
|---|---|---:|---:|
| 000001.SZ | stock_zh_a_hist | 10 | 4720 |
| 000300.SH | stock_zh_index_hist_csindex | 10 | 25904 |
| AAPL | stock_us_daily | 9 | 13345 |
| 00700.HK | stock_hk_daily | 10 | 8220 |
| 270042.OF | fund_open_fund_info_em | 10 | 7813 |

指数请求先经历 `index_zh_a_hist`、`stock_zh_index_daily_em` 两次失败，再由中证端点返回数据；不能把最终成功写成每个端点都可用。pass 只要求非空结果及首末日期覆盖，本次没有独立核对完整交易日历、当时可得性、复权或跨供应商数值。上述单次耗时不代表长期延迟分位数。F08/F21 保持部分完成。

## 2026-10-11：复权口径与跨响应缓存隔离

此前 AKShare 的普通 A 股三端点实际请求 `qfq`，US/HK 请求 `adjust=""`，但所有 Bars 引用统一写成 `provider-unspecified`；Alpha 的严格输入也只接受未知口径、漏接实际 endpoint。新 [OHLC 契约](./source-data-providers.md#ohlc-复权口径2026-10-11)将实际请求口径贯通 Source → storage-backed runtime → 不可变 DatasetRef → 工具/Alpha 输入 → 研究报告。未知供应商或数组型替换 adapter 不根据名称补标签，旧归档保留未知口径。

前复权基准改变时，同一历史价可能从 110 重算到 55。旧序列 `[100,110]` 与新响应 `[55,60]` 直接拼接会得到 `[100,55,60]`，制造一次 45% 的跌幅。因此新前复权 head 只包含本次响应，即使端点/标签相同也不拼接；任意口径切换同样重建 head。旧不可变版本继续回读原值，不重新贴标签。[回归用例](../src/storage/test/price-adjustment.test.ts)验证这一反例、旧版本读取、口径切换、缓存/离线回退/观察截止、非法 adapter 标签、报告重算和篡改标签拒绝。

因子、回测、风险、评分与组合报告分别披露每份 Bars 的口径；新闻价格证据也使用实际口径。`adjClose` 不替代 `close`，其存在不能把未核验 OHLC 认定为总回报。Alpha 输入哈希包含口径及合法端点，修改口径会改变输入哈希；其结构验证不代替 storage 的归档匹配检查。

本地专项可这样复跑：

```powershell
bun test src/storage/test/price-adjustment.test.ts src/source/tests/akshare-global-bars.test.ts src/source/tests/tushare.test.ts
bun test src/alpha/test src/runtime/news-research.test.ts src/artifact/test/report-dashboard.test.ts src/artifact/test/report-comparison.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

真实公开源可用 [门面测量脚本](../scripts/measure-public-source-facade.ts)验证五个固定标的的本次口径、归档重读和同版本热缓存；要求全新的输出路径，数据根位于临时目录，不使用用户缓存或保存的付费凭证。增加 `.OF` 是通用 Bars 的 NAV/OHLC 映射，不等于独立基金 NAV/费率路径验收。

```powershell
bun run scripts/measure-public-source-facade.ts --samples 1 --budget-ms 60000 --output output/public-source-price-basis-new.json
```

本轮 [首次真实测量](../output/public-source-price-basis-2026-10-11.json)五次冷请求均未取得可验收响应，未运行热缓存检查：A 股/指数各约 30 秒后 Python 请求超时，US/HK 返回供应商失败，基金为空。不能沿用上节五项成功样本宣称本次生产门面通过；这组失败保留为真实服务证据，不是合成回归失败。请求标签、缓存隔离与篡改拒绝的本地证明也不代表公司行为独立校准、分红总回报、完整交易日历、供应商当时发布或跨日稳定性。F08/F21 保持部分完成。

最终本地全量 `bun run test` **1893 pass / 0 fail、225 文件、25131 次断言、235.53 秒**，日志 `%TEMP%/whyj-price-adjustment-full-2026-10-11.log`；根 typecheck、architecture（0 baseline violations）、test fence、生产 build（2673 modules / 7.50 MB）和默认 Git 配置下 `git diff --check` 通过。门面测量脚本独立 strict typecheck 通过，四份相关文档的 330 个本地文件链接无缺失。上面的失败产物 SHA-256 为 `C89F8E7FA832508530BA08803A4FFEE36228A87F19748E526D60E2E284BCAB7E`，保留原始五次样本及生产代码哈希。Bun 1.3.14 / Node 25.8.1；Pi 1.1.0。
