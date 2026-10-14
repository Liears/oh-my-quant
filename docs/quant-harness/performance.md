# 账户区间业绩与年报接入

更新：2026-09-15。F15 的账户业绩已有独立只读历史端口、输入校验与时间加权计算；可信 runtime 提供显式私有年报渲染，shell 与 [交互 TUI 面板](./annual-reports.md#交互-tui-私有导出2026-09-15) 可从用户指定的完整规范化历史文件导出私有 HTML。尚未连接真实券商/MCP、默认 `annual_report` 或 Agent；合成验证不能当作真实账户年报完成。

## 为什么不能使用现有账户快照

[执行接口](./execution.md) 的 `account()` 只有当前余额和持仓。计算区间收益还需要期初/期末权益、区间内全部出入金、费用及发生资金流时的估值；两个余额相减会把入金当盈利。研究比较归档只含假设组合，不能替代真实账户。

本轮插件目录发现 IBKR、Parqet 等候选，但本会话都未连接，目录描述也不证明完整历史权益和现金流可取得。已询问用户希望复用的服务名称或接口文档；没有安装插件、读取账号密钥或推断本地私有文件。

## 接口与数据边界

公共入口为 [src/performance/index.ts](../../src/performance/index.ts)：

`performance` 保留账户专属的计算与类型；规范化文件的读取由 [CLI 文件适配器](../../src/cli/account-history.ts) 完成，再经公共入口 `validateAccountHistory` 校验。模块消费者不得直接依赖内部文件。

```ts
import { readAccountPerformance } from "../src/performance/index.ts";
import type { AccountHistoryAdapter, AccountPerformanceRequest } from "../src/performance/index.ts";

export async function inspectAuthorizedAccount(adapter: AccountHistoryAdapter, request: AccountPerformanceRequest) {
  return readAccountPerformance(adapter, request, AbortSignal.timeout(30_000));
}
```

此片段由可信宿主调用；实际适配器负责用户账户授权和鉴权。本函数不提供认证，不接受模型声称的 authorized 字段。`adapter.id/accountRef` 必须匹配请求，返回来源、账户、币种、窗口再次核对；等待期间切换目标或调用方修改输入不会串用数据。

| 字段 | 契约 |
|---|---|
| request | accountRef、声明报告币种、startAt/endAt；时间为 UTC epoch 毫秒，区间必须递增 |
| source | adapterId、权威账单/快照 reference、observedAt；读取时拒绝未来观测时间 |
| valuations | 两个精确边界及每次外部资金流时点的权益，严格升序；equityBeforeFlow 是该时点所有外部资金流发生前的估值 |
| externalFlows | 唯一事件 ID、时间和有符号金额；正值流入、负值流出，覆盖 `(startAt, endAt]` |
| fees | 同一区间全部费用、唯一 ID、非负金额；已经扣在权益中，不再从收益扣第二次 |
| coverage / equityBasis | 外部资金流和费用均须声明 complete，权益须声明 after-fees；unknown/incomplete 不能按空账本处理 |

适配器必须先收齐同一快照的分页，并将每项数据规范为同一报告币种。跨币种换算与其出处由适配器负责；此模块不抓汇率、猜币种或拼接不同账户。证券转入/转出也需提供当时的外部流价值；账户内部交易、留在账户内的股息/利息和费用不应伪装成出入金。输入 completeness 与费用口径仍是适配器声明，校验只证明内部一致性，不认证金融事实。

## 计算方式

方法固定为 `flow-valuations-twr-v1`。令 `Vᵢ` 为第 i 个时点资金流前的权益，`Fᵢ` 为该时点全部外部净流入，则：

```text
子区间增长倍数 = Vᵢ / (Vᵢ₋₁ + Fᵢ₋₁)
时间加权收益   = 各子区间增长倍数连乘 − 1
期末权益       = 最后一次资金流前权益 + 最后时点净流入
净损益         = 期末权益 − 期初权益 − 区间净流入
```

按每次外部资金流估值、几何联接子区间收益的依据见 [GIPS Standards Handbook for Firms](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/)。本实现要求所有外部资金流都有估值，不使用大额阈值或 Dietz 近似；这项公式选择和本地测试不构成 GIPS 合规声明。

人工例子：期初 100 → 增长到 110 → 入金 100 → 期末 189。子区间分别为 +10% 和 −10%，时间加权收益为 `1.1 × 0.9 − 1 = −1%`，净损益为 `189 − 100 − 100 = −11`。单看期末较期初增加的 89 会误判收益。若账单另列已扣费用 2，只展示该费用，不能再把 −11 扣成 −13。

单位曲线从 1 开始，最大回撤仅覆盖提供的估值点；这些点可能按资金流不规则分布，因此不输出伪日波动率、Sharpe 或“最大回撤天数”。不把任意区间自动命名为年度，也不推断交易日历；接入年报时须明确账户时区和年度开闭边界。

期末权益为零可表示真实总损失或最后一次全部转出，两者由资金流区分。中间权益归零、透支或清空后重开需要分段研究，当前拒绝连算。金额和比率使用 JavaScript 有限数值，单项与总额限制在安全整数幅度内；不是精确十进制结算账本。极端溢出/单位曲线下溢拒绝输出，最终百分比可能存在浮点舍入。

## 隐私、失败与恢复

结果带 `visibility: private-live-only`、`verification: input-consistency-only`。账户引用、净损益和单位曲线都属于私有结果。账户计算模块不读写文件、settings、环境凭证、公开行情缓存或 session，不注册 Agent 工具，也不自动生成报告/分享。显式私有年报由可信 runtime 调用，HTML 仅返回内存，现有年报存储和 Agent 工具仍不接受账户值。架构检查阻止 Agent、tools、research、artifact、storage、公开行情层直接导入该模块；这是仓库依赖约束，不是对恶意插件的沙箱。

只读适配器每次调用一次，不提供提交/撤单/资金操作方法。请求需要调用方的取消/超时 signal；取消及时停止等待并消费迟到拒绝，但不能中断适配器内部同步阻塞。上游异常返回固定错误，不传播可能含凭证的原始消息。不回退到其他账户/新行情，也不把失败转换成 0 收益。暂不保存私有历史或恢复快照；后续恢复必须重新查询授权服务，并另验来源版本。

## 显式私有年报渲染（2026-09-15）

[可信入口](../../src/runtime/research/private-annual-reports.ts) 接收已授权的 `AccountHistoryAdapter`、显式账户请求和原始观察组合比较 ID；先核对比较请求、公开价格/NAV/FX 归档与计算，再从同一适配器读取完整历史权益、出入金及费用，生成包含两类口径的离线 HTML。账户区展示独立的 TWR、净损益、已扣费用、估值点回撤、币种、账户/账单引用与准确时间范围；观察组合曲线继续明确为假设，不将二者合成一个收益数字。

首版年度边界严格采用 UTC：`startAt = year-01-01T00:00:00.000Z`，`endAt = valuationCutoffT23:59:59.999Z`。请求不匹配时在读取账户前拒绝；券商本地时区若与 UTC 不同，需要另建立明确的区间转换契约，不能把当前结果直接标作券商年度账单。输入缺完整流水/费用、账户身份错配或取消时不返回 HTML，也不保存半份结果。

入口返回 `{ visibility: "private-live-only", accountMethod, verification, interval, html }`。HTML 含个人账户值，仅供授权宿主本次内存展示；另有[显式文件终端导出](./annual-reports.md#显式文件终端导出2026-09-15)写入用户选择的应用目录外新文件。默认 Agent `annual_report` 仍只生成观察组合研究年报，既有 `.ohquant/reports/annual` JSON/HTML 没有账户值，公共分享也不接这份 HTML。当前没有券商/MCP 历史连接器或交互 TUI，实际服务仍须验证历史分页、资金分类、汇率和账单版本。

合成预览：`bun run output/playwright/private-annual-preview.ts` 明确写入 [synthetic HTML](../../output/playwright/whyj-private-annual-synthetic.html)，这只属于浏览器验收脚本，不是生产账户保存路径。Chrome/Playwright 在 1440/390/320px 检查页面和账户区无整页横向溢出，账户 −1.00% TWR、−11.00 USD 净损益及 2.00 USD 已扣费用可读；控制台 0 错误，resource timing 列表为空。截图见 [桌面](../../output/playwright/whyj-private-annual-desktop.png)、[手机账户区](../../output/playwright/whyj-private-annual-account-mobile.png) 与 [320px](../../output/playwright/whyj-private-annual-320.png)。浏览器会话已关闭。

新私有入口及相邻年报/账户模块专项 **46 pass / 0 fail、232 次 expect**；测试验证原归档重算、输入不完整/年度边界拒绝、取消、HTML 转义、无账户落盘及默认 Agent 结果/保存 HTML 不含私有账户 sentinel。私有入口加入后的全量工程回归 **1598 pass / 0 fail、191 文件、21234 次 expect、153.91 秒**，日志 `%TEMP%/whyj-private-annual-full-2026-09-15.log`。这不能替代真实服务授权及账单核对。

## 测试与下一步

```powershell
bun test src/performance/test/performance.test.ts
bun run src/performance/dev/account-performance-example.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

23 项合成测试覆盖人工账本、入金/出金不产生收益、费用不重复扣除、同一时点多笔流水、期末转出、缺估值/边界/完整性、重复流水、数值异常、归零/重开、极小正净值、输入与目标快照、六类响应错配、取消和异常脱敏。示例脚本调用同一只读入口，明确输出 synthetic=true，返回 −1% 时间加权收益、−11 净损益和 −10% 观察回撤。没有真实账户、网络数据或模型调用。

本轮验证：专项 **23 pass / 0 fail，92 断言**；全量 **1503 pass / 0 fail，180 文件、19844 断言，136.04 秒**。日志为 `%TEMP%/whyj-account-performance-targeted.log` 与 `%TEMP%/whyj-account-performance-full.log`。test fence、typecheck、architecture（0 baseline violations）、build（2973 modules / 6.75 MB）、本地文档链接与 whitespace 检查通过。账户模块尚未被默认 CLI 引入，构建规模不变；构建成功不证明真实账户入口已接入。

后续仍须完成：选定并验证真实券商/MCP 历史接口；核对分页、资金流/费用分类、币种与时区；接入交互 TUI 的授权/展示流程和真实年度报告，验证原始账单数字与失败/恢复行为。当前规范化文件入口解决了显式终端导出，不替代服务连接或来源认证。
