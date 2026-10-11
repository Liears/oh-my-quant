# 精选技能版本与依赖

核对日期：2026-09-19。唯一代码清单为 [catalog.ts](../src/skill/catalog.ts)，默认安装和发现白名单从中生成。此处整理上游入口、requirements 与已明确列出的固定文件闭包；只有链接到独立报告审计的项目包含相应范围的数值复核，仍不是第三方技能的完整安全认证。

| 仓库 | 固定提交 | 核心技能 |
|---|---|---:|
| [LLMQuant/skills](https://github.com/LLMQuant/skills/tree/1918237467c2dff4cc97a18ebc0892dfd46e8129) | `1918237467c2dff4cc97a18ebc0892dfd46e8129` | 5 |
| [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills/tree/a2506fd1bab662723fb7142734320fef23fc48fa) | `a2506fd1bab662723fb7142734320fef23fc48fa` | 5 |

两个版本通过 `git ls-remote` 及实际 checkout 核对；随后用生产安装器在独立 TEMP 从 GitHub fetch 固定提交，两个 HEAD 与 10 个入口名称全部匹配。[安装结果](../output/skill-catalog-verification-2026-09-14.json) 保留提交、入口名称与文件 SHA-256。没有运行技能脚本、自动安装 Python 包或使用真实账户输入。

## 依赖范围

五个 LLMQuant 入口都是路由到相邻 workflows 的指令，入口与 21 份 workflow 共 26 个固定文件须先通过本地内容检查。完整研究需要相应 LLMQuant/兼容数据能力；上游允许缺数据时明确列缺项，或使用用户提供的证据形成受限结果。WhyJ 的日线 API key 不能证明整个研究数据服务可用。

| 技能 | 上游要求的主要数据范围 |
|---|---|
| llmquant-data | SEC 文件、13F 持有人、宏观观察与发布元数据 |
| llmquant-macro | 宏观序列、发布/修订日期、跨资产及政策数据 |
| llmquant-equities | 价格、财务、估值、预期、事件及机构持有 |
| llmquant-portfolio | 研究档案、论点、观察列表和提醒服务；不同于本地观察分组 |
| llmquant-risk | 风险、VIX、期权链和组合证据；真实仓位不能从本地文件猜测 |

来源为固定提交的 [LLMQuant skills 目录](https://github.com/LLMQuant/skills/tree/1918237467c2dff4cc97a18ebc0892dfd46e8129/skills)，已逐份阅读上述五个 SKILL.md；完整文件清单见 [LLMQuant workflow 闭包](./skill-readiness.md#2026-09-19llmquant-五入口-workflow-固定闭包)，具体 workflow 的金融语义仍需按任务补查。

| 技能/模式 | 必要输入或依赖 | 可选项/限制 |
|---|---|---|
| market-breadth-analyzer | Python 3.9+、requests≥2.31、公开 CSV 网络访问、本地脚本与文件权限 | 无需 key；仍须检查 CSV 日期，会写报告和历史 |
| technical-analyst：周线图 | 用户周线图、模型图片输入、本地参考文件读取 | 概率情景属于分析判断，不是经校准的预测 |
| technical-analyst：逆向确认脚本 | Python、requests、十文件固定闭包、FMP key 与日 OHLC 接口、拥挤方向、本地执行 | 仅显式选择此模式；固定闭包与上游测试可核对，当前安装漂移及认证网络仍待验证 |
| position-sizer | Python 3.9+ 标准库、用户风险和账户参数、本地执行、固定提交六文件闭包 | 自动报告包含账户值；真实输入必须先满足私有输出契约，只读报告审计不授予技能执行资格 |
| macro-regime-detector | Python、requests≥2.31、yfinance≥0.2、九只 ETF 历史网络访问、固定入口/参考和脚本文件 | FMP key 可选；无 key 使用回退数据和 SHY/TLT 代理；文件/网络检查不等于执行验收 |
| market-environment-analysis：研究 | 搜索工具、带时间和来源的市场证据 | 经济日历可选；不能由已有日线工具推定搜索可用 |
| market-environment-analysis：日历助手 | Python、pandas-market-calendars==5.2.2、本地执行、固定提交九文件闭包 | 运行日历助手不能代表市场研究已完成；Python 元数据不等于可导入 |

来源为固定提交的 [Trading skills 目录](https://github.com/tradermonty/claude-trading-skills/tree/a2506fd1bab662723fb7142734320fef23fc48fa/skills)，已阅读五个 SKILL.md，以及 market-breadth-analyzer、macro-regime-detector、market-environment-analysis 的 requirements.txt。这些是入口级声明；Python 版本和包是否已安装、网络和模型是否支持，仍需要运行时证据。

## 用户入口和升级规则

`/skill info <name>` 对实际位于精选仓库路径的技能显示 catalog pin、模式依赖、运行判定和限制；原声明与实际检查分开显示。`--check` 可检查本地 Python/包版本，见 [技能依赖](./skill-readiness.md)。同名项目技能覆盖精选技能时，不给它附上精选仓库的来源或依赖声明。这里的 catalog pin 不是对旧安装实际 HEAD 的核验。

`/skill install LLMQuant/skills` 和 `/skill install tradermonty/claude-trading-skills` 均使用固定提交。新增默认安装固定到该版本；旧目录启动时保持离线可用，显式更新才检查来源和干净工作区，并只允许 fast-forward。目标提交缺核心入口时在修改现有 checkout 前拒绝；新安装缺入口时不发布。回退和分叉不会触发 reset 或删除重装。

升级精选版本需要修改 catalog、重新核对全部核心入口/依赖并记录实际安装验证。安装成功后，空闲查看 `/skill` 或下一次独立请求会刷新技能，保留同一研究会话；运行中的循环及排队续问保持原快照。本地依赖判定已联动模型索引和显式调用；完整网络/传递依赖、私有输出与脚本效果继续按 F23/F24 验收，不能以本清单代替 ready 状态。catalog 中的 reviewed-script-files 和 private-output-authorization 是 WhyJ 额外的本地检查边界。

2026-09-19 对五个 LLMQuant 核心入口增加[入口与 21 份 workflow 的 26 文件固定闭包](./skill-readiness.md#2026-09-19llmquant-五入口-workflow-固定闭包)。当前安装 HEAD 与 pin 一致，五条生产 `--check` 均返回文件 available；完整数据模式仍因缺 LLMQuant research/workspace 服务而 blocked，用户证据模式保持 needs-input。文件匹配不证明数据服务、workflow 结论或模型任务质量。

2026-09-24 将 [LLMQuant skill 真实模型评测](./skill-evaluation.md)扩为五个精选入口的全部 21 个 reviewed workflow。所有最终样本都经生产 readiness、显式 skill 注入和唯一 workflow 只读加载，当前规则 9/9；诊断历史保留 discovery 缓存、否定语境、相对时间、日期符号、workspace 存在性、外部政策基准、freshness、季度/年度口径、13F、PE 增长推断、并购输入、回测保证、交易日历、VIX/恐慌分标签和无链期权问题。该覆盖仍不等于完整数据服务、live workspace 或总体解释质量验收。

2026-09-15 补充 `/skill info market-breadth-analyzer --check --check-network`：显式检查固定公开 CSV、字段及日期，观察五分钟后失效，并要求与本地版本检查使用同一解释器。实际公开站点检查通过，具体证据及范围见 [技能依赖](./skill-readiness.md#公开-csv-网络检查)。该结果不扩展到 ETF 或私有输出，也不核验已安装脚本是否与 catalog pin 一致。

2026-09-15 对 technical-analyst 先补充入口和两个 Python 文件的内容清单；2026-09-19 扩为入口、模板、参考、requirements、脚本和上游测试共十项固定闭包，`--check` 比对 SHA-256（仅统一 CRLF/LF）。固定 Git 对象通过生产文件探测，上游 **123/123** 在隔离目录通过；当前安装的新 HEAD 缺八项并修改入口，生产状态保持 blocked。测试使用 HTTP 替身，FMP 凭证、真实网络、图片入口和模型语义未验收。来源、文件指纹、复跑方式及边界见 [逆向脚本检查](./skill-readiness.md#逆向确认脚本检查)。

2026-09-15 对 macro-regime-detector 补充固定九 ETF 历史网络观察及 17 项入口、参考、Python 本地导入闭包指纹。隔离设置下的生产 CLI 已验证固定公开文件原版、改动、缺失，并实际取得九只 ETF 历史日线；最少 616 条、最新 2026-09-14。文件/网络与解释器必须分别核对，观察只保留五分钟。另在无 FMP key 的隔离环境中运行固定主程序，九只 ETF 各 600 条并生成两份基本报告；这一次执行不证明评分公式、时间对齐、自然语言结论或全部技能工作流。见 [ETF 与宏观脚本检查](./skill-readiness.md#etf-历史网络与宏观脚本检查)。

2026-09-16 对 market-breadth-analyzer 增加 [15 文件固定闭包、生产资格与真实公开脚本复核](./skill-readiness.md#2026-09-16breadth-固定脚本闭包与公开效果复核)。精选模式现在要求已核对的安装文件与同解释器的最新 CSV 网络观察；一次固定脚本运行取得六项组件、53.6 的公开数据综合分数，原输入/报告归档可离线复核。当前本地已安装版本更新到不同 HEAD，生产检查显式 blocked，不用未核对的新文件冒充目录固定版本，也不修改用户 checkout。其它技能、私有输出和终端完整任务仍按 F23/F24 验收。

2026-09-19 对 position-sizer 增加[六文件固定闭包与私有只读报告审计](./skill-readiness.md#2026-09-19仓位计算报告的私有只读审计)。从 catalog pin 提取的原始 CLI 已用合成账户运行，生产审计独立复算 fixed-fractional 结果并核对 JSON/Markdown；回执不包含账户值、文件路径或正文。当前本地 checkout 是不同 HEAD，requirements、脚本与测试不匹配，生产 `/skill info ... --check` 因而继续 blocked。该审计不满足私有输出授权，不把真实账户交给 Agent，也不扩展到真实交易或未保留原始胜负输入的 Kelly-shares 报告。

2026-09-19 对 market-environment-analysis 的日历助手增加[九文件固定闭包与隔离执行](./skill-readiness.md#2026-09-19市场日历固定闭包与隔离执行)。固定 Git 对象通过生产文件探测，上游 48 项测试及带时区 CLI 样本在隔离的顶层包/传递依赖与本机受信任 pandas 上通过；无时区日期明确失败。当前本地新版删除 requirements、核心日历模块和契约测试，且本机未安装 pandas-market-calendars，生产模式继续 blocked。日历通过不提供 web-search，也不证明实时市场研究。
