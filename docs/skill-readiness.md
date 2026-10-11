# 技能依赖与调用资格

更新：2026-09-24，补充 LLMQuant 五入口真实模型选择、position-sizer 私有只读审计与 market-environment-analysis 日历脚本闭包。安装、发现、模型索引和运行依赖是不同状态；文件匹配或单次脚本数值审计不证明输出质量，也不构成 shell 沙箱。

## 使用方式

```text
/skill
/skill info market-environment-analysis
/skill info market-environment-analysis --check
/skill info llmquant-data --check
/skill info market-breadth-analyzer --check --check-network
/skill info technical-analyst --check
/skill info macro-regime-detector --check --check-network
/skill info position-sizer --check
/skill audit position-sizer --json REPORT.json --markdown REPORT.md
```

普通列表和详情不启动依赖检查。`--check` 对精选技能核对声明的本地 Python 依赖和固定文件闭包；没有 Python 依赖的 LLMQuant 路由仍会执行文件检查。Python 选择与行情请求一致；命令不安装包、不导入或执行第三方 workflow/脚本、不调用模型、不联网。详情显示版本、文件差异、缺项与观察时间，运行中的会话仍保留原快照；结束后重新查看或发起独立请求会采用新结果。修复本机环境或修改/升级技能后应再次检查。

| 状态 | 意义 | 调用行为 |
|---|---|---|
| `requirements-met` | 至少一个模式的已声明运行要求有满足证据 | 只允许该模式；不代表脚本执行已验证 |
| `needs-input` | 某模式的运行要求满足，但缺本次任务资料 | 可进入收集资料；分析或脚本执行前必须取得输入 |
| `blocked` | 所有模式均有已知缺项 | 从模型可用索引移出；显式调用返回缺项检查入口 |
| `unverified` | 没有可用模式，部分必要条件缺少证据 | 从模型可用索引移出；显式调用要求先核验 |

每个模式独立显示要求和状态。市场研究缺搜索时，即使日历包齐备，也只允许日历助手；不能把它宣传为可完成市场研究。`needs-input` 不会自动把对话文本判作已满足的账户、图表或市场证据，模型收到先询问缺项的约束。该提示尚不是对任意 shell 命令的参数级执行拦截。

## 当前默认宿主

- 活动 `bash` 工具提供 shell 和本地资源读取入口；恢复为无工具的会话不会继续宣称这些能力存在。
- 当前没有专用 web-search、完整 LLMQuant 研究/档案服务或图片输入入口。股票代码搜索、日线 key、模型自身支持图片均不能代替它们。
- LLMQuant 五个入口的入口与 21 份 workflow 共 26 个固定文件可显式核对；当前安装全部匹配。提供证据后可进行受限分析，完整研究模式仍缺服务。详情与提示仅允许符合条件的模式。
- Python 检查覆盖解释器、requests、yfinance、pandas-market-calendars 的已安装版本；版本比较只接受明确的数字发行版本，预发布或未知格式保留 unverified。包元数据存在不保证导入、传递依赖或脚本执行成功。
- market-breadth-analyzer 的固定公开 CSV、macro-regime-detector 的固定九 ETF 历史日线可通过显式 `--check-network` 检查；LLMQuant workflow、breadth、逆向、仓位、市场日历和宏观脚本可核对固定文件内容。Python 元数据本身不证明包能导入、FMP 可用或脚本能执行；已完成的隔离执行记录及范围见下文。
- position-sizer 现有固定提交的六文件内容清单与私有只读报告审计；但上游会将账户值写入报告，当前默认宿主仍未提供私有输出授权，因此保持 blocked。报告审计不授予 Agent 读取账户值或运行第三方脚本的权限。
- 独立受信任宿主可通过 [`skillCapabilities`](./session-dependencies.md#端口与所有者)，静态 WhyJ 插件也可通过 [Extension capability 资源](./extensions.md#开发接入)，显式提供搜索、图片、私有输出、LLMQuant 服务或其它已核验依赖，并用 revision 触发空闲刷新。插件启停和重载会撤销或替换对应事实；依赖插件工具的能力须用 `requiresTools` 绑定，恢复选择或任务范围移除工具时同步撤销。默认宿主不自动继承这些事实。shell 与本地文件读取仍只看活动 `bash` 工具，不能由能力回执伪造。

策略仅应用于实际精选安装路径，不将同名项目技能当成精选来源。catalog 固定的是声明对应的版本，详情仍明确 Git HEAD 未在这里核对；文件探测核对清单内容，不审计修改后的第三方代码。外部技能未纳入这份精选依赖清单，不据此给它们增加已验证标记。

## 模块与快照

`skill/readiness.ts` 纯计算模式状态；`skill/python-probe.ts` 管理本地观察、取消和版本；`runtime/skill-readiness.ts` 绑定真实活动工具与默认宿主缺项。默认 Session 通过 `prepareSkills` 注入策略，独立宿主可自行提供；未注入的宿主不继承本地限制。

Session 保存原始技能快照，再生成带依赖状态的资源，避免反复追加描述。普通请求的系统提示、`getSkills()` 和显式 skill 使用同一份准备结果。缺依赖时在模型请求和研究日志写入前拒绝显式调用；检查成功后仍在同一研究会话激活符合条件的模式。工具循环、排队续问和压缩保留当次依赖观察快照；已提交研究任务改变时，可在该快照内进一步收缩模式。`scopeRuntimeSkills` 不重新探测环境，任务缺少 bash 时撤销 shell/本地读取模式；换任务重新从宿主准备结果派生，详见 [任务装配](./research-tasks.md#按任务装配2026-09-15)。

检查结果仅保存在进程内；重启后重新检查。不将包版本结果写入用户配置或研究日志。取消不发布结果，较早的检查不会覆盖较晚结果；失败会撤销本次环境的旧成功判断，保留具体原因。

## 2026-09-19：LLMQuant 五入口 workflow 固定闭包

[固定文件清单](../src/skill/llmquant-manifest.ts)按五个精选入口分别保存 `SKILL.md` 与其 workflow：data 5 项、macro 4 项、equities 6 项、portfolio 6 项、risk 5 项，共 **26 个文件**。空的 assets/scripts 占位符不参与运行语义，未纳入清单；五份入口中的全部本地 Markdown 链接均指向清单内存在的 workflow。SHA-256 沿用文件探测器的 CRLF/LF 统一口径。

此前 `/skill info <name> --check` 只在技能声明 Python 时进入本地检查，导致纯 Markdown 路由即使有 reviewedFiles 也永远保持 unverified。handler 现在独立判断 Python 元数据和文件闭包：需要 Python 时检查版本，有清单时检查文件，两者互不充当对方的前置条件。`reviewed-script-files` 是现有兼容字段名，本节用于入口和 workflow 等本地资源，不表示这些文件可执行。

当前 `.ohquant/skills/LLMQuant-skills` 的 HEAD 与 catalog pin `1918237467c2dff4cc97a18ebc0892dfd46e8129` 一致。五条生产 one-shot `/skill info ... --check` 均返回文件 available；source-backed research 因默认宿主缺 `llmquant-research-data` 保持 blocked，limited supplied evidence 因尚未提供本次任务资料保持 needs-input。删除 workflow 的隔离 fixture 会由同一 handler 报 missing；同名非精选路径不附加该策略。

专项 **28/28、316 次断言**覆盖 26 文件及指纹、两种模式的共同文件门槛、文件未查时不进入模型索引、文件回执通过后的受限资料收集、无 Python 依赖时 handler 仍执行检查，以及帮助文案；另核对 21 个本地 workflow 链接全部存在。最终全量 **1868/1868、223 文件、23513 次断言、228.54 秒**通过，日志 `%TEMP%/ohquant-llmquant-manifest-final-20260919.log`。该结果证明固定 Markdown 路由完整性和调用资格分层，不证明 LLMQuant 服务可用、workflow 金融结论、时效、模型选用或任何真实研究任务；F23/F24 保持部分完成。

## 2026-09-24：LLMQuant 五入口 21 个受限证据 workflow 的真实模型选择

[独立 skill 评测](./skill-evaluation.md)现通过 `eval:research -- --case skill-all` 对 data、macro、equities、portfolio、risk 五个入口分别执行生产 `QuantAgentSession.skill()`、readiness、skill XML、Pi provider 和工具循环。21 个任务均不写预期文件名；隔离 reader 每例只允许一次对应 workflow 读取，不启动真实 shell、行情、账户或 LLMQuant 服务。它覆盖固定闭包中的全部 21 份 workflow；最终选择记录均按当前规则为 **finished、9/9、2 个请求事件**。

连续诊断固定了执行器与语义门槛：所有目录必须在首个 discovery 快照前 staged；否定句和等价数值不得误报；单次观察不得升级为当前状态；未来会议、日期差正负、未提供的政策基准、无 freshness 规则的 stale 判断、异量纲综合排名、workspace 对象存在性、期间收入误作年收入、13F 时点、PE 反推增长、并购套利缺失量、回测保证、alert mutation、未提供的交易日历、收盘 VIX 实时化、分位区间、恐慌分交易信号、无链期权合约及 falling-knife 定性均显式检查。案例与语义规则已按五个 router 模块化，聚合入口保持原 API。历史失败文件原样保留，最终回答按当前规则通过并经人工审阅。评测自身为 **3/3、217 次断言**，合并专项 **32/32、524 次断言**；最终全量 **1873/1873、224 个文件、23743 次断言、342.72 秒**，typecheck、architecture、test fence 与 3052-module 生产构建通过。这些任务覆盖 reviewed workflow，但不证明完整 LLMQuant 数据、live workspace、真实终端任务或总体模型成功率，F23/F24 继续部分完成。

## 公开 CSV 网络检查

`/skill info market-breadth-analyzer --check-network` 仅适用于实际精选路径的这个技能，不接受任意 URL，也不检查其他技能。macro-regime-detector 的固定 ETF 检查见下一节。可与 `--check` 同时使用：前者取得网络观察，后者取得解释器/包版本；两份证据必须对应同一 Python 可执行路径。普通列表、详情、启动和模型请求均不会自动探测网络。

网络检查使用行情模块相同的 Python 选择规则及 requests，读取固定的 detail/summary CSV；不执行安装目录内的脚本、不安装包、不写研究报告。为避免携带环境认证，检查禁用 requests 的 netrc/环境代理读取及 HTTP 重定向；因此它证明该直接公开访问路径，不证明上游脚本使用用户代理时也会成功。总进程期限 20 秒，连接/读取超时各 5 秒，每个解压后响应最多 4 MiB。

字段和日期规则依据固定提交的 [csv_client.py](https://raw.githubusercontent.com/tradermonty/claude-trading-skills/a2506fd1bab662723fb7142734320fef23fc48fa/skills/market-breadth-analyzer/scripts/csv_client.py)。检查 detail 的十个必要字段、合法日期、有限数值、整数趋势与布尔值；summary 必须有非空 Metric/Value。HTML、截断、重复列/日期/指标和非法数值不算通过。日期采用 UTC 日历日，最新数据距检查日须为 0–5 天；未来日期拒绝。这是本地检查契约，不证明全部历史交易日齐全或指标公式正确；比上游跳过坏行的行为更严格。

网络观察有效五分钟，只保留聚合状态和日期于进程内。到期或解释器不匹配后恢复 unverified；复查失败撤销旧成功，取消不发布，旧检查晚到不覆盖新检查。观察版本及到期变化接入 Session 的技能修订键，下次空闲读取/独立请求更新同一研究会话；运行中的循环保留原快照。命令结束也通知 TUI 刷新技能建议。`info` 的成功表示生成了诊断，是否可调用仍看 Readiness 和各模式，不看命令退出是否成功。

## 2026-09-16：Breadth 固定脚本闭包与公开效果复核

[固定文件清单](../src/skill/breadth-manifest.ts)包含 `SKILL.md`、方法参考、requirements、主程序、四个相邻模块及七个 calculator 文件（六个实现与包入口），共 15 个文件，SHA-256 按 Git CRLF/LF 统一规则从 catalog 固定提交 `a2506fd1bab662723fb7142734320fef23fc48fa` 的本地 Git 对象取得。`/skill info market-breadth-analyzer --check` 会比对实际安装目录；`--check-network` 继续单独核对 CSV。两份观察都匹配且 Python/活动 shell 可用时，精选模式才进入模型索引。未运行 `--check`、缺脚本或内容变化即不把网络通过等同于脚本可调用。[目录与模式测试](../src/runtime/skill-readiness.test.ts)在 Python 和网络已通过时故意删除文件，确认模式被阻断。

当前工作区已安装的该仓库 HEAD 是 `b5566100dfad877f81fbad172293e2195f451919`，工作区干净，但不同于 catalog pin。生产 `/skill info ... --check` 实测为 `blocked`：新版缺旧版 requirements，`csv_client.py`、`history_tracker.py` 和 `report_generator.py` 的内容不同。它仍可发现和查看诊断；不借“工作区干净”自动把未经核对的新版本标成当前精选模式可用，也不回滚用户 checkout。要让此安装成为精选可用版本，需单独审阅并升级 catalog/依赖/脚本清单；或在新的独立目录安装原固定提交。当前两次提交的脚本差异还包括明细逐行解析不再显式拒绝非法日期、非有限数值和非法布尔值，报告写出也取消了显式 UTF-8；因此这次没有把新版 HEAD 自动提升为已审阅版本。

[公开脚本验证命令](../scripts/check-breadth-skill.ts)在 TEMP 下载并逐项验证固定提交的 15 个源文件，调用真实 `/skill info --check --check-network`，随后只获取一次两份公开 CSV，将同一字节通过 127.0.0.1 隔离服务交给固定 Python 主程序。程序的 JSON、Markdown、历史文件与原始 CSV 都存入新记录旁的 `.bundle` 目录。验证记录保存官方 URL、输入和输出哈希、完整原始 JSON、生产依赖状态与[独立数值审计](../src/skill/breadth-report-audit.ts)结果；综合分数按固定 25/20/20/15/10/10 权重重新算，不信任报告自己的贡献字段。[离线复核](../src/skill/breadth-bundle.ts)从归档文件再次核对哈希、日期、行数、分数、分区和最新历史项，越出包目录的路径直接拒绝。

[本轮保存的完整验证包](../output/breadth-script-bundle-2026-09-16.json)在 2026-09-16 本地运行：detail **2510 行、447004 字节**，summary **12 行、350 字节**；最新 detail 日期 **2026-09-14**。固定脚本六项组件均可用，得到 **53.6/100、Neutral**；独立审计 `[]`，随后完全离线复核为 `passed=true`。记录 SHA-256：`2BD0EA1B4D82911F5D2ED15359B5C6EE296DC557DB782927D079F7C947A45508`。原始脚本报告见[归档 JSON](../output/breadth-script-bundle-2026-09-16.json.bundle/report.json)及[Markdown](../output/breadth-script-bundle-2026-09-16.json.bundle/report.md)。可用下列新路径复跑，脚本拒绝覆盖旧结果：

```powershell
bun run scripts/check-breadth-skill.ts --output output/breadth-script-new.json
bun run scripts/recheck-breadth-bundle.ts --record output/breadth-script-bundle-2026-09-16.json
bun test src/skill/breadth-report-audit.test.ts src/skill/breadth-bundle.test.ts src/skill/catalog.test.ts src/runtime/skill-readiness.test.ts src/agent/test/session-dependencies.test.ts
```

这一次证明固定公开输入上的脚本可执行、报告形状和综合加权数值一致；各 calculator 的金融解释、数据供应方准确性、历史发布/修订、上游报告中的仓位建议及终端内真实模型选用仍未独立验收。记录没有账户数据或模型请求；F23/F24 保持部分完成。

本轮六文件专项 **31/31、215 次断言**；最终全量 **1741/1741、209 文件、22774 次断言、272.22 秒**，日志 `%TEMP%/ohq-breadth-full-reviewed-2026-09-16.log`。typecheck、architecture（0 baseline violations）、test fence、build（3024 modules / 6.96 MB）、离线复核和文档路径检查通过。同会话激活测试通过可替换的只读文件观察端口提供已核验回执，生产默认仍读取真实文件探测记录。

[network-probe.ts](../src/skill/network-probe.ts) 管理观察/期限/版本与错误脱敏，[breadth-network-script.ts](../src/skill/breadth-network-script.ts) 负责有界获取及 CSV 校验；纯模式判定继续复用 readiness.ts。原始 HTTP 正文和异常不进入提示或日志。

## ETF 历史网络与宏观脚本检查

`/skill info macro-regime-detector --check --check-network` 仅适用于实际精选路径。`--check` 核对本地 Python、requests、yfinance 元数据以及固定版本 17 个入口/参考/脚本文件；`--check-network` 用同一 Python 显式获取固定的 `RSP SPY IWM TLT SHY HYG LQD XLY XLP` 九只公开 ETF 日线。不接受自定义 symbol/URL，不读取 FMP key，不执行安装目录里的脚本，也不写研究报告。两项检查可以分别运行，但能调用该模式必须同时有匹配的解释器、网络观察和文件证据。

网络探测依据固定提交的 [macro_regime_detector.py](https://github.com/tradermonty/claude-trading-skills/blob/a2506fd1bab662723fb7142734320fef23fc48fa/skills/macro-regime-detector/scripts/macro_regime_detector.py) 和 [fmp_client.py](https://github.com/tradermonty/claude-trading-skills/blob/a2506fd1bab662723fb7142734320fef23fc48fa/skills/macro-regime-detector/scripts/fmp_client.py) 所用 ETF 集合与 yfinance 下载路径。探测查询至检查日的前 900 个日历日，逐只要求 Open/High/Low/Close/Volume 有效、至少 400 个不同日线日期、最早和最新相隔至少 500 日、最新日期在 UTC 检查日前 0–5 日；进程上限 60 秒。这是本地输入覆盖检查，不证明宏观指标按上游 600 日窗口算出有效结果，更不证明 FMP 补充数据、收益率代理或报告内容正确。

[etf-network-probe.ts](../src/skill/etf-network-probe.ts) 仅在进程内保存九只覆盖量、最少行数和首末日期，不保存价格正文或底层异常。观察五分钟过期或换 Python 后恢复 unverified；失败复查撤销旧成功，取消不发布，晚到检查不能覆盖新结果。修订键接入空闲 Session 刷新；正在运行的模型循环保留旧技能快照。[etf-network-script.ts](../src/skill/etf-network-script.ts) 是独立固定检查代码，安装技能文件不参与网络探测。

固定版本的 `SKILL.md`、requirements、三个参考文件和 12 个 Python 文件 SHA-256 维护在 [macro-manifest.ts](../src/skill/macro-manifest.ts)。对入口、主程序、fmp_client、报告/评分模块、六个 calculator、共享 utils 和包入口构成的本地导入闭包，`--check` 复用 [file-probe.ts](../src/skill/file-probe.ts) 的 256 KiB、路径隔离及 CRLF/LF 规则。缺文件为 missing，内容改变或不可读为 unverified；匹配只证明当前目录对应已核对的固定内容，不证明包可导入、第三方代码可执行、网络来源可用性延续或结论质量。升级/本地修改后必须重查，不是文件监控或执行时防篡改。

生产 CLI 使用隔离设置、从固定公开提交下载的 17 个文件和本机 Python，对原版/改动 utils/删除 utils 分别得到文件 available/unverified/missing；原版公开九 ETF 网络也通过，最少 616 条日线、最新 2026-09-14，UTC 观察时间 2026-09-15T06:48:28Z。记录在 [宏观技能验证](../output/macro-skill-verification-2026-09-15.json)，SHA-256 `d8a5d0fb7462f30b30e4444cb7179e415854f32966fb6d5d3fc1b828a6d6d216`。五分钟观察已经过期，复跑时须重新检查：

```powershell
bun run scripts/check-macro-skill.ts --output output/macro-skill-new.json --network
```

该脚本从公开 GitHub 固定提交下载到 TEMP，运行生产 `/skill info` handler 和本机 yfinance 输入探测；输出必须为新路径，结束后清理隔离目录。默认不执行下载的第三方技能代码，也不使用真实账户。实测 `requirements-met` 只对应声明的本地文件/ETF 输入模式，不作为宏观结论验收；F23/F24 仍有其他真实脚本、完整任务与私有输出等缺口。

进一步显式加 `--run-public-script` 时，验证器先要求文件、Python 与九 ETF 输入全部满足，然后在隔离目录中运行固定上游主程序，子进程禁用 FMP key 和用户 site-packages，只记录每只 ETF 条数、报告文件名及结构，不保存报告正文或指标分数。首次[最小环境记录](../output/macro-public-script-verification-2026-09-15.json)省略代理变量，脚本退出 1 且无报告；按照固定源码的 SPY 必需门槛，这与二次取数失败相符，但首次未保留逐只输出，原因仍是推断。保留与输入探测一致的 HTTP(S) 代理设置后，[公开脚本复测](../output/macro-public-script-verification-recheck-2026-09-15.json)退出 0，九只 ETF 各 600 条日线，产出 JSON/Markdown、六个组件及有限的 composite 值；`data_mode=yfinance_only`，Treasury API 缺项使用 SHY/TLT 代理。复测 JSON SHA-256 为 `88e008eccdb59ba0a8d35413e9adfb997a8670c8e3ae0f29c`。这是一次公开输入上的脚本可执行性与基本报告形状验证；没有独立校核组件公式、数据调整口径、时间对齐、评分或自然语言结论。

```powershell
bun run scripts/check-macro-skill.ts --output output/macro-public-new.json --network --run-public-script
```

## 2026-09-16：宏观公开报告的独立算术与离线复核

原公开脚本记录只保留报告文件名、组件数与有限的综合值，无法离线核对原始报告。现在 [固定版本验证器](../scripts/check-macro-skill.ts) 在九只 ETF、17 个文件和 Python 门槛通过后，保存公开运行的完整 JSON/Markdown 到新记录旁的 `.bundle`；记录报告字节数与 SHA-256。[独立审计](../src/skill/macro-report-audit.ts)依据固定 [scorer.py](https://github.com/tradermonty/claude-trading-skills/blob/a2506fd1bab662723fb7142734320fef23fc48fa/skills/macro-regime-detector/scripts/scorer.py) 的 25/20/15/15/15/10 权重，重算六项贡献、综合分数、信号区间、最强/最弱与可用组件计数。[离线复核](../src/skill/macro-bundle.ts) 从同一归档字节重审算术、哈希、固定源/文件清单与九 ETF 条数，拒绝越出记录包的路径。脚本仍禁用 FMP key、用户 site-packages 与账户模型调用。

[本轮公开验证记录](../output/macro-public-bundle-reviewed-2026-09-16.json)在 Windows / Bun 1.3.14 运行，固定脚本九只 ETF 各得到 **600 条日线**，`data_mode=yfinance_only`，Treasury 数据未提供；六组件报告为 **58.5/100、Transition Zone (Preparing)**，5 项达到上游的 40 分信号门槛。独立算术审计无问题，完全离线复核为 `passed=true, violations=[]`，另显式返回 `warnings=[markdown-source-label-conflicts-with-json]`：JSON 写 `yfinance_only`，原始 Markdown 页头却写 `FMP API (0 calls)`。固定 [report_generator.py](https://github.com/tradermonty/claude-trading-skills/blob/a2506fd1bab662723fb7142734320fef23fc48fa/skills/macro-regime-detector/scripts/report_generator.py) 将这行来源硬编码为 FMP，故不能把 Markdown 页头当成实际行情来源。记录 SHA-256 `AA1E865EACB311C0C5D34639570127870107B27B3CF2759C445D6F945E4E85A0`；原始 [JSON](../output/macro-public-bundle-reviewed-2026-09-16.json.bundle/report.json) 与 [Markdown](../output/macro-public-bundle-reviewed-2026-09-16.json.bundle/report.md) 可供人工审阅。重新公开运行须用尚不存在的新输出路径：

```powershell
bun run scripts/check-macro-skill.ts --output output/macro-public-new.json --network --run-public-script
bun run scripts/recheck-macro-bundle.ts --record output/macro-public-bundle-reviewed-2026-09-16.json
bun test src/skill/macro-report-audit.test.ts src/skill/macro-bundle.test.ts
```

这次只证明固定脚本的公开输入路径、报告字节、内部加权算术和离线引用一致；Markdown 来源标签冲突已保留在回执，不提升为已验收的人类可读报告。没有保存逐日 ETF 原价，不能独立重算六个 calculator 的金融公式，也不证明 yfinance 调整口径、Treasury/FMP 补充、供应商历史发布或自然语言行动建议正确。F23/F24 仍为部分完成。

本阶段两文件专项 **8/8、12 次断言**；最终全量 `bun run test` **1752 pass / 0 fail、211 文件、22826 次断言、260.60 秒**，日志 `%TEMP%/ohq-macro-presentation-final-2026-09-16.log`。根 typecheck、两份脚本严格类型检查、architecture（0 baseline violations）、test fence、build（3026 modules / 6.97 MB）、离线复核、六份相关文档的 334 个本地路径和 `git diff --check` 均通过。

## 2026-09-16：同次宏观价格输入与六组月末指标复核

上一节的加权审计只拿到脚本报告的六个已算分数。新增 [输入捕获器](../scripts/capture-macro-inputs.py) 在隔离 Python 子进程中加载固定版主程序，包裹 `FMPClient.get_historical_prices()` 并原样返回结果；固定源码和六个 calculator 不修改。显式 `--capture-inputs` 要求已有 `--network --run-public-script`，关闭 FMP key，保存主程序实际取得的九份 `{"symbol","historical"}` 响应到同一验证包。[独立输入审计](../src/skill/macro-input-audit.ts)核验降序日期、代码、复权后的 OHLCV，按每月最近交易日对齐重建 RSP/SPY、SHY/TLT、HYG/LQD、IWM/SPY、SPY/TLT、XLY/XLP 六组比值，再核对六组件的当前日期/比值、6/12 月均值、3/12 月变化率、百分位与月点数。[离线复核](../src/skill/macro-bundle.ts)按归档哈希重读九份输入并重复审计，旧的仅报告验证包仍可重读。

[同次捕获记录](../output/macro-input-capture-2026-09-16.json)在 2026-09-16 本机公开路径生成：九只 ETF 各 **600 条**、最新日期同为 **2026-09-15**；九份输入合计 **913927 字节**，RSP 最早为 **2024-04-24**。六组月末与窗口指标独立复核 `inputAudit=[]`，综合分数仍为 **58.5/100**，离线返回 `passed=true, violations=[]`；原 Markdown 来源冲突继续返回 `warnings=[markdown-source-label-conflicts-with-json]`。记录 SHA-256 `53F97B3C00CC9B769DE1FE465A81B639A6A978ADA19B6B6C512CA9AB929734CF`；[报告 JSON](../output/macro-input-capture-2026-09-16.json.bundle/report.json)和[归档 RSP 输入样本](../output/macro-input-capture-2026-09-16.json.bundle/inputs/RSP.json)可供重审，其他八份同存于验证包。新路径复跑：

```powershell
bun run scripts/check-macro-skill.ts --output output/macro-input-new.json --network --run-public-script --capture-inputs
bun run scripts/recheck-macro-bundle.ts --record output/macro-input-capture-2026-09-16.json
bun test src/skill/macro-input-audit.test.ts src/skill/macro-bundle.test.ts src/skill/macro-report-audit.test.ts
```

这一步证明报告六组月末比值和窗口统计可从当次返回价格重建，仍未独立复算六个 calculator 的交叉、方向与 0–100 打分规则，也没有供应商历史修订证明。`auto_adjust=True` 是上游获取时的请求口径，归档价格本身不能独立证明调整算法。未经处理的 Markdown 来源标签仍不应作为真实来源证据；F23/F24 保持部分完成。

本阶段三文件专项 **11/11、22 次断言**；最终全量 `bun run test` **1755 pass / 0 fail、212 文件、22836 次断言、291.26 秒**，日志 `%TEMP%/ohq-macro-input-final-2026-09-16.log`。根及两份验证脚本 strict typecheck、Python 捕获器语法检查、architecture（0 baseline violations）、test fence、build（3026 modules / 6.97 MB）、新旧包离线复核、三份文档的 271 个本地路径及 `git diff --check` 均通过。

## 2026-09-18：终端宏观报告来源核验

前两节的验证器与离线包可供工程复核，但用户直接运行精选技能得到的 JSON/Markdown 此前没有终端内的核验入口。新增只读 [`/skill audit macro-regime-detector`](../src/skill/macro-audit-command.ts)：`--json REPORT.json --markdown REPORT.md` 检查指定两份普通报告的六项综合加权、JSON 的 `data_source/data_mode` 与 Markdown 来源/分数；`--record PATH` 用相同离线复核器重读固定验证包及其中可用的九份输入。该命令在一条 CLI 命令路径上于配置读取前执行，不安装/调用技能，不请求模型或市场，不输出报告正文；两个报告输入文件各限制 256 KiB，验证记录限制 1 MiB。普通报告模式明确返回 `scope=report-only`，不把作者报告或本地文件名当作安装版本和原价格证明。

本机用上节的[完整捕获记录](../output/macro-input-capture-2026-09-16.json)及同包 JSON/Markdown 经真实 `whyj --json -c` 执行：两种模式均显示综合算术通过，但因 Markdown 页头把 `yfinance_only` 错写成 FMP，退出码为 1、`ok=false`，机器结果仍带 `source=yfinance`、`humanReadablePassed=false` 与 `markdown-source-label-conflicts-with-json`。损坏的本地设置文件下同样能出具报告审计回执；修正 Markdown 标签的双文件样本通过，但仍只属于内部一致性验收。用 Windows PowerShell 可复跑：

```powershell
bun run src/index.ts -- --json -c '/skill audit macro-regime-detector --record output/macro-input-capture-2026-09-16.json'
bun run src/index.ts -- --json -c '/skill audit macro-regime-detector --json output/macro-input-capture-2026-09-16.json.bundle/report.json --markdown output/macro-input-capture-2026-09-16.json.bundle/report.md'
```

[精选技能注册](../src/skill/catalog.ts)和模型索引现对固定提交显式提示这个上游来源标签问题，显式技能调用的上下文还提醒区分 SHY/TLT 代理与国债收益率。模型是否按提示给出正确最终解释仍需真实任务评测；此入口只阻止把已知错误的人类可读报告判作通过。F23/F24 保持部分完成。

本阶段完整回归 **1761 pass / 0 fail、213 文件、22858 次断言、411.21 秒**，日志 `%TEMP%/ohq-macro-cli-audit-stable-2026-09-18.log`。另在报告算术错误但 Markdown 来源正确的反例中，人类可读报告仍不能通过；包记录在读取前核对 1 MiB 文件限制。

## 2026-09-19：宏观六组件交叉、方向与打分复算

此前的离线复核已从同次九只 ETF 价格重建月末比值、均线、变化率和分位，但未从价格独立核对交叉及打分。新增 [独立信号审计](../src/skill/macro-score-audit.ts)，沿用 [输入审计](../src/skill/macro-input-audit.ts) 的月末对齐序列，依据固定上游的 [交叉/评分规则](https://github.com/tradermonty/claude-trading-skills/blob/a2506fd1bab662723fb7142734320fef23fc48fa/skills/macro-regime-detector/scripts/calculators/utils.py) 和 [股债相关性规则](https://github.com/tradermonty/claude-trading-skills/blob/a2506fd1bab662723fb7142734320fef23fc48fa/skills/macro-regime-detector/scripts/calculators/equity_bond_calculator.py)，逐项重算 6/12 月均线交叉与距今月数、3/12 月动量、方向及 qualifier、六项 0–100 分；股债项另从 SPY/TLT 月收益重算 6/12 月相关性与 0/10/20 分加项。报告原文未被修改；校验器只比较结构化字段，不能证明市场解释或投资建议正确。

[新公开捕获记录](../output/macro-score-capture-2026-09-19.json)在隔离目录运行固定的 17 个文件、公开 ETF 网络检查、原版 Python 主程序和价格输入捕获。九只 ETF 各 600 行，最近价格日期为 2026-09-18；六项分数依次为 60/70/60/70/20/70，综合分 58.5。新回执写入 `scoreAudit=[]`，独立离线复核为 `passed=true, violations=[]`；上游 Markdown 仍把 `yfinance_only` 误标 FMP，保留 `warnings=[markdown-source-label-conflicts-with-json]`，因此人类可读原报告不算通过。记录 SHA-256 为 `E05FC8DA8B6E05B0227B174B7F35291751D8393D086016981C78F048C1B786AF`。旧的 [2026-09-16 完整捕获](../output/macro-input-capture-2026-09-16.json)没有 scoreAudit 回执字段，当前离线复核仍直接从其原始价格重算并通过。

固定平价 ETF 输入和修改后重算报告哈希的反例分别验证分数、交叉、方向、相关性错误无法被旧的报告算术或哈希检查掩盖。复跑命令（新输出需换为未存在的文件）：

本轮专项 **14/14**、根目录全量 **1784/1784、216 文件、22947 次断言**通过；根与验证脚本严格类型检查、架构检查（0 baseline violations）、构建（3033 modules）通过。源码 CLI 的 `bun run src/index.ts -- --json -c '/skill audit macro-regime-detector --record ...'` 对新包返回 `bundlePassed=true`、`humanReadablePassed=false`，退出码 1，准确保留来源冲突；不能把离线分数成功等同为原 Markdown 报告通过。

```powershell
bun test src/skill/macro-score-audit.test.ts src/skill/macro-input-audit.test.ts src/skill/macro-bundle.test.ts src/skill/macro-audit-command.test.ts
bun run scripts/recheck-macro-bundle.ts --record output/macro-score-capture-2026-09-19.json
bun run scripts/check-macro-skill.ts --output output/macro-score-next.json --network --run-public-script --capture-inputs
```

这项复核限固定提交、这两次公开 yfinance-only 捕获和原脚本规则；FMP/Treasury 模式、供应商历史修订、上游 Markdown 标签、模型最终解释及其他精选技能仍待验收，F23/F24 保持部分完成。

## 2026-09-19：宏观报告可见数值与旧回执兼容

原报告审计只核对 Markdown 的来源标题、综合分与区间；若正文把某个组件的 50 分改成 70 分，结构化 JSON 算术仍可通过，而终端会错误地把人类可读报告标为通过。[展示审计](../src/skill/macro-presentation-audit.ts)现独立检查总分所在行、区间、六项组件的名称/顺序/权重/分数、信号个数和数据质量；夹带 `yfinance + FMP` 的来源标题也不通过。`/skill audit` 将展示冲突单独提示，保留 JSON 算术与原 Markdown 的不同结果，不静默改写第三方报告或宣称投资指导已审阅。

新捕获回执写 `presentationAuditVersion: 2`；[离线复核](../src/skill/macro-bundle.ts)按版本重放原展示审计与新增检查，旧回执仍按生成时的 V1 规则验证原声明，同时运行当前 V2 检查并报告新发现，不能把旧回执升级为当年已执行 V2。合成反例在 JSON 总分正确时仅改组件表或数据质量，`/skill audit` 返回 `humanReadablePassed=false`；旧版回执缺表仍保留归档完整性通过，但显示新的两项警告。

[本次公开捕获](../output/macro-presentation-v2-2026-09-19.json)经隔离生产 CLI handler 下载固定 17 文件、探测公开 ETF、运行原 Python 脚本并记录同次九只 ETF 价格。脚本退出 0，九只 ETF 均有 600 行；输入审计和六项打分审计均为空，结构化综合分仍为 58.5。V2 展示审计只有原上游 `FMP API (0 calls)` 对 `yfinance_only` 的来源冲突；六行组件、总分、信号数与质量没有新冲突。离线包复核 `passed=true, violations=[]`，`warnings=[markdown-source-label-conflicts-with-json]`；记录 SHA-256 为 `D2EBA12B9C2946452C41C752A4F5AC0B520588C5A10CCD9652FAC1209B292C73`。真实运行不包含 FMP 调用、账户或模型请求；不能把结构化复算通过说成上游 Markdown 全文或指导语通过。

复跑命令：

```powershell
bun test src/skill/macro-report-audit.test.ts src/skill/macro-audit-command.test.ts src/skill/macro-bundle.test.ts
bun run scripts/recheck-macro-bundle.ts --record output/macro-presentation-v2-2026-09-19.json
bun run scripts/check-macro-skill.ts --output output/macro-presentation-next.json --network --run-public-script --capture-inputs
```

以上公共检查不覆盖 FMP/Treasury、其它技能、供应商历史修订或最终模型语义，F23/F24 保持部分完成。

最终全量 `bun run test` **1799/1799、220 文件、23087 次断言**，日志 `%TEMP%/ohq-macro-presentation-full-final-2026-09-19.log`；根与捕获脚本 strict typecheck、test fence、architecture（0 baseline violations）、build（3038 modules）通过。源码 CLI 对新包返回 `bundlePassed=true`、`humanReadablePassed=false`，退出码 1；更新文档的本地文件链接与改动行尾空白检查通过。

## 2026-09-19：冲突原报告之外的 JSON 审计摘录

第三方 Markdown 的 FMP 标题仍有误，先前 `/skill audit` 只能报错并提示用户自行翻 JSON。[审计摘录](../src/skill/macro-readable-summary.ts)现在仅从通过结构化算术检查的 JSON 构造来源声明、综合分、区间、六项分数与权重、信号数和数据质量；不复制原报告的投资指导。固定验证包须先通过其文件哈希、版本与算术审计才会携带 `data.summary`；带原价归档的包还须通过输入和评分重算。普通双文件模式只保证 JSON 内部算术，输出文字将来源明确称为 `Source claim`，并继续提示未验原 ETF 原价及安装版本。

对[同一 V2 公开验证包](../output/macro-presentation-v2-2026-09-19.json)，生产源码 CLI 的 JSON 模式返回 `bundlePassed=true`、`humanReadablePassed=false`、`summary.compositeScore=58.5`、六条组件和 `summary.reportedSource=yfinance`；命令因原 Markdown 冲突仍退出 1。故意改坏结构化组件贡献时不输出摘录，防止把错误 JSON 包装成可信摘要。三文件定向 **18/18、45 次断言**；F23/F24 的 FMP/Treasury、上游全文、其他技能与模型解释缺口不因此消失。

最终全量 **1799/1799、220 文件、23091 次断言**，日志 `%TEMP%/ohq-macro-readable-summary-full-2026-09-19.log`；typecheck、test fence、architecture（0 baseline violations）、build（3039 modules）通过。普通 CLI 文字模式已核对失败标题与后续六项摘录同屏输出，返回码保持 1。

## 2026-09-19：宏观审计失败回执的私有输入隔离

`/skill audit macro-regime-detector` 读取用户指定文件时，旧的缺文件异常会把完整本地路径写入终端回执；普通报告的算术审计失败时，还会原样输出未经核验的 JSON `data_source`、`data_mode` 和分数字段。现在文件、解析和验证异常只显示固定失败类别（如 `missing-file`、`invalid-json`），不回显异常正文；来源、模式与综合分仅从通过结构化审计的摘录进入消息和 JSON 结果。含私密标记的缺失路径、坏 JSON 和伪造字段反例均验证不泄露，生产 `--json -c` 路径也检查了缺文件回执。

既有固定公开验证包仍返回 `bundlePassed=true`、`humanReadablePassed=false`、`markdown-source-label-conflicts-with-json` 与已核对的六项分数，退出码保持 1。此修复只覆盖宏观审计命令的失败回执；不修正第三方原 Markdown，不代表其它技能的私有输出或完整模型解释已验收，F23/F24 保持部分完成。

最终全量 **1845/1845、222 文件**通过，根 typecheck、architecture（0 baseline violations）、build 与 `git diff --check` 通过；新增 PRD 本地锚点已核对。日志 `%TEMP%/oh-my-quant-full-test-macro-audit-redaction.log`。

## 2026-09-19：仓位计算报告的私有只读审计

[固定文件清单](../src/skill/position-manifest.ts)覆盖 catalog 固定提交 `a2506fd1bab662723fb7142734320fef23fc48fa` 的 `SKILL.md`、方法参考、requirements、主程序及两项 Python 测试，共六个文件。`/skill info position-sizer --check` 复用本地文件探测器核对 SHA-256；缺文件、本地改动或未执行检查时，`reviewed-script-files` 均不满足。它只证明安装目录与已审阅字节一致，不证明 Python 可运行、公式适合用户、账户输入安全或最终建议正确。

当前安装仓库 HEAD 为 `b5566100dfad877f81fbad172293e2195f451919`，与 catalog pin 不同。生产检查实际报告 requirements 缺失，入口、参考、主程序和测试内容也不匹配，因此精选模式继续 `blocked`；本实现不修改或回滚用户 checkout。两次提交的差异包括新版取消 Decimal 小数股路径、requirements 文件及一部分边界测试，所以不能只凭仓库名称一致把它视作已审阅版本。

`/skill audit position-sizer --json REPORT.json --markdown REPORT.md` 是独立、本地、只读的报告审计。它重新计算 fixed fractional、ATR、Kelly budget、Kelly shares、最大仓位约束、最终股数/仓位价值/风险和小数股精度，并核对 Markdown 的输入参数、活动公式、约束、最终结果及风险百分比。JSON 算术通过但 Markdown 冲突时，命令整体失败；固定版 Kelly-shares JSON 没有保留 win rate、average win 和 average loss 三项原始输入，因此可核对已有中间量，却不能证明输入绑定，整体也保持失败。

命令只返回审计范围、布尔结果和固定 violation code，不回显文件路径、账户值、报告正文或底层解析错误；两个报告文件各限制 256 KiB。缺文件、超限和格式错误映射为稳定失败分类。它不会启动技能、模型或行情，不读取设置，不写研究记录，也不将报告内容加入 Agent 上下文；用户仍须主动给出两条本地路径。该入口没有满足 `private-output-authorization`，因此审计成功也不会把 position-sizer 放入模型索引。

本轮从 catalog 固定 Git 对象提取原始 Python CLI，在 TEMP 以合成账户 `100000`、入场价 `155`、止损价 `148.50`、风险 `1%`、最大仓位 `10%` 运行，原程序生成 JSON 与 Markdown；随后生产 one-shot CLI 审计返回退出 0，算术、输入绑定和人类可读三项均通过，回执未包含账户值或所选路径。该验证只覆盖合成 fixed-fractional 样本，不包含真实账户、真实交易、模型调用或用户本地新版脚本。专项回归 **44/44、627 次断言**，最终全量 **1865/1865、223 文件、23424 次断言、228.21 秒**通过，日志 `%TEMP%/ohquant-position-audit-final-20260919.log`；F23/F24 保持部分完成。

```powershell
bun run src/index.ts -- --json -c "/skill info position-sizer --check"
bun run src/index.ts -- --json -c "/skill audit position-sizer --json C:\private\position-sizing.json --markdown C:\private\position-sizing.md"
bun test src/skill/position-report-audit.test.ts src/skill/macro-audit-command.test.ts src/skill/catalog.test.ts src/runtime/command-preflight.test.ts src/runtime/command-help.test.ts src/runtime/skill-readiness.test.ts
```

## 2026-09-19：市场日历固定闭包与隔离执行

[固定文件清单](../src/skill/environment-manifest.ts)覆盖 market-environment-analysis 的入口、两份参考、精确 requirements、两份 Python 实现及三份上游测试，共九个文件。只有 `exchange calendar helper` 模式新增 `reviewed-script-files` 要求；依赖 web-search 的 `market research` 模式不借日历文件检查获得资格。`/skill info market-environment-analysis --check` 会同时检查 Python 元数据和九项内容，但仍不执行第三方代码。

当前安装仓库 HEAD `b5566100dfad877f81fbad172293e2195f451919` 与 catalog pin 不同。生产检查实际显示 pandas-market-calendars 未安装，固定版 requirements、`_market_calendar.py` 和契约测试缺失，入口、`market_utils.py` 及剩余测试内容也已改变，因此两个模式均保持 `blocked`。新版取消了固定版的 aware timestamp、节假日、午休、DST、提前收盘和有限搜索契约；本实现不修改或回滚用户 checkout。

为验证固定脚本本身，从 catalog Git 对象提取九个文件到 TEMP；生产文件探测返回 `reviewed-script-files: available`。首次在临时 venv 安装完整依赖时，Windows Application Control 阻止新下载的 pandas DLL 加载，上游结果为 **23/48**，25 项失败共享同一环境根因，未当作脚本失败或通过证据。随后复用本机受信任的 pandas 3.0.3 / numpy 2.4.4，只在隔离路径安装 pandas-market-calendars 5.2.2 及 pip 当前解析的纯 Python 传递闭包，固定版上游测试 **48/48** 通过。

同一环境实际运行 `market_utils.py --as-of 2026-07-06T14:00:00Z`，输出东京已收盘、纽约交易中，东京 15:30 收盘并显示午休，伦敦/纽约分别使用 BST/EDT；`--as-of 2026-07-06` 以退出码 2 拒绝无时区日期。工程专项 **25/25** 验证仅有包元数据时 Session 仍拒绝调用，文件回执也通过后才开放日历模式；最终全量 **1866/1866、223 文件、23445 次断言、229.38 秒**通过，日志 `%TEMP%/ohquant-calendar-manifest-final-20260919.log`。

该结果证明固定提交在这组依赖上的日历契约、CLI 样本和运行时资格刷新，不证明未来交易所日历更新、其它 pandas/exchange-calendars 组合、市场实时行情或 web-search 研究质量。生产本机没有安装顶层包且文件不匹配，不能用隔离测试把当前安装标为可调用；F23/F24 保持部分完成。

```powershell
bun run src/index.ts -- --json -c "/skill info market-environment-analysis --check"
python -m pip install pandas-market-calendars==5.2.2 pytest
python -m pytest scripts/tests -q
python scripts/market_utils.py --as-of 2026-07-06T14:00:00Z
```

## 逆向确认脚本检查

`/skill info technical-analyst --check` 同时取得 Python/包版本，并由 [file-probe.ts](../src/skill/file-probe.ts) 核对固定提交的十文件闭包：入口、报告模板、两份参考、requirements、两个脚本和三项上游测试。文件清单及 SHA-256 集中在 [technical-manifest.ts](../src/skill/technical-manifest.ts)；仅将 CRLF 转成 LF，其他内容变化均不忽略。检查每文件最多读取 256 KiB，拒绝目录、超限文件及解析后越出技能目录的路径；不导入或执行代码、不读取凭证、不联网。

缺文件为 missing，内容不同或不可读为 unverified，十个文件完全匹配才使 reviewed-script-files 为 available。证据绑定工作目录、入口路径和文件清单，仅保存在进程内；复查覆盖旧结果并更新会话修订键，取消不发布。普通列表和模型请求不自动读文件；修改或升级后须重新 `--check`，这不是文件监控或执行时防篡改。运行中的任务继续持有原快照。

审阅固定提交的 [CLI 源码](https://raw.githubusercontent.com/tradermonty/claude-trading-skills/a2506fd1bab662723fb7142734320fef23fc48fa/skills/technical-analyst/scripts/check_weekly_price_action.py) 确认：外部 Python 包是 requests，本地导入是相邻 weekly_price_action；其余导入来自标准库。有有效拥挤方向后，CLI 要求 `--api-key` 或 `FMP_API_KEY`，请求 FMP `stable/historical-price-eod/full`，没有用户 CSV 输入替代路径。key 缺失时退出 1，不能笼统宣称所有失败都产生 INSUFFICIENT_DATA 报告。COT detector JSON 可选；若使用，则还有日期/方向一致性检查。

[weekly_price_action.py](https://raw.githubusercontent.com/tradermonty/claude-trading-skills/a2506fd1bab662723fb7142734320fef23fc48fa/skills/technical-analyst/scripts/weekly_price_action.py) 仅导入标准库 date，负责周线重采样、反转/失败突破与延续检查和结论汇总。十文件匹配证明当前闭包对应已审阅版本，不证明 FMP 凭证有效、真实接口可访问、证券覆盖完整或分析结论适合作为交易依据。因此 FMP_API_KEY 与 network:fmp-eod 保持 unverified，默认宿主不会开放此模式；普通图表模式的图片输入缺口也独立保留。

2026-09-19 从固定 Git 对象提取全部十项后，生产 `checkSkillFiles` 返回 available；在 TEMP 隔离目录中使用本机受信任 Python/requests 运行上游测试，**123/123** 通过（1.60 秒）。覆盖 FMP HTTP 替身、缺 key 与脱敏、as-of 截止、价格字段回退、detector JSON 的损坏/过期/未来/中性输入、周线重采样、反转/失败突破/延续抑制、结论与 CLI JSON/Markdown 契约。HTTP 均为测试替身，未携带真实 FMP key 或请求真实端点。

当前生产安装是不同的新 HEAD：`SKILL.md` 已变化，checklist、requirements、两个脚本和三项测试等八项缺失。实际 `/skill info technical-analyst --check` 因 reviewed-script-files missing 保持 blocked；图表模式还因当前文本入口没有图片输入而 blocked。固定版本的测试通过不能提升当前安装态，也不等于真实 FMP 网络或模型语义验收。

工程专项 **26/26、241 次断言**验证十文件清单、64 位十六进制指纹、模式隔离，以及 Session 中仅在文件回执齐备后开放逆向脚本模式；最终全量 **1867/1867、223 文件、23460 次断言、229.45 秒**通过，日志 `%TEMP%/ohquant-technical-manifest-final-20260919.log`。

2026-09-15 的生产 CLI 实测使用临时设置和从固定公开 URL 下载的三个文件，依次检查原版、改动 helper、删除 helper；文件项分别为 available / unverified / missing，FMP 始终未验证。该旧记录见 [验证记录](../output/technical-skill-verification-2026-09-15.json)，用于保留三文件阶段的历史证据。复跑旧验证：

```powershell
bun run scripts/check-technical-skill.ts --output output/technical-skill-new.json
```

该旧验证工具会从 GitHub 下载三个公开源文件到 TEMP，并执行真实 Python 元数据检查；不会执行下载的技能代码。输出必须为新路径，结束后清理临时目录。当前调用资格以 catalog 的十文件闭包为准。

## 验证

```powershell
bun test src/skill/readiness.test.ts src/skill/python-probe.test.ts src/runtime/skill-readiness.test.ts
bun test src/skill/network-probe.test.ts src/runtime/command-preflight.test.ts
bun test src/agent/test/session-dependencies.test.ts src/skill/catalog.test.ts
bun test src/skill/file-probe.test.ts src/runtime/skill-readiness.test.ts
bun test src/skill/etf-network-probe.test.ts src/runtime/skill-readiness.test.ts src/runtime/command-preflight.test.ts
```

覆盖缺包、版本不足、精确版本、预发布版本、未知网络、输入缺项、分模式资格、同名来源隔离、取消及迟到检查。真实 Pi 与本地 HTTP/SSE 验证拒绝前无模型/日志副作用、原会话激活日历模式、限定资料收集，以及无活动 shell 时撤销资格。

[本机检查记录](../output/skill-readiness-verification-2026-09-14.json) 来自生产 `/skill info --check` handler 和隔离技能 fixture：Python 3.14.3、requests 2.34.2、yfinance 1.4.0，缺少 pandas-market-calendars，因此环境分析技能为 blocked。该记录证明本机检查与诊断链，不证明真实第三方工作流成功。完整网络探测、脚本效果和终端连续任务仍由 F23/F24 验收。

2026-09-15 的[公开网络实测](../output/skill-network-verification-2026-09-15.json)经生产 CLI handler、临时设置/技能 fixture、实际 Python 3.14.3 与 requests 2.34.2，通过固定 CSV 检查，最新数据为 2026-09-11；观测时间为 `2026-09-14T19:15:18Z`，北京时间 9 月 15 日。`requirements-met` 仅针对声明的公开 CSV 模式，不代表第三方脚本执行或财务结论验证。复跑 `bun run scripts/check-skill-network.ts --output output/skill-network-new.json`，会访问固定公开站点，输出必须为新路径；隔离 fixture 结束后清理。

确定性测试使用模拟探测回执验证过期/解释器隔离、失败/取消/晚到，并在真实 Pi + localhost/SSE 会话内验证检查前不写研究日志/不请求模型、检查成功激活同一会话、失败复查撤销资格。另用实际 Python 与内存 HTTP 替身执行 CSV 校验，覆盖 403、HTML、坏日期、陈旧/未来、NaN、截断/重复指标及超大响应；不需要 requests 包或外网，仅在没有可发现 Python 时跳过该项。

公开 CSV 切片验证：Windows / Bun 1.3.14，**1431 pass / 0 fail，174 文件、18537 次断言，110.41 秒**；本机实际执行了 Python CSV 用例，无此项跳过。typecheck、architecture（0 baseline violations）、build（2965 modules / 6.72 MB）、独立验证脚本 strict typecheck、构建后 `/skill --help` 和本地文档链接检查通过。日志 `%TEMP%/whyj-skill-network-final.log`；公开实测 JSON 的 SHA-256 为 `952bd2040e4d308c230cc27519b7f08a91033ad181a3083c0e83631351a32b5f`。首次全量中的 OAuth 过期锁竞争失败已定位并修复，过程和专项复跑保留在 [OAuth 文档](./model-oauth.md)。F23/F24 仍有其他网络、脚本依赖、输出和完整任务验收缺口。

逆向文件检查切片验证：同一 Windows / Bun 1.3.14，新增 6 项回归覆盖 CRLF、修改/缺失、隔离/取消、超限以及同一 Pi 会话拒绝调用且无模型/日志副作用；全量 **1437 pass / 0 fail，175 文件、18569 次断言，112.38 秒**，日志 `%TEMP%/whyj-technical-files-full.log`。typecheck、architecture（0 baseline violations）、独立验证脚本 strict typecheck 通过；帮助文案随后同步，相关 19 项回归、重新构建（2966 modules / 6.73 MB）与构建后帮助查询通过，105 个本地文档链接有效。生产 handler 三场景记录 SHA-256 为 `90666aa0937663c0ac6a226bc4303624501f433c2f5f4a5f383e56e91552601b`。这些测试不构成 FMP 实际访问或第三方量化算法的验收。

ETF 与宏观文件切片验证：Windows / Bun 1.3.14，固定九 ETF 的模拟与实际 Python 检查、解释器/期限/取消/晚到、17 文件缺失拦截及同一真实 Pi 合成会话无模型/日志副作用通过。全量 **1589 pass / 0 fail，189 文件、21187 次断言，144.38 秒**，日志 `%TEMP%/whyj-macro-full-2026-09-15.log`；typecheck、architecture（0 baseline violations）、独立验证脚本 strict typecheck 和构建（2983 modules / 6.78 MB）通过，更新的五份文档本地链接有效。公开九 ETF 观察保存在验证 JSON，观察五分钟后已过期；工程回归与一次公开脚本成功均不证明 FMP 权限、全部技能可运行或宏观结论正确。
