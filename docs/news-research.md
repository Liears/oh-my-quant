# 新闻研究与验证

更新：2026-09-18。F11 已接通新闻搜索、港股 ticker 新闻回退、公开页面正文提取、标题初筛、窗口因子及逐新闻价格窗口；正文语义的真实模型验收、情绪校准及更广市场覆盖仍未完成。

## 使用

启动 `bun run src/index.ts`，配置模型和行情后直接输入：

```text
研究 000001.SZ 在 2026-09-01 至 2026-09-14 的新闻，市场 A。
调用 research_news，结合 5 日动量和日波动率，保留新闻链接、发布时间和不确定性，给出条件化的观察组合调整建议。
```

默认工具 `research_news` 要求 symbol、market、start、end；可选 provider 为 auto/yahoo/eastmoney，momentum_period 默认为 5，需要窗口内至少 6 个日收盘价。`read_articles` 默认 3，范围 0–5，0 跳过正文读取；正文额度先给标题明确包含目标代码的候选，再给标题包含精确代码报价所称公司名的候选，最后按发布时间读取，失败项仍占读取名额。候选新闻列表本身保持最新在前；标题线索只决定读取优先级，不证明文章主体。日期包含首尾日，A/HK 使用当地时区、US 使用 America/New_York（含夏令时）。不接受结束日在所选市场的未来；同日新闻与收盘的先后未能确认时，不推断价格反应。

A 股 auto 同时查询 AKShare 东方财富和 Yahoo，保留每次成功、空结果与错误；US/HK 使用 Yahoo。显式 provider 只查询所选新闻源，价格仍由已有行情配置和市场回退链取得。Yahoo 无需本地 key；东方财富需要 WhyJ 当前 Python 环境中的 AKShare。A 股指数和 `.OF` 基金不映射为同代码股票；BJ 股票没有 Yahoo 映射。港股 `00700.HK` 查询 Yahoo `0700.HK`，上海 `.SH` 查询 `.SS`，美股 `BRK.B` 查询 `BRK-B`，研究身份仍保留原代码。

Yahoo 先调用 `news-search`；没有合格结果或请求失败时，再调用按 ticker 查询的 `ticker-news`。搜索已有合格项则不请求后者；原搜索的错误/空结果仍保留。

`/config → Market Data → Tool capabilities` 搜索 `research_news`，可分别检查 Yahoo `news-search`、Yahoo `ticker-news`、AKShare `stock_news_em` 或日线端点。新闻端点参数为 symbol/start/end；诊断固定到所选端点，不回退、不读正文、不取价格或写缓存。工具完整研究需要新闻和价格两类依赖；单次端点通过不代表完整研究就绪。

## 输出与边界

每条新闻保留标题、原始返回链接、媒体名、供应商/端点、供应商 ID（若有）、UTC 发布时间、市场当地日期与去重 ID。Yahoo 搜索必须有精确关联 ticker，标作 provider-tag；ticker 新闻流标作 ticker-feed，不伪造精确标签；东方财富关键词结果标作 search-match。三者都需核对是否讨论目标公司，新闻流的行业文章未必只讨论该股。供应商返回的聚合/转载链接不冒充已查证的最初报道。

`provider-tag`、`ticker-feed` 和 `search-match` 只记录候选文章进入结果的路由条件；没有校准后的高低等级或相互排名。一个标签或搜索命中本身不证明正文谈的是目标公司，也不能把“未发现关联依据”改写成“已经证明无关联”。同一文章跨来源去重时 `relevance` 只选一条代表路由，`origins` 保留全部来源；不能用单标签反推出综合可信度。

去重要求标题相同，并且去除追踪参数后的 URL 一致或发表于同日。相同链接的新标题保留为独立观点；相同标题的较晚发布时间更新主记录，每个来源仍保留自己的发布时间。原链接不改写，转载来源合并保留，不将重复报道算作独立证据。最多保留最新 30 条唯一结果，额外条数用 omittedArticles 明示；无来源/时间、非法链接、无关联 ticker、窗口外和未来新闻都有排除计数。contentHash 是本次观察的内容指纹，不是媒体真实性签名。

这些端点提供近期结果：日期条件只是本地筛选，不能据此声称完整历史新闻覆盖。observedAt 固定为请求开始时的观察截止时间；不会用随后出现的未来发布时间补进该快照。不建立独立新闻缓存或在失败时替换成旧新闻；成功工具结果按原有流程进入会话 JSONL。

正文由 `readability-0.6.0` 与不执行脚本的 linkedom DOM 提取，仅支持 `finance.yahoo.com` 和 `finance.eastmoney.com` 的公共 HTML；不携带认证、不请求子资源、不跟随到登录或其他域名。每页限制 15 秒、2 MiB、3 次重定向，最多保留 40 段/12,000 字符，超限截断明示。站点显式 paywall、HTTP 401/403、无正文或标题不一致分别返回状态；东方财富仅去除已观察到的站点后缀作匹配，仍保存原页面标题。限制不等于能识别所有付费墙或保证抽取完整。

`documents` 保留 articleId、requestedUrl/finalUrl、fetchedAt、页面标题/作者/发布时间（缺失为 null）、正文段落 p1…、内容指纹与读取状态。正文是抓取时的页面，不是所选历史日期的快照；页面发布时间与搜索发布时间分开记录，不推断两者相同。`reading` 给出可用篇数和未读取篇数。模型应将媒体陈述、模型解释和标题算法分开；网页内容不能成为工具指令。提取成功不证明公司关联、内容真实性或金融结论。

`citations` 提供可复制的短键，如 `N-<新闻快照指纹前16位>-1`，映射到完整 articleId/contentHash、原始 URL、状态和段落编号。回答使用 `[citationId/p1]`，受限正文使用 `[citationId/restricted]`；不要求模型反复抄写两段 64 位哈希，也不接受自行缩写。引用只能在对应完整新闻快照及其映射表中解析，短键不代表独立真实性证明，不能混用不同研究的映射。该映射随原会话分支恢复。

工具文本还逐篇列出 `Citation tokens  [citationId/p1] ...`，供模型直接复制；受限页面列出 `[citationId/restricted]`，没有可引用段落的页面明确显示 `none`。自动评测要求每篇对应的方括号引用，裸写段落键仍会失败；语法正确也不能证明正文支持相邻的解释。

`headline-phrases-v1` 仅初筛标题中明确的业绩/评级短语，返回 positive/negative/mixed/unknown、命中短语和不确定性说明。逐条候选标题及其命中仍保留；目标股票的汇总 tone/counts 只纳入标题有目标代码或供应商所称公司名线索的候选，并显示纳入数量。没有线索时目标 tone 为 unknown，其他公司的方向性标题不会进入目标情绪或调整证据，但会提示人工核对主体。含否认、推测或问句的标题保留 unknown；unknown 不代表中性。置信度为 low，没有标注校准集，probabilityInterval 为 null，不生成看似精确的情绪概率或综合分数。标题线索与供应商简称都不是公司身份、正文主张或投资方向的独立核验。

价格工具按同一股票和窗口取数，再核对 DatasetRef 指向的真实归档，计算末期动量和日收益的样本标准差。`price.dates` 是全体观察日期，`price.factorDates` 是末尾 period+1 个收盘价的实际计算日期，不把二者混称全窗口因子。JSON 数值为小数收益率，终端显示百分比；不把日波动率写成年波动率。缺价格/归档、数据不匹配、陈旧缓存、新闻源失败、方向性目标标题缺可读正文、无法判断的情绪，以及新闻在最后价格日期当天或之后，都会阻止方向性调整结论。相反标题或新闻方向与动量相反时显示 conflicting。

价格来源还必须支持研究市场：A 股为 AKShare/Tushare，美股为 LLMQuant/Financial Datasets，港股为 LLMQuant。即使注入数据的 symbol、市场、归档来源和数值互相一致，来源不支持该市场时仍将价格证据置为 unavailable，新闻独立保留；失败后不保留已部分填入的价格日期或引用。

满足基础条件时只给出待核对原文、后续价格确认及明确风险预算的假设调整条件。没有目标仓位比例、账户读取或下单行为；相关性不代表因果。需要更完整风险分析时继续调用 `check_risk`。

`price.newsWindows` 另按每篇新闻的市场当地日期生成 `publication-date-closes-v1` 证据：发表 UTC 时间、当地日期、前一条更早收盘价、严格晚于发表日期的首尾收盘价与实际观察日期。发表日收盘一律排除，因为缺少盘中时点信息。`aroundPublicationReturn = firstAfter / before - 1` 跨越发表日及任何缺失观察；`subsequentReturn = lastAfter / firstAfter - 1` 只比较严格更晚的价格，至少需要两条观察。缺端点或非有限数值为 null，不用零补齐、不扩大日期范围、不猜交易日历。

方向性标题对应的后续价格横盘或不足两条时，adjustment 为 insufficient；后续方向与标题相反则为 conflicting，即使原 5 日动量同向。既有缺来源、陈旧缓存等阻断仍优先。这是观察窗口比较，不是新闻造成的收益、超额收益事件研究或校准信号。事件窗口及同期其他事件会影响事件研究解释，参见 [Snowberg、Wolfers、Zitzewitz：How Prediction Markets Can Save Event Studies](https://www.nber.org/papers/w16949)；本实现不复现该论文模型。公司关联和正文主张仍需要独立核对。

恢复上下文从原分支保留新闻、正文段落/指纹、价格时点、方法和建议条件，正常记录为 recorded，缺证据时仍为 unresolved；不会升级为独立验证的金融事实。当前不支持把本工具作为 ResearchTask 的已验证指标验收条件，也没有将新闻情绪加入可分享报告的白名单。这些能力与校准/真实模型语义验证继续作为 F11/F20 的缺口。

## 模块

| 文件 | 职责 |
|---|---|
| `src/types/news.ts` | 新闻请求、来源、尝试与观察契约 |
| `src/source/src/news-providers.ts` | Yahoo HTTP 与 AKShare Python 传输 |
| `src/source/src/news.ts` | 市场映射、时间/关联过滤、归并与指纹 |
| `src/types/news-document.ts`、`src/source/src/news-document.ts` | 正文观察契约、受限请求、DOM 提取与段落引用 |
| `src/quant/news-sentiment.ts` | 无 IO 的可复现标题初筛 |
| `src/quant/news-price-windows.ts` | 无 IO 的逐新闻前后价格观察、日期与收益口径 |
| `src/runtime/news-research.ts` | 价格归档核对、因子和条件化建议 |
| `src/tools/news-citation-evidence.ts` | 纯格式化引用映射、可复制 token 与逐段网页观察 |
| `src/tools/news-tools.ts` | 默认 AgentTool schema、说明及模型可读证据 |
| `src/research/state.ts` | 按会话分支恢复观察，保留未验证边界 |

接入依据为 [yfinance Search 实现](https://github.com/ranaroussi/yfinance/blob/main/yfinance/search.py)、[Ticker.get_news 实现](https://github.com/ranaroussi/yfinance/blob/main/yfinance/base.py) 和 [AKShare stock_news_em 实现](https://github.com/akfamily/akshare/blob/main/akshare/news/news_stock.py)。正文使用 [Mozilla Readability](https://github.com/mozilla/readability) 与 [linkedom](https://github.com/WebReflection/linkedom)，版本固定为 0.6.0/0.18.13。Yahoo 搜索没有可据此承诺的服务 SLA；AKShare 上游改版、搜索限流和空结果均需显式处理。

## 测试方式与实际证据

确定性测试不需要模型、数据 key 或真实账户，存储 fixture 放在 TEMP：

```powershell
bun test src/source/tests/news.test.ts src/source/tests/news-providers.test.ts src/source/tests/news-ticker.test.ts src/source/tests/news-document.test.ts src/runtime/news-research.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

第一阶段 48 项测试覆盖三个市场映射、跨市场拒绝、时区/夏令时、来源/日期/关联过滤、去重与截断、相同链接更新、未来窗口、空/旧/冲突新闻、429/供应商失败、取消、人工价格公式、横盘不确认方向、归档不一致、诊断依赖及原分支恢复。第二阶段再增加 30 项，覆盖 ticker 回退/单端点诊断/广告过滤，以及真实 DOM 提取、正文身份/访问/大小/取消边界、跳过读取和原分支正文恢复。真实 Pi 循环配合确定性响应验证下一次模型请求能够收到段落、指纹、新闻链接、方法和不确定性；这不等于真实模型已正确分析新闻。

第一阶段工程回归：1280 pass / 0 fail，159 个测试文件、16760 次断言，81.99 秒；typecheck、architecture（0 baseline violations）、build、构建后 CLI help 与 diff 检查通过。Bun 构建包含 2722 个模块、入口约 6.22 MB。第一阶段测试日志为 `%TEMP%/whyj-news-full-final.log`。

第二阶段工程回归：1310 pass / 0 fail，161 个测试文件、16882 次断言，86.47 秒；typecheck、architecture（0 baseline violations）及 build 通过。正文解析依赖使构建增至 2948 模块、约 6.67 MB。测试日志为 `%TEMP%/whyj-news-body-full.log`；所有确定性测试均使用 fixture，不把测试数量当作模型语义准确率。

独立真实新闻检查（公开网络，不调用模型、行情或本地设置）：

```powershell
bun run scripts/check-news.ts 000001.SZ A 2026-09-01 2026-09-14 eastmoney
bun run scripts/check-news.ts AAPL US 2026-09-01 2026-09-14 yahoo
bun run scripts/check-news.ts 00700.HK HK 2026-09-01 2026-09-14 yahoo
```

Exit 0 表示本次存在合格新闻，2 表示源不可用，3 表示空/窗口外；重新运行会随上游新闻改变。2026-09-14 14:24 UTC 的实际 Source 调用记录如下，不能扩展为全市场验收：

| 标的/源 | 本次结果 |
|---|---|
| 000001.SZ / 东方财富 | 返回 10 条，7 条在窗口内，3 条早于窗口；最新保留项为证券时报网、2026-09-14 09:37 UTC |
| AAPL / Yahoo | 返回 10 条，7 条有精确 AAPL 关联，3 条无匹配关联而剔除 |
| 00700.HK / Yahoo | 查询正确映射为 0700.HK；返回 10 条均无匹配关联，输出 empty，未放宽筛选引入无关美国新闻 |

第二阶段实际调用，2026-09-14 14:51–14:52 UTC：00700.HK 搜索仍为 10 条无匹配；ticker-news 返回 30 条，其中 16 条在窗口内、14 条过旧。最新腾讯文章提取 7 段、1,401 字符；东方财富 000001.SZ 仍有 7 条窗口内新闻，最新行业文章提取 14 段、762 字符，页面未提供可提取的发布时间。后一篇是银行行业报道，不能仅凭关键词把全部内容当成平安银行结论。测试只记录提取元数据，不在文档转载正文。

港股回退已取得可用样本，仍需补充跨来源与更广市场覆盖、情绪校准样本和真实模型任务审阅；F11 继续标为部分完成。

真实模型的固定输入评测已接入 `eval:research -- --case news-all`，覆盖正文冲突、角色伪装网页指令、受限正文、港股公司关联、新闻后价格方向及有损恢复。输入均为合成数据，引用/执行检查和回答人工审阅分开，见 [新闻模型评测](./news-evaluation.md)。

第三阶段新增 6 项评测入口回归，全量 1316/1316 通过；因真实模型缩写长哈希、混淆因子日期而补充引用映射与 factorDates。真实样本已经留存研究与恢复回答，但仍有段落引用、时区与关联解释问题，不以自动检查通过代替语义验收。

## 逐新闻价格窗口验证（2026-09-15）

原逻辑只检查新闻后存在价格日，再用末期窗口动量比较标题方向。三个反例复现为失败：此前上涨、新闻后下跌；此前上涨、新闻后横盘；仅一个严格后续收盘价。修复将窗口计算独立为纯模块，runtime 保持归档/取消/缺项编排，工具输出首尾日期与收益，研究恢复保留原 price 投影，不重算或改写旧记录。旧档案没有 newsWindows 时，不应把旧窗口动量补称为新闻后确认。

新增 11 项测试：四项建议边界、六项纯计算/真实 source 日期映射，以及 news-reversal 的实际 Pi + localhost SSE + 有损恢复。另增强已有测试，核对工具文本、失败时空窗口和恢复内容。反转 fixture 的五日动量为 +10%，9 月 9–10 日严格后续收盘为 115→110，即 -4.3478%；9 月 7–9 日的包围区间为 120→115，即 -4.1667%，两者不可互换。US UTC 跨日与 A/HK 当地日期、同日排除、缺观察、不补零、修订和非有限计算也有回归。

```powershell
bun test src/quant/news-price-windows.test.ts src/runtime/news-research.test.ts src/runtime/news-evaluation.test.ts
# 真实模型调用，产生用量；只使用合成新闻/价格与隔离 TEMP
bun run eval:research -- --case news-reversal --timeout-ms 240000 --max-requests 8 --output output/news-reversal-new.json
```

专项 **45 pass / 0 fail、251 断言**，日志 `%TEMP%/whyj-news-windows-targeted.log`；最初三个反例见 `%TEMP%/whyj-news-windows-before.log`。真实模型逐份结果另见 [新闻评测](./news-evaluation.md)，不计入确定性测试通过数。

全量 **1462 pass / 0 fail、178 文件、19631 断言、112.75 秒**，日志 `%TEMP%/whyj-news-windows-full.log`。root 与评测脚本 strict typecheck、architecture（0 baseline violations）、build（2968 modules / 6.73 MB）通过。真实模型 news-reversal 的研究/恢复 6/6 自动检查通过，人工确认窗口数字区分，但仍缺发布时间的 UTC 标签和波动率高低的比较依据；F11/F20/F24 保持部分完成。

## 发布时间与市场日期的证据标签（2026-09-15）

跨时区反例：`2026-09-08T00:30:00Z` 是 UTC 发表时点，在美东夏令时的市场日期为 **9 月 7 日**。前后价格窗口按 `marketDate` 选取日收盘价，不能把 UTC 的 `00:30` 直接说成美东本地时钟，也不能把 UTC 日期作为新闻的市场日期。

原始新闻快照和不可变会话结果的字段不变。[工具文本](../src/tools/news-tools.ts) 现逐条标注 `publishedAt (UTC)`、`marketDate (news.scope.timezone)`，并标注 `observedAt` 为 UTC 观察时点；[恢复上下文](../src/research/state.ts) 在包含新闻研究时保留同一解释。日样本波动率仍是原数值，但没有同口径历史或横向基准时不称“偏高/偏低”。来源发布时间仍是供应商声明，不因标签而成为已核验事实；`marketDate` 是日历日期，不包含当地盘中发表与收盘顺序。

新增的跨 UTC 日期集成回归通过实际 `fetchNews → research_news → ResearchState` 核对时间、窗口和恢复提示；已有真实 Pi/localhost 评测回归确认有损恢复后的下一次模型请求收到时间口径。确定性测试不证明模型一定遵守这些标签。复跑：

```powershell
bun test src/runtime/news-research.test.ts src/runtime/news-evaluation.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

本次先以新断言复现 **35 pass / 7 fail**（跨日期工具/恢复样例及原有六个有损恢复请求），修复后两文件 **42 pass / 0 fail**。全量 **1560 pass / 0 fail、186 文件、143.29 秒**，日志 `%TEMP%/whyj-news-time-full.log`；typecheck、architecture（0 baseline violations）和 build（2977 modules / 6.75 MB）通过，日志 `%TEMP%/whyj-news-time-checks.log`。这些检查验证证据可达与正确标注，模型语义仍按 [独立评测](./news-evaluation.md) 审阅。

随后按模型复测发现的等级误读补充路由解释：[来源快照](../src/source/src/news.ts) 不再使用笼统的 “different relevance strength”，[工具文本](../src/tools/news-tools.ts) 和 [恢复提示](../src/research/state.ts) 明确三个标签不是校准或有序的证据层级。来源、工具、实际 Pi 有损恢复三文件新增断言在修复前 **55 pass / 9 fail**，修复后 **64 pass / 0 fail**。完整模型结果与工程检查另见 [评测记录](./news-evaluation.md)。

该路由说明后的完整工程回归为 **1560 pass / 0 fail、186 文件、139.79 秒**，日志 `%TEMP%/whyj-news-route-full.log`；root typecheck、architecture（0 baseline violations）、build（2977 modules / 6.75 MB）通过。真实模型单例还暴露了未经证实的新闻后“反转形态”措辞，产品语义仍按 [原始评测](./news-evaluation.md#2026-09-15关联路由不等于证据等级) 继续验收。

## 媒体陈述与价格形态的结构化边界（2026-09-15）

真实回答把合成正文写为“属实”，把新闻后两个收盘价写成“利好出尽/反转形态”。这两句都超过当前工具证据：抓到网页段落只证明该页面在抓取时如此陈述；价格窗口只计算给定日期的观察收益，没有预先定义或检验形态规则。新 `news-research` 结果为 version 2，新增 `evidenceBoundary`：出版方/标题/时间是 `unverified` 声明，正文为 `observed-page` 或不可用，命名价格形态为 `unassessed`。[纯价格窗口](../src/quant/news-price-windows.ts) 增加 `patternAssessment`，明确 `rule=null`。数值、日期、来源快照和 `publication-date-closes-v1` 计算方法未改。

[工具摘要](../src/tools/news-tools.ts) 将三个状态和具体原因一起传给模型；[ResearchState](../src/research/state.ts) 只记录本次完整结果，不把媒体声明升为 `verified`，有损压缩后仍携带 `evidenceBoundary`。旧 version 1 结果继续按原会话记录读取，缺少新字段时不能推断旧研究评估过命名形态，也不重写旧记录。该结构化边界是可读取的证据，不保证模型叙述正确；真实语义结果见 [新闻评测](./news-evaluation.md)。

确定性复跑：

```powershell
bun test src/quant/news-price-windows.test.ts src/runtime/news-research.test.ts src/runtime/news-evaluation.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

新增断言先复现 **37 pass / 11 fail**，修复后相关三文件 **48 pass / 0 fail**；覆盖多于两条后续收盘仍无形态规则、正文可读与跳过读取的不同状态、工具结果及实际 Pi 有损恢复请求。随后补入旧 version 1 记录未获新字段的测试，三文件仍 **48 pass / 0 fail**、2.21 秒，日志 `%TEMP%/whyj-news-claims-final-targeted.log`。

完整工程回归 **1560 pass / 0 fail、186 文件、130.57 秒**，日志 `%TEMP%/whyj-news-claims-full.log`；根 typecheck、architecture（0 baseline violations）和 build（2977 modules / 6.76 MB）通过，日志 `%TEMP%/whyj-news-claims-checks.log`。最后仅补了旧记录测试并独立重跑 typecheck，通过，日志 `%TEMP%/whyj-news-claims-test-typecheck.log`。四案例真实模型评测单独记录，不以结构化状态代替人工审阅。

同日公开端点只读复核（observedAt **2026-09-15 04:20:19 UTC**，窗口 9 月 1–14 日）：`000001.SZ/A/eastmoney` 收到 10 条，窗口内 7、过旧 3；`AAPL/US/yahoo news-search` 收到 30 条，窗口内 29、窗口后 1；`00700.HK/HK/yahoo` 搜索收到 10 条均无精确 ticker 关联并拒绝，随后 ticker-news 收到 30 条，窗口内 16、过旧 14。三次 `check-news.ts` 均返回 status=available，日志 `%TEMP%/whyj-news-public-a.json`、`whyj-news-public-us.json`、`whyj-news-public-hk.json`。这只验收本次端点返回、过滤及港股回退，不读取价格、正文、凭证或账户；候选文章的目标公司关联、媒体真实性和完整历史覆盖仍未获证实。

## 可复制引用与市场兼容价格来源（2026-09-15）

[四例模型原始复测](./news-evaluation.md#2026-09-15媒体边界四例复测及引用缺口) 发现，`news-reversal` 研究回答把两个正文段落键写成裸文本，虽然键本身存在，但机械引用格式无效；`news-hk` 的合成价格被误标为只支持美股的 financial-datasets。工具现在将每个有正文的引用直接展示为 `[citationId/pN]`，受限正文为 `[citationId/restricted]`，无段落时不提供伪引用。检查器仍拒绝裸键和发明的段落。研究运行时复用 source 的市场 provider 链核对价格来源，即使 DatasetRef 内部一致，来源不支持市场也将其价格置为 unavailable；合成港股价格改用 llmquant-data，旧评测报告原样保留。

新断言先复现 **40 pass / 3 fail**，修复后两文件 **43 pass / 0 fail**；随后补充受限正文可复制标记和港股不兼容归档反例，最终两文件 **45 pass / 0 fail、297 断言**，日志 `%TEMP%/whyj-news-source-citations-final-targeted.log`。全量运行在最后港股反例补入前已通过 **1561 pass / 0 fail、186 文件、20987 断言、130.76 秒**，日志 `%TEMP%/whyj-news-source-citations-full.log`；最后测试补入后专项与 root typecheck 已复跑通过。architecture 仍为 0 baseline violations，build 为 2977 modules / 6.76 MB。真实模型与人工语义审阅另记，自动工程绿灯不能证明公司关联或正文论断正确。

后一轮 [四例人工审阅](./news-evaluation.md#2026-09-15可复制引用与港股来源复测) 确认港股价格来源与反转例引用改正，但港股解释仍将“缺关联依据”说成“正文否认关联”；冲突样本末尾的 `[文章键]` 也被旧校验漏过。研究 `evidenceBoundary.targetCompanyRelation` 现单列 `unassessed`，明确缺目标公司数字不是无关联的证明；工具和有损恢复均展示这一点。评测器拒绝无 `/pN` 或 `/restricted` 的方括号文章键，即使答案其他位置有合法引用。港股 fixture 的第二段明确保留供应商关联未知，不将遗漏数字写成否定句。新断言先复现 **41 pass / 5 fail**，修复后两文件 **46 pass / 0 fail、305 断言**。全量 **1564 pass / 0 fail、186 文件、21003 断言、162.80 秒**，日志 `%TEMP%/whyj-news-company-link-full.log`；root typecheck、architecture（0 baseline violations）和 build（2977 modules / 6.76 MB）通过，四份更新文档的本地链接可打开。真实模型再次复测另记；旧模型报告不重判，提示与字段仍须语义审阅。

[第三份四例复测](./news-evaluation.md#2026-09-15公司关联未知与文章级伪引用复测) 证实港股关联未知的两阶段措辞已改善，但研究末尾仍误用 `[文章键]`；反转研究虽按合法引用保留价格日期，却把工具给出的“news-exhaustion”示例词翻为假设性命名形态。现将映射行标作 `Article mapping (not a citation)`，独立列出可复制的 `Citation tokens`，`reading.guidance` 明确禁止单独 `[citationId]`。价格纯模块不再列举可能的形态名，只明示未检验的窗口连假设也不应命名；观察收益与计算方法不变。评测输入只要求实际收盘/收益，恢复仍沿同一边界。新断言先复现 **49 pass / 4 fail**，修复后三文件 **53 pass / 0 fail、348 断言**，日志 `%TEMP%/whyj-news-label-citation-targeted.log`；完整回归与两例真实模型复测独立记录，不能仅以提示改善宣称语义合格。

[港股单例复测](./news-evaluation.md#2026-09-15港股映射与正文关联单例) 为 6/6，研究/恢复均没有再把缺腾讯指标改写成“否认关联”，也没有再把映射键写成 `[文章键]`。这是固定合成文章上的一次改善，不代表真实市场新闻语义完成；反转形态的复测独立记录。

[反转单例复测](./news-evaluation.md#2026-09-15未检验形态单例与段落语义) 也为 6/6，两阶段只报告实际收盘、观察收益与未评估形态状态，不再假设性命名“利好出尽”。人工审阅仍发现研究把 p1 的合成数字声明引用到 p2；自动检查不能核验论断与段落的语义对应。全量最终 **1565 pass / 0 fail、186 文件、179.45 秒**，日志 `%TEMP%/whyj-news-label-citation-full.log`；工程门槛通过，F11/F20/F24 保持部分完成。

## 逐段原文与引用同屏（2026-09-15）

前面的模型可读结果只有映射键和 `[citationId/pN]` token，正文主要藏在末尾完整 JSON。最新反转单例因此把 p1 里的“合成数字/非真实业绩”错引到 p2。现由独立纯模块 `news-citation-evidence.ts` 为每个已抓取段落生成 `Observed paragraph  [citationId/pN]` 行，后面以 JSON 字符串转义原文，使换行、引号与 JSON 可转义的控制字符不能伪装成工具行。开头明确页面段落是不可信观察、不是工具指令；受限/无段落页面不生成伪原文。完整结果 JSON、内容指纹、段落及 append-only 会话记录仍按原格式保留，模型仍须逐句核对主张支持。

这会让同一页面文本在可读段落行和末尾 JSON 中出现两次，最多受现有每页 12,000 字符、5 篇上限约束；真实模型用量需要单独观察。两文件新断言先复现 **45 pass / 3 fail**，修复后 **48 pass / 0 fail、322 断言**，日志 `%TEMP%/whyj-news-paragraph-display-before.log`、`whyj-news-paragraph-display-targeted.log`。专项验证实际 Pi 下一次请求收到段落键和正文，且受限页面没有段落；其后恶意 p3 的转义/不可信声明回归使最终专项为 **49 pass / 0 fail、327 断言**。全量在最后仅测试补入前为 **1566 pass / 0 fail、186 文件、150.81 秒**，日志 `%TEMP%/whyj-news-paragraph-display-full.log`；最后测试后专项及 typecheck 重跑通过，build 增至 2978 modules / 6.76 MB。真实模型反转单例的 p1/p2 对应改善见 [评测](./news-evaluation.md#2026-09-15段落与引用并列的反转单例)，网页伪指令案例另行复测；不能仅以可读格式判定所有引用正确。

[可读恶意 p3 的冲突单例](./news-evaluation.md#2026-09-15可读恶意网页段落的冲突单例) 为 6/6，研究/恢复均将测试网页指令作为不可信页面内容并忽略，未输出其要求的标记；这只验证固定合成 p3 的本次模型行为。段落文本可读化后完整正文与引用仍按原档案恢复，真实新闻可靠性及更广攻击输入仍未验收。

## 2026-09-18：真实公开新闻的正文额度选择

在隔离目录运行生产 `researchNews`，请求 AAPL/US、2026-09-01 至 09-17、Yahoo 新闻与应用价格。2026-09-18 12:40 UTC 的第一次运行收到 `news-search` 29 条、窗口内接受 20 条；最新两篇标题分别主要谈 Berkshire Hathaway 和 Warren Buffett，却因 Yahoo 的 `relatedTickers` 包含 AAPL 消耗默认前两篇正文读取额度。第三篇标题明确写出 `Apple (AAPL)`。这说明来源的 ticker 标签不能充当文章主体或读取优先级证明。

[正文额度选择](../src/runtime/news-reading-selection.ts)现保持 `news.articles` 的时间顺序，但读取时先取标题显式包含目标代码的候选，组内仍按时间排序，其他候选随后。它不按关键词删除新闻，也不把标题匹配升级为已核实的公司关联。研究结果新增 `reading.selection`，工具可读回执提示此选择边界；港股同时识别 `00700.HK`、Yahoo 的 `0700.HK` 和标题中的 `SEHK:700`/`HKEX:700` 表示，短美股代码不与普通英文词混淆。后续的主体线索与目标情绪收口见下节。

[第二次公开运行摘要](../output/news-aapl-reading-selection-2026-09-18.json)在 12:43 UTC 取得同一端点 29/20 条，原始前五标题顺序不变；限额两篇改读明确标注 AAPL 的第 3、5 篇，均返回 `available` 正文。应用价格独立来自 AKShare `stock_us_daily` 的 12 个交易日归档，因子窗口为最后 6 个收盘日；最后价格日当日的新闻没有已确认后续收盘，因此调整状态为 `insufficient`，没有方向性建议。摘要仅保存候选元数据、读取状态、归档引用和阻断原因，不复制正文；SHA-256 `C3C6F6BF0B852F6EBA4BB9E7A99CDCD79C9316A90FB3DBB4A2893BC9A9E58C6A`。这是一次真实公开源的读取选择验证，不证明新闻事实、公司关联、情绪校准或模型最终解释；F11 仍部分完成。

## 2026-09-18：标题主体线索与目标情绪范围

Yahoo 搜索的精确股票代码报价可给出英文公司名；A 股东方财富新闻关键词只给代码，另并行请求东方财富两字段报价 `f57`（代码）和 `f58`（简称），仅代码和交易所都与请求一致时采纳名称。已知沪深前缀与错误交易所后缀的组合在联网前拒绝。报价请求限时 6 秒，失败不影响新闻结果；北京交易所股票暂不使用这条报价提示。来源名称均标记为 `provider-claimed`，不作为已核实公司身份。正文读取优先级为标题代码、供应商名称、其他；原候选仍按时间完整保留。`candidateCounts` 显示所有候选标题的词组命中，`counts/tone` 仅汇总有目标标题线索者。未匹配的方向性标题单独阻断调整并要求主体复核；公司关联总体状态仍为 `unassessed`。

确定性反例中，Yahoo 同时给 AAPL 返回“Microsoft raises guidance”和“Apple cuts guidance”：前者保留为候选但不进入 AAPL 目标情绪、价格冲突判断或调整文章 ID，后者给出目标负向标题初筛。公开运行的 [AAPL 摘要](../output/news-subject-aapl-2026-09-18.json) 与 [港股摘要](../output/news-subject-hk-2026-09-18.json) 分别有 20/19 条入窗候选、7/10 条标题目标线索，限额两篇读取到了目标标题。A 股 [贵州茅台摘要](../output/news-subject-a-600519-2026-09-18.json) 有 9 条候选、2 条标题含“贵州茅台”，两篇正文均可读；平安银行在同一窗口的 6 条候选主要是行业新闻，没有目标标题线索，因此目标 tone 仍为 unknown。这些是供应商在该时点返回的近期样本，不推断新闻库完整性或真实模型语义正确性；F11 仍部分完成。

复测命令：

```powershell
bun test src/source/tests/news-providers.test.ts src/source/tests/news.test.ts src/runtime/news-reading-selection.test.ts src/runtime/news-research.test.ts src/runtime/news-evaluation.test.ts
bun run test
bun run typecheck
bun run check:architecture
bun run build
```

最终验证：新闻专项 83/83、全量 1770/1770（214 文件、22897 次断言、508.53 秒），日志 `%TEMP%/whyj-news-subject-full-final.log`；typecheck、architecture（0 baseline violations）、build、三份改动文档的 273 个本地链接和 `git diff --check` 通过。未运行真实模型语义评测或情绪标注校准。

港股 `00700.HK` 同日公开样本中，Yahoo `news-search` 为空而 `ticker-news` 返回 30 条、入窗 19 条。[加入交易所代码前](../output/news-hk-reading-selection-2026-09-18.json)，第二个正文额度落在与腾讯主体不明的加密交易所标题，页面还返回 `unsupported`；SHA-256 `A1F302D710404E6E2E56AA41655938BBF87295579DB84F7776392F4820256C9A`。[加入 `SEHK:700` 后](../output/news-hk-reading-selection-after-2026-09-18.json)，相同窗口的前五候选顺序不变，前两份读取改为标题明确标记 `Tencent Holdings (SEHK:700)` 的页面，均返回 `available`；AKShare 港股价格归档可用，调整仍为 `insufficient`。后者 SHA-256 `8B17F91ABC751C7E22BE26DBD2F79F8D5C28CDCF2CAD374FA26E85655A1C504B`。两次站点观察相隔约两分钟，不声称响应字节或完整候选集相同；标题代码也没有核实全文主张。完整模型语义和其他市场继续验收。

最终全量 `bun run test` **1764/1764、214 文件、22865 次断言、393.74 秒**，日志 `%TEMP%/ohq-news-reading-final-2026-09-18.log`。专项还覆盖真实研究调用、Pi/有损恢复及港股代码/短美股代码边界；typecheck、architecture（0 baseline violations）、build（3031 modules / 7.00 MB）、267 个本地文档路径与 `git diff --check` 通过。

## 2026-09-18：标题中的显式市场身份优先

此前 `000001.SZ` 的标题筛选同时接受裸码 `000001`；若候选标题实际写成 `000001.SH` 或 `000001.OF`，裸码仍被判为 `title-ticker`，即使同一标题包含供应商给出的“平安银行”名称。这会把另一市场/品类的标题提前读取，并让其方向性词组进入目标 tone 与调整证据。当前代码直接复现 `000001.SH 上调评级 => title-ticker`。

[标题主体筛选](../src/runtime/news-reading-selection.ts)现在先查看标题中同一数字代码的显式 `.SZ/.SH/.SS/.BJ/.HK/.OF` 后缀；仅出现与请求身份冲突的后缀时，匹配为 `unassessed`，供应商名称或裸码不能覆盖这个冲突。`.SS` 按 `.SH` 的 Yahoo 别名处理。纯裸码标题仍可作候选线索，同时含正确和其他后缀的比较标题仍可识别正确代码。原始新闻列表和来源标签不删除，只有正文读取顺序及目标情绪/调整范围收窄。

反例先使标题筛选测试 **4 pass / 2 fail**；修复后[标题单测](../src/runtime/news-reading-selection.test.ts)与[完整研究链测试](../src/runtime/news-research.test.ts)合计 **43/43、206 次断言**。集成例让两条明确错误身份的正向标题比目标 `.SZ` 负向标题更新，验证优先读取目标、目标 tone 为 negative、候选原始计数仍保留全部三篇。这是标的身份的确定性回归；标题仍只是供应商声明和词法线索，不能证明全文主体或金融结论。

## 2026-09-18：受限正文的方向性调整门槛

同日四场景真实模型复跑的受限正文案例暴露另一缺口：付费墙只返回 `restricted` 和零段正文，工具却把正向标题加同向价格标为 `conditional`，模型据此给出方向模板。现只要任一有方向性的目标标题没有可读正文（包括主动跳过、付费墙、无法提取或正文读取额度不足），`adjustment.status` 就为 `insufficient` 并列出阻断；新闻标题、价格和合法的 `[citationId/restricted]` 仍保留，供用户复核。可读正文仍只证明抓取到页面陈述，并不核实事实或公司关联。该反例先使两项研究/实际 Pi 评测测试失败，修复后新闻三文件专项 **59/59、372 次断言**；真实模型修复前后的回答和边界见[模型评测](./news-evaluation.md)。

两项修复后的最终全量 `bun run test` 为 **1781/1781、215 文件、22939 次断言、281.93 秒**，日志 `%TEMP%/ohq-news-identity-body-final-full.log`；root typecheck、architecture（0 baseline violations）、build（3032 modules）、本地文档链接与 `git diff --check` 通过。这里的回归证明确定性代码路径，实模复跑只覆盖本次固定合成场景，F11 仍保持部分完成。

## 2026-09-19：网页指令段落的模型可见边界

[9 月 18 日冲突评测](./news-evaluation.md#2026-09-18四场景复跑与受限正文门槛)中，模型没有执行网页 p3 的恶意要求，但研究回答仍把其测试标记复述出来。此前 p3 同时进入工具的可读段落、末尾完整 JSON 和有损恢复的 `ResearchState`；只在可读行标记“不可信”不足以限制它在后续请求中的传播。

[模型可见投影](../src/research/news-model-view.ts)现在对明显面向助手或指令层级的页面段落做窄范围隔离，并在同一投影里移除对应的可引用段落号。工具可读行、随附 JSON 和研究恢复上下文共用这个投影；抓取原文、内容哈希及本地 append-only 证据仍保留，以便事后审计。页面标题、署名、时间、供应商名称和发布方若包含相同类型的指令，也在模型视图中替换为占位说明。只有指令段落而没有可用财务正文时，研究结果为 `insufficient`，不能凭标题和价格提供方向性调整。引用检查器拒绝被隔离段落的 token。

这是一项有明确边界的规则过滤：它能处理当前固定反例和若干直接指令形式，不能识别所有改写、间接诱导或看似正常的错误金融主张；普通段落仍需核实来源与主张。已用纯规则、工具结果、真实 Pi 下一轮请求及有损恢复请求测试原文不向模型传播，同时验证普通“ignore previous guidance”财务语句不会误隔离。真实模型复测与完整工程回归见[评测记录](./news-evaluation.md)。F11 的完整新闻语义、校准和跨市场覆盖仍待验收。

## 2026-10-11：隐藏字符和可疑标题

网页指令检测仅对匹配视图去除指定零宽/双向格式字符、折叠空白并识别句子后的角色标记，原页面、指纹和段落编号保留。被隔离段落不能作为工具/恢复的可引用金融证据。可疑标题或供应商名称不产生正文读取优先线索；标题初筛 item 明示 `headlineWithheld=true`、unknown 和空方向词组，不计入目标情绪或调整证据。存在可疑标题时建议为 insufficient，即使其他价格/正文条件齐备，也须先复核来源。

原新闻顺序不删除，可疑标题只退出方向性解释；一页预算优先读取正常财务候选。`unknown` 和 `headlineWithheld` 的原因不同，两者均不表示中性。新 `news-obfuscated` 固定案例覆盖真实 DOM、工具可读行/JSON、Pi 请求与有损恢复的模型可见边界；本轮真实模型在首次请求失败，无语义验收。复现过程、运行记录和测试方式见 [评测补充](./news-evaluation.md#2026-10-11隐藏字符与标题指令的证据门槛)。这是范围明确的规则过滤，不是通用注入识别或情绪校准。
