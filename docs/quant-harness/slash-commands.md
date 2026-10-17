# WhyJ Quant Slash Command 参考

Slash Command 提供设置、诊断、研究会话、观察组合、skill 和报告浏览入口。压缩、诊断、技能安装或运行可能调用模型/网络；帮助查询只读。量化研究直接输入自然语言，由 agent 选择行情与 Quant tools。

Shell 层级使用 `whyj --help`、`whyj --version` 或 `whyj --json --version` 查询入口和当前内置 Pi 包版本；`whyj -c "/help"` 可离线列出 slash 命令。未知根级参数、单独 `--json`、缺值的 `-c`/`--command` 和重复/混合 `--version` 均返回参数错误，不进入交互界面。版本与帮助查询不读取设置或发送模型/行情请求。

私有账户年报可用非交互 `whyj private-annual` shell 子命令，也可在 `/artifact` 的 TUI 面板按 `P` 打开本地导出向导。两者都要求用户显式指定完整规范化历史文件和新私有 HTML 路径，参见[文件终端导出](./annual-reports.md#显式文件终端导出2026-09-15)和[交互面板导出](./annual-reports.md#交互-tui-私有导出2026-09-15)。它不加入 Composer 或十个 slash 命令，也不进入默认 Agent 年报。

显式本地模拟盘可用 `whyj paper init|account|submit|lookup|cancel` 文件终端命令，或在已有私有账户上运行 `whyj paper agent --root ABS --account ID`。后一条是独立 paper-only Agent 会话，提交/撤单由终端按完整意图审阅；账户和订单上下文会发给已配置的模型服务，转录写在所选私有根目录下。默认研究 Agent 与十个 slash 命令不提供下单工具，见[模拟盘 Agent](./execution.md#显式私有-paper-agent2026-09-16)。
外部 Alpaca Paper 走 `whyj alpaca-paper account|submit|lookup|cancel` 的独立文件终端和 paper 凭证；它也不进入默认研究 Agent 或 slash 命令，见[外部适配器](./execution.md#alpaca-paper-外部适配器2026-09-16)。

## 一级命令目录

`src/runtime/workspace/command-catalog.ts` 是一级名称和英文描述的单一真源。Composer 建议、TUI Help、`/help` 与 `whyj --help` 必须展示同一组描述。

| 命令 | 统一描述 | 执行结果 |
|---|---|---|
| `/compact` | Compact research session context | 压缩当前 session 上下文；可附带本次压缩的关注点。 |
| `/resume` | Resume saved research sessions | TUI 中浏览并恢复 JSONL session；非 TUI 中列出或按 ID 恢复。 |
| `/portfolio` | Manage observation portfolios | 创建、重命名、删除组合，以及增删标的。 |
| `/config` | Configure models and research data | TUI 中打开 Settings；非 TUI 中输出规范化设置摘要。 |
| `/doctor` | Check model and market data readiness | 未配置时进入配置流程；已配置时诊断模型、工具链和数据源。 |
| `/skill` | Download, load, and run skills | 选择、安装、移除、查看或通过当前 agent session 运行 skill。 |
| `/mcp` | Choose and manage MCP presets for Pi | 选择 MCP 预制项，调用 Pi 接口添加或移除配置，或导出模板。 |
| `/help` | Browse commands and shortcuts | TUI 中打开 Help；非 TUI 中输出命令目录和快捷键。 |
| `/clear` | Reset the current research session | 清空对话显示并重置当前 agent/session runtime。 |
| `/artifact` | Browse and restore research reports | 浏览有效报告；选中后恢复来源 session，并在浏览器打开报告。 |
| `/exit` | Exit WhyJ Quant | 退出 WhyJ Quant。 |

一级目录只有 `name` 和 `desc`，不承载二级菜单、示例或说明段落。参数只在命令已经明确后由 parser/handler 处理；composer 不为 `/artifact` 展开任何二级选项。

查看用法可输入 `/help portfolio`、`/help /portfolio` 或 `/portfolio --help`（也支持 `-h`）。所有一级命令均支持；帮助在业务处理之前返回，即使是 `/portfolio delete Core --help` 也不会修改组合。带值的错误帮助参数会返回错误而不会执行原操作。TUI 将详细用法显示在对话区，Help 面板中可按 `?` 查询选中命令；没有安装技能时 `/ski` 仍可补全为 `/skill`。

非交互示例：`whyj --json -c "/clear --help"`，成功结果含 `data.name`、`data.desc` 和 `data.usage`。命令用法在读取或迁移配置前处理，损坏设置不会阻止此查询。查看帮助不等于执行权限、数据依赖或网络可用性检查。入口取舍见[功能发现博客](../blog/11-discoverable-interactions.md)；参数行为以本页为准。

参数采用 `--name value`；含空格的名称或路径用引号包住整个值。通用命令拒绝未知选项、重复选项和错误的参数数量，失败时提示查询用法；例如不存在 `--dry-run`，`/portfolio delete Core --dry-run` 会报错且不删除。配置子模式和工具端点继续执行各自的参数校验。当前 slash 不提供 `--name=value` 或 `--` 结束选项语法。

单引号或双引号包住的参数是字面值，即使内容为 `--help`、`-h` 也不会变成选项。例如 `/portfolio create "--help"` 创建该名称，`/portfolio delete "--help" --help` 仅查看用法；`--model "--help"` 把字符串传作模型 ID，后续仍须通过模型校验。负数和证券代码保持原文本，具体类型由端点 schema 转换。单词内部的英文撇号与 Windows 反斜杠保持原样；含空格的 Windows 路径可整体加引号，末尾反斜杠不会吞掉闭合引号。

引号必须闭合，闭合后须有空白或输入结束；不支持引号片段拼接或反斜杠转义引号。输入 `/portfolio create "Core"extra` 或缺少结束引号会先报错，不创建组合、不读取配置或请求模型；即使同时包含 `--help` 也先报告词法错误。名称中需要一种引号时，可用另一种引号包围整个值。该语法属于 slash 参数解析，不执行 shell 替换。

## 命令行为

### `/compact [focus]`

等待当前 agent idle 后压缩 session tree，并输出保留范围、token 和量化上下文摘要。`focus` 是可选的自然语言压缩指示。上下文已经足够小时返回说明，不改写 session。

### `/resume [sessionId]`

- TUI：`/resume` 打开有效 JSONL sessions 列表，`Enter` 恢复选中项。
- 非 TUI：无参数时列出 sessions；传入 `sessionId` 时直接恢复。
- `/resume --task`：只读查看活动 Quant session 当前分支的任务、验收条件、证据和失败原因。TUI 方向键滚动、Enter 刷新本地核验、Esc 关闭；模型输出期间也可查看，不请求模型或改写会话。必须单独使用该参数；无活动 session 的 one-shot shell 调用报错。非 TUI 宿主提供活动 session 时返回文本及同一状态 data。
- `/session` 仅作为旧输入兼容别名，不出现在公开目录、建议或文档命令表中。

### `/portfolio`

TUI 打开组合编辑器：方向键选择，Enter 创建/打开/保存，Esc 返回或取消。可创建空组合、重命名、增删标的，删除整个组合时在面板内确认。每次修改即保存并刷新 Overview。

非 TUI 或需要直接输入时使用：

```text
/portfolio create Core
/portfolio add Core 000001.SZ 平安银行
/portfolio add Core 022364.OF 永赢科技智选A
/portfolio add Core AAPL Apple
/portfolio add Core 00700.HK 腾讯
/portfolio list
/portfolio remove Core AAPL
/portfolio rename Core 长期观察
/portfolio delete 长期观察
```

GROUP 可用组合名称或 list 输出的 ID；名称有空格时用 ID 引用。开放式基金请带 `.OF`，A 股建议带交易所后缀；`.SH/.SZ/.OF` 不会因为数字相同被合并。支持空组合和同一标的加入多个组合，删除一个组合不移除其他组合的成员。

只保存代码、名称、instrument 和分组关系，不保存持仓金额、仓位或私人净值。启动、刷新、普通 `/portfolio` 均不读取旧 holdings 文件。只有显式 `/portfolio import` 才列出旧文件，`/portfolio import <name|file|index>` 才追加导入一个组合；导入不覆盖现有自定义组合。

### `/config`

TUI 中打开 Settings，统一编辑 Agent Runtime、Research Data 与 Workspace Experience。非 TUI 中只输出脱敏摘要和配置路径。字段、默认值与迁移规则见 [配置参考](./configuration.md)。

`/config --extensions list` 在命令回执中查看当前构建的扩展版本、声明、启用状态和诊断，不打开 Settings。`/config --extensions enable|disable|reload <id>` 管理指定扩展；当前默认 ID 是 `whyj.core`。启停保存到 `disabledExtensions` 并更新同一研究会话，重载重新初始化当前编译模块；不安装 npm 包或加载任意路径。禁用 core 会移除后续模型请求中的数据/量化/shell 工具，宿主 `research_task` 和本地管理命令仍可用。

查看可在运行中使用，更改须等模型准备/执行和其他命令结束；忙时明确提示重试。设置冲突会报告失败并尝试恢复原启停状态，不覆盖其他设置。单次调用 `bun run src/index.ts -- --json -c "/config --extensions list"` 不启动模型，返回 `data.extensions` 与 `data.unavailable`；逐项检查 enabled/configuredEnabled/diagnostics，操作失败为非零退出码。只接受上述动作和精确参数数量。开发接口与测试见 [扩展宿主](../agent-runtime/extensions.md)。

`/config --pi list|preview|apply` 显式读取并导入 Pi 的选定模型连接，不打开 Settings。可带 `--from "目录"`；preview/apply 还可带 `--provider ID`、`--model ID`，apply 必须带 preview 返回的 `--review TOKEN`。预览不导入，源文件/环境值/本地设置变化使令牌失效，失败保留现有设置；API-key 导入快照，所选 provider 支持且凭证有效时 OAuth 建立指向 Pi auth.json 的本地链接，不复制 token。后续刷新可能在 Pi 文件锁下更新该账号，Sign out 只移除 WhyJ 链接；不支持字段不会静默转成其他认证。preview/apply 不执行凭证命令或网络验证。具体映射与使用例见 [Pi 配置导入](./configuration.md#pi-import)。

Pi 与 extensions 子模式不能混用。Pi 选项值及扩展 ID 不接受空字符串或纯空格；`--review` 仅用于 apply。无效组合在读取配置、切换活动状态或执行管理操作前返回错误，TUI 在输入区提示查询用法。裸 `/config --extensions` 仍等同 list。

### `/doctor [--phase model,tools,data]`

首次运行且缺少凭证时提供配置入口；其余情况执行真实 readiness 检查。可用 `--phase` 限定诊断范围，只接受 model、tools、data 的逗号列表，忽略大小写并去重。仅省略参数才采用默认范围；缺值、空值、未知值或混入非法项均报错，不开始诊断。Shell 的 `whyj doctor --phase data` 使用相同规则。输出可以包含认证来源和脱敏指纹，但不得包含完整 secret。

TUI 的 Configure 共用模型与数据编辑器；数据经 `Check data → Save verified` 保存，`Run diagnostics` 只检查已保存设置。关闭 Doctor、进入配置或重跑会取消旧检查；迟到结果不能重新打开面板。具体字段及取消层级见 [配置参考](./configuration.md)。

Doctor 报告支持 ↑/↓ 逐行、PageUp/PageDown 翻页、Home/End 到首尾；摘要与操作提示常驻，长错误和修复建议可完整查看。滚动不执行检查；`r`/Enter 重跑全部，`m`/`t`/`d` 重跑单阶段，`c` 配置，Esc 关闭。回归入口见 [Doctor 导航](../../src/tui/test/doctor-navigation.test.ts)。

### `/doctor --tool NAME --market MARKET [--provider NAME] [--endpoint NAME]`

检查指定工具的一条数据路由；与 `--phase` 分开使用。其余参数直接使用端点的 API 名称，代码/日期保留字符串；参数含空格时可整体加引号，或使用 TUI 的 JSON 参数编辑器。此入口复用 `runtime/data/tool-probe.ts`，不启动模型、不执行原工具的计算/存储/shell 副作用。

数字参数必须显式提供非空数值，并满足所选端点 schema；例如单写 `--timeout` 或 `--timeout ""` 会在 Python 依赖检查和数据请求前失败。合法数字按数值传递，基金代码 `000001` 等字符串保留前导零；动态端点声明的 Boolean 参数仍按原契约处理。

日线、新闻和汇率路由的 `--start` / `--end` 使用真实公历 `YYYY-MM-DD`，且起点不能晚于终点。无效日期或倒置窗口在凭证、Python 与供应商请求前返回 `invalid-input`；端点签名另有日期格式时，以该端点的 schema 为准。

```text
/doctor --tool search_symbols --market A --provider tushare --endpoint stock_basic --keyword 平安银行
/doctor --tool akshare_fund_fund_open_fund_info_em --market Fund --symbol 270042 --indicator 单位净值走势
/doctor --tool fetch_index_rows --market A --endpoint index_stock_info
/doctor --tool fetch_bars --market US --provider financial-datasets --symbol AAPL --start 2025-01-06 --end 2025-01-17
```

非交互调用用 `bun run src/index.ts -- --json -c "/doctor --tool …"`。返回 `data` 为 `ToolProbeResult`：tool/provider/endpoint/market/params、status、rowCount、observedAt、durationMs 和 scope。响应检查通过才有 `ok: true` / 退出 0；空结果、依赖/权限失败、非法输入、超时或取消都失败。通过只证明这次响应，不能推定其他端点、参数或实时性。无缓存或设置写入；终端检查编辑器也不保存长期权限。

### `/doctor --tool NAME --market MARKET --schema`

先查看当前构建声明的端点与参数，再决定是否执行数据检查。`--schema` 是无值开关，市场必须显式提供；可用 `--provider`、`--endpoint` 筛选，不接受 `--phase` 或端点业务参数。未知工具、无对应路由或非法参数返回失败，不回退为实际检查。

```text
/doctor --tool fetch_bars --market US --schema
/doctor --tool fetch_bars --market US --schema --provider financial-datasets
/doctor --tool akshare_fund_fund_open_fund_info_em --market Fund --schema
/doctor --tool fetch_index_rows --market A --schema --endpoint index_stock_info
/doctor --tool fetch_index_rows --market A --schema --endpoint index_zh_a_hist
/doctor --tool fetch_index_rows --market A --schema --installed --endpoint index_zh_a_hist
```

多路由时文本列出端点，筛选到一路时显示该参数 JSON schema。`whyj --json -c "/doctor --tool … --schema"` 的 `data.kind` 为 `tool-probe-schemas`、`scope` 为 `static-declarations`；`routes` 包含所有匹配路由的 provider、endpoint、parameters 和 parameterContract，`parameterRules` 为实际检查器共用的名称、长度、标量值及控制字符规则。指数路由另含 `signatureSources.akshareIndex`，标明打包签名的 AKShare 版本。查询成功的退出码 0 仅表示找到声明。

`declared-parameters` 使用已声明的字段类型、required 和额外字段规则；仍可能有日期/标的等后续语义检查。当前 92 个白名单指数端点的字段、默认值和说明来自本机 AKShare 1.18.63 的函数签名及 docstring，经 [生成器](../../src/runtime/dev/generate-akshare-index-signatures.py) 写入[静态声明](../../src/runtime/data/akshare-index-signatures.generated.ts)。例如 `index_stock_info` 没有参数，`index_zh_a_hist` 接受 symbol、period、start_date、end_date；未声明字段在 Python/网络前拒绝。当前注册表已无 `scalar-forwarding` 路由。查询本身不加载 Python，也不验证本机包版本、凭证、权限、数据覆盖或当前扩展启用情况；包升级后须用同一解释器运行生成器并重新验证。未覆盖的参数语义仍以 [AKShare 官方指数文档](https://akshare.akfamily.xyz/data/index/index.html)和实际端点响应为准。

日线、新闻和汇率的 `start` / `end` 字段现在声明 `YYYY-MM-DD` 模式及本构建的 `whyj-daily-date` 公历校验；单独消费 JSON schema 的外部程序需要实现这个自定义 `format`。跨字段的起止顺序由实际探测入口检查，schema 字段本身不表达此约束。格式正确不证明供应商有该时段的数据。

函数说明中 19 处完整 `choice of` 列表已经进入字段 `enum`，包括 `index_zh_a_hist` 的 daily/weekly/monthly、`index_zh_a_hist_min_em` 的 1/5/15/30/60 和跨行说明的 Drewry 航运指数选项。日线端点的 `start_date`/`end_date` 要求八位 `YYYYMMDD`，分时端点要求 `YYYY-MM-DD HH:mm:ss`。[语义模块](../../src/runtime/data/akshare-index-semantics.ts)把实际日历有效性写为字段 `format`；探测还比较包括函数默认值在内的起止日期，倒置窗口在 Python 前失败。自定义 `format` 由本构建的 TypeBox 校验器解释，单独消费 JSON schema 的外部程序须实现同一规则。上述检查不证明指数代码存在、供应商接受其他别名或数据覆盖；分时接口只能返回有限的近期窗口，格式合法也可能没有旧数据。其他没有完整枚举说明的字段仍按原字符串 schema 处理。

此入口在读取设置与切换活动之前返回。损坏配置仍可查看 schema，TUI 显示查询结果而不打开/取消 Doctor；CLI 不生成 insight 缓存或研究文件。无参数 schema 查询只读；去掉 `--schema` 并填写业务参数才会执行响应检查。

需要核对运行环境时，显式添加无值开关 `--installed`。它仅支持 AKShare 白名单指数路由；混合 provider 的查询先用 `--provider akshare` 或 `--endpoint` 限定。查询使用行情请求同一 Python 选择器导入本地 AKShare，读取所选函数的签名和说明，不访问数据端点、模型、凭证或设置。普通 `--schema` 仍只读打包声明，不启动 Python。

安装版回执的 `scope` 为 `installed-signatures`，`signatureSources.akshareIndex` 为实际包版本；`comparison` 分别给出 `packagedVersion`、`versionMatches`、`matchesPackaged` 与 `changedEndpoints`。版本不同但字段相同会分别标记，避免把版本号变化误作参数变化。缺少 Python/AKShare、函数或不支持的参数签名会返回失败；取消不继续显示旧结果。安装版 schema 用于诊断漂移，实际端点探测仍使用当前构建的静态声明；更新依赖后可运行[生成器](../../src/runtime/dev/generate-akshare-index-signatures.py)并复核探测。签名一致也不证明参数可选值、响应内容或权限。

### `/skill`

`/skill` 查看已加载技能；`/skill catalog` 或不带名称的 `/skill install` 先展示选择，不下载。使用 `/skill install <name> [name ...]` 按需下载并加载，`/skill install --all` 才选择整个预制合集。`/skill remove <name> [name ...]` 从 JQ 加载列表中移除，保留共享仓库文件和本地修改；以后可按名称恢复。仍支持 `/skill install <owner/repo>`、`/skill info <name>`、`/skill reload`、`/skill run <name>` 和 `/skill:<name>`。Pi 负责技能扫描与模型索引。详细规则见 [Skills 文档](./trader-skills.md)。

### `/mcp`

`/mcp` 列出五项预制服务与当前配置；`/mcp info <name>` 查看依赖和官方链接。`/mcp install <name> [name ...]` 和 `/mcp remove <name> [name ...]` 复用 Pi 的配置接口，默认编辑 Pi 用户目录的 `mcp.json`；加 `--local` 选择当前项目的 `.pi/mcp.json`。同名已有配置保留。`/mcp export <name> [name ...]` 仅输出所选模板 JSON，不读取或导出本地凭证。

安装表示添加连接配置，实际连接、认证与 stdio 包启动交给 Pi；在 Pi 中 `/reload` 或重启生效。移除项目项可能重新显露用户级同名服务；包缓存与 OAuth 凭证由 Pi 管理。Tushare 模板默认禁用，需填写账号提供的完整 URL 后启用。详见 [MCP 指南](./trader-skills.md#mcp)。

`/skill:technical-analyst --image "C:\Charts\weekly.png" 分析周线` 或 `/skill run technical-analyst --image PATH [instructions]` 显式附加一张本地公开图表。PNG/JPEG/WebP 最大 8 MiB，当前模型须声明图片输入。图片像素只用于本次模型操作及工具续轮，不进入 JSONL、缓存或后续独立请求；恢复后需要重新附图。分析文字仍按普通研究规则保存，账户截图没有因此获得私有输出权限。文件、模型、取消及验证边界见 [图表图片输入](./README.md#images)。

`/skill info <name> --check` 检查精选技能声明的本地 Python/包版本及固定文件闭包；没有 Python 依赖的纯 Markdown 路由也可检查文件。不安装依赖、不联网或调用模型。详情分别显示模式的 requirements-met、needs-input、blocked 或 unverified；已发现不等于可调用。前两种仅允许对应模式，后两种从模型可用索引移出且显式调用返回依赖缺项。输入收集与 workflow/脚本执行边界见 [技能依赖](./trader-skills.md#readiness)。

对五个 LLMQuant 核心入口，`--check` 分别比对入口与其全部 workflow，共 26 项；对 technical-analyst，比对入口、模板、参考、requirements、脚本和测试共十项；对 macro-regime-detector，比对入口、参考文件和 12 个本地 Python 文件等共 17 项；对 position-sizer，比对六项；对 market-environment-analysis，比对日历助手及上游测试等九项。缺文件或本地改动单独显示；检查不执行 workflow/脚本，不验证数据服务、FMP 凭证、网络、Python 实际导入或私有输出权限。修改/升级后须重新检查，详见 [技能资格契约](./trader-skills.md#readiness)。

`--check` 是无值开关，不能写 `--check false`。技能名称使用位置参数或 `--name` / `--skill` 中的一种，不得同时指定多个；安装可使用位置仓库名或 `--repo`。`list` 最多接受一个 `--scope` 或 `--source` 筛选。

`/skill info <name> --check-imports` 包含版本和固定文件检查，并在同一 Python 中实际加载该精选技能声明的已安装包（requests、yfinance、pandas-market-calendars 白名单）。包元数据满足而未检查导入时，相关模式保持 unverified；DLL/传递依赖等导入失败会阻断模式。导入不执行技能 workflow、不安装包或调用模型，也不验证实际网络和输出质量。该开关无值，只适用于声明这些包的实际精选安装；同名项目技能、纯 Markdown 路由和其它子命令不能借此加载任意模块。可与 `--check-network` 同用，具体边界见 [技能资格](./trader-skills.md#readiness)。

`/skill info market-breadth-analyzer --check-network` 显式检查固定公开 CSV；`/skill info macro-regime-detector --check-network` 显式检查九只固定 ETF 的公开历史日线。只支持实际精选安装路径，不接受自定义 URL。可与 `--check` 同用，网络观察五分钟后失效，只有匹配本地版本检查的 Python 才能用于调用资格。两种检查均为无值开关；其他技能/子命令拒绝网络检查，不运行其脚本。检查的有效期和失效条件见 [技能资格](./trader-skills.md#readiness)。

`/skill audit macro-regime-detector --json REPORT.json --markdown REPORT.md` 只读核对公开宏观报告的来源标签和综合算术；`--record PATH` 复核固定版本验证包和可用的 ETF 输入归档。两种模式不可混用，也不会启动 skill、模型、行情或读取设置。JSON 与 Markdown 来源冲突时，算术可单独通过，但命令整体返回失败并保留结构化警告。普通双文件模式只证明报告内部一致，不能证明原始 ETF 价格或安装版本。

`/skill audit position-sizer --json REPORT.json --markdown REPORT.md` 只读复算 fixed fractional、ATR、Kelly、仓位约束和最终风险，并核对 Markdown 所示参数与结果。该目标不接受 `--record`；缺任一报告、算术或文本冲突、以及无法从固定版 Kelly-shares 报告绑定原始胜负输入时均返回失败。结构化回执只含布尔结果和固定问题代码，不回显账户值、路径或正文。成功也不授予私有输出权限，不启动第三方脚本或把 position-sizer 加入模型索引。

`/skill audit position-sizer` 仍仅只读核对用户显式选择的 JSON/Markdown，不运行第三方脚本或授予 Agent 资格。

### `/help`

无参数时展示与一级 catalog 一致的命令描述和键盘快捷键；`/help COMMAND` 查询一个命令的简要用法、前置条件和示例。完整语义以本文为准。

Help 面板使用全宽列表：`Tab` / `Shift+Tab` 切换 Commands 与 Hotkeys，方向键选择并滚动，`Esc` 关闭。Commands 中 `Enter` 执行选中命令，`?` 关闭面板并在对话区显示其用法；Hotkeys 是只读说明，Enter 和 `?` 不会执行快捷键或上次选中的命令。切换视图保留各自位置，重新打开 Help 从首条命令开始。底部显示当前操作和用法入口。

### `/clear`

清空当前对话界面，并重置 agent/session runtime。它不删除磁盘中的历史 sessions 或 artifacts。

### `/artifact`

`/artifact` 不接受参数或子命令。TUI 按已提交版本显示报告、时间与 revision；`Enter` 恢复选中版本对应的来源分支，并在浏览器打开原报告，后续研究不会覆盖旧版本。面板标题提示 `P private annual export`；按 `P` 打开独立的私有文件导出向导，所选 artifact 与导出使用的年度比较 ID 无关。非 TUI 列出可恢复报告版本。

缺失来源的报告会从可恢复列表隐藏，文件保留以便修复；原 entries 改变或损坏时恢复失败，保留当前会话。HTML 视图缺失或被改写时，可从选中版本的校验快照修复。详情见 [存储策略](./ohquant-storage-policy.md#artifacts)。

`whyj --json -c "/artifact"` 在 `data.reports` 返回每个版本的 `ref`、title、createdAt、sourceSessionId、messageCount 和 bytes；不包含完整轨迹或报告正文。交互恢复仍通过 TUI 选择器完成。

报告生成不属于 `/artifact`。只能在 `/config` 中开启 `Auto Artifacts`；开启后，量化研究 turn 完成并写入完整 trajectory 时自动生成 Dashboard + Trajectory，并打开浏览器预览。

新报告中的 **Share preview → Download HTML** 下载独立的离线分享副本：公开行情/NAV 及已核对量化结果。SMA/Benchmark 净值初值为 1，DCA 的时间加权序列以申购前 1 为基准、首点包含费用；不包含会话原文、模型叙述、轨迹、资金金额或凭证。研究标的与区间仍可见，请在预览中检查。没有归档输入时分享按钮禁用，旧报告版本不自动改写；没有新增分享 slash，也不执行上传或发布。

### `/exit`

结束当前进程。它不删除设置、sessions、缓存或 artifacts。

## 自然语言与量化工具

不带 `/` 的输入进入 agent loop。因子、回测、风险和策略评分由 agent 调用 `Quant.Factor`、`Quant.Backtest`、`Quant.Risk` 与 `Quant.Benchmark`；不为这些工具新增平行的一级 Slash Command。

`Quant.Research` 接收明确对象/日期/目标的任务声明；用户可直接输入“查看当前研究的验收条件和未完成原因”“继续原任务”或“结束这项任务”。任务条件、原文与重试关系保存在当前会话，通过 `/resume` 一并恢复，也可用 `/resume --task` 本地只读查看。普通输入的模型拆解和完整任务交互仍在验收；工具契约及固定测试见 [结构化研究任务](./README.md#tasks)。

```text
分析 688981.SH 的 momentum 因子
回测 20/60 双均线并检查最大回撤
比较组合风险，并生成研究报告
```

## 维护约束

- 改一级名称或描述时，先修改 `src/runtime/workspace/command-catalog.ts`。
- README 和本文必须逐字包含 catalog 的英文描述；测试会校验一致性。
- `slashCommands` JSON 字段继续提供名称数组；`slashCommandDetails` 提供 `name` + `desc`，避免破坏既有调用方。
- 详细参数属于 handler 与本文，不得重新扩张一级 catalog schema。
