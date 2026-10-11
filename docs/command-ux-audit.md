# 命令名称、用法与发现方式核验

日期：2026-09-15；对应 PRD F07，并支持 F05 的日常流程。以当前工作区为准，未发布。一级目录保持十条 name/desc，详细用法独立在 [command-help.ts](../src/runtime/command-help.ts)，不是第二套命令分派器。

## 命名决策与逐命令核对

用户允许系统动作也使用 quant 术语。采用研究对象明确、动作易识别的规则：保留 compact/resume/config/help 等常用名称，在描述中使用 research session、observation portfolios、research reports、market data readiness。portfolio 指观察标的与分组，不能被理解成账户头寸。业务计算继续走 Agent 工具，不增加平行的 /factor、/backtest、/compare。

| 命令 | 对应研究动作 | 参数与前置条件 | 空态/行为核对 |
|---|---|---|---|
| /compact | 压缩研究会话 | 可附 focus；需要活动会话，使用配置模型 | 无会话报错；小上下文返回无需压缩，不能称为零成本操作 |
| /resume | 恢复研究或查看任务 | 可指定 sessionId；--task 单独使用 | TUI 打开列表；headless 需活动会话，空列表提示开始研究。--task 是本地快照 |
| /portfolio | 维护观察组合 | list/create/add/remove/rename/delete/import；GROUP 为 ID 或名称 | 可建空组，默认不读旧持仓；明确 import 才进入旧资料迁移 |
| /config | 配置模型与研究数据 | 默认 Settings；--extensions 管理；--pi 预览/导入 | TUI 草稿编辑；headless 摘要，Pi apply 必须携带 review token |
| /doctor | 检查模型/数据就绪 | --phase 或 --tool 路径，后者带端点参数 | 可调用真实连接；按 phase 判断结果，报告生成不等于数据可用 |
| /skill | 发现和运行研究技能 | list/info/install/run 及 skill:NAME；--check 检查本地依赖 | 未发现时给安装提示；安装、发现、就绪、可调用分别判断 |
| /help | 查找动作和用法 | 无参数打开目录；COMMAND 查看详细用法 | 无需活动模型或数据，支持带 slash 的命令名 |
| /clear | 重置当前研究 | 无业务参数 | 清空显示并重置 Agent/队列，磁盘历史保留 |
| /artifact | 浏览/恢复研究报告 | 无业务参数；TUI 选择已保存版本 | 无报告提示 Auto Artifacts；年度报告走专用工具 |
| /exit | 退出终端 | 无业务参数 | 退出不删除保存内容；--help 不退出交互会话 |

实现路径：[统一 catalog](../src/runtime/command-catalog.ts)、[CLI 分派](../src/cli/registry.ts)、[系统处理器](../src/cli/handlers/system.ts)、[组合处理器](../src/cli/handlers/portfolio.ts)、[技能处理器](../src/skill/handler.ts)、[报告处理器](../src/cli/handlers/artifact.ts)。表格来自代码核对和现有行为测试，不代表已重新验证全部真实服务或完整终端任务。

## 修复的入口问题

原分派器会忽略某些 --help 参数，导致 /clear --help 仍产生清空/重置效果，/compact --help 仍进入压缩；部分业务路径也会先运行依赖或诊断。现在帮助查询在 CLI 分派和 AppRuntime 动作之前返回；错误的帮助参数也不执行原动作。/help COMMAND 与 /COMMAND --help 返回相同用法，-h 是简写。业务参数与 help 同时出现时只显示帮助，不进行预检、安装、文件导入或状态修改。

one-shot 在配置读取/迁移之前处理用法，因此损坏 settings.json 仍可查看 /clear --help；JSON 保留原 command 名，data 为 name/desc/usage。TUI 在对话区显示详细说明，不触发市场刷新、不改变研究状态或取消正在执行的 Doctor。Help 面板保留原选择/运行方式，并在底部显示所选命令的 /help 提示。没有安装技能时，/ski 原本返回空补全；现在仍提供 /skill 一级入口，已有技能索引与显式 skill: 补全继续保留。

## 验证与未完成项

[command-help.test.ts](../src/runtime/command-help.test.ts) 覆盖十命令的两种帮助形式、错误帮助参数、带修改动作的帮助查询、未知命令、旧 session 别名、空技能补全、AppRuntime 无副作用，以及实际 CLI 子进程在损坏配置下的 JSON/原始文件保持。Help 模型与 catalog 对齐，并在 60×20、80×24、120×32 渲染用法提示；这是字符缓冲验证，不代表整个终端视觉验收。

目录名称/描述与 README、Slash 参考通过现有 registry/index 测试逐字对照。专项初验 **52 pass / 0 fail**。全量回归 **1362 pass / 0 fail，168 文件、17384 断言，88.59 秒**，日志 `%TEMP%/whyj-command-help-final.log`。随后修正一处测试断言的 readonly 数组类型，相关两文件复测 **9 pass / 0 fail**；最终 typecheck、architecture（0 baseline violations）、build（2956 modules / 6.70 MB）、whitespace 和 129 个本地文档路径检查通过。初次类型错误日志保留在 `%TEMP%/whyj-command-help-checks.log`，修正后的结果为 `whyj-command-help-checks-final.log`。复跑：

```powershell
bun test src/runtime/command-help.test.ts src/cli/registry.test.ts src/index.test.ts src/tui/test/input.test.ts src/tui/test/panel-models.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

帮助入口阶段发现：Doctor 的非法 phase 会被过滤为默认范围，部分系统命令忽略额外参数。以下补充记录修复这些问题；上面的测试数量保留为该阶段历史证据。

## 参数预检补充（2026-09-15）

[command-preflight.ts](../src/runtime/command-preflight.ts) 在 CLI 分派、AppRuntime 活动切换及 one-shot 配置读取前处理可静态判断的错误。通用路径拒绝未知/重复选项、错误的位置参数数量和冲突的技能名称选择；例如 `/portfolio delete Core --dry-run` 返回失败，不执行删除。无效命令也不能通过 JavaScript 对象继承属性进入处理器。TUI 使用 Composer 错误提示，不新增研究消息、不刷新行情或初始化模型。

Slash 与 shell Doctor 共用 [doctor-phases.ts](../src/runtime/doctor-phases.ts)：仅未提供 phase 时采用默认范围；显式空值、缺值、未知值或 `data,typo` 全部失败。合法列表支持大小写归一和去重。shell `doctor` 同时拒绝拼错选项、额外位置参数和重复 `--phase`，JSON 返回 `invalid_arguments`；slash 参数错误返回 `command_failed`，退出码均为 1。

本阶段 `/config --pi`、`/config --extensions` 的业务契约仍由专用处理器校验；后续补充已将静态检查提前，见下节。Doctor `--tool` 的端点参数由所选 schema 检查，动态端点允许的参数仍遵循原契约。此预检不是完整 shell 语法实现：slash 使用 `--name value`，没有新增 `--name=value`、结束选项分隔符或转义引号语法。F07 保持部分完成；完整配置→组合比较→报告恢复任务在 F05 验收。

新增 [command-preflight.test.ts](../src/runtime/command-preflight.test.ts) 的 **11 项测试**覆盖 33 个无效输入、合法命令兼容、重复选项与特殊属性名、phase 解析、AppRuntime 无业务副作用，以及 6 个真实 CLI 子进程。子进程在临时隔离目录放置故意损坏的配置，验证报错发生在配置读取前、文件字节保持、JSON 错误码与退出码正确；不调用真实模型或金融数据服务。

全量 **1373 pass / 0 fail，169 文件、17615 断言，97.58 秒**，日志 `%TEMP%/whyj-command-args-final.log`。随后补充预检函数的显式返回以满足 noImplicitReturns，专项复测 **11 pass / 0 fail，231 断言，9.31 秒**；最终 typecheck、architecture（0 baseline violations）及 build（2958 modules / 6.70 MB）通过。日志为 `whyj-command-args-preflight-final.log` 和 `whyj-command-args-checks-final.log`；初次类型检查失败保留在 `whyj-command-args-checks.log`。复跑：

```powershell
bun test src/runtime/command-preflight.test.ts src/runtime/command-help.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

## 配置子模式与数字参数补充（2026-09-15）

将 Pi 导入和扩展管理的静态参数契约提取到 [config-command-arguments.ts](../src/runtime/config-command-arguments.ts)，供预检与直接处理器调用共用。拒绝混用子模式、错误动作/参数数量、空选项值和空扩展 ID；Pi apply 要求非空 review，list 不接受模型筛选。有效命令的文件检查与导入逻辑仍由原处理器负责。无效命令在配置读取、活动切换和扩展管理前返回，避免先触发行为再报告输入错误。

[tool-probe.ts 处理器](../src/cli/handlers/tool-probe.ts) 原先对数字字段直接使用 `Number(value)`，裸选项 true 会变为 1，空字符串会变为 0。现在仅转换非空字符串；缺值、空值、非数字或 Infinity 交给既有 schema 拒绝，在 Python 依赖检查和数据请求前返回 invalid-input。有效 `1.5`、`-1` 按端点规则传递，基金代码 `000001` 与年份保持字符串。动态端点的 Boolean 契约未改。

本次新增 **5 项测试**：2 个真实 CLI 子进程、1 个直接处理器契约测试、2 个数字端点参数测试。已有预检用例扩展为 **45 个无效输入、8 个 CLI 子进程**，验证隔离目录中损坏配置不被读取或改写、AppRuntime 不产生业务副作用。数字用例替换依赖检查，确认无效输入零调用且有效值保留正确类型，不访问真实行情或模型。

初次专项验证发现 Pi 错误文本过长，被界面转成研究消息；已缩短提示，保留输入区错误反馈及无研究消息断言。最终全量 **1412 pass / 0 fail，172 文件、18032 断言，103.40 秒**，日志 `%TEMP%/whyj-config-command-tests.log`。typecheck、architecture（0 baseline violations）、build（2961 modules / 6.71 MB）通过。F07 仍为部分完成：本次覆盖配置子模式与数字字段回归，其余端点 schema 和完整键盘流程仍需验收。复跑：

```powershell
bun test src/runtime/command-preflight.test.ts src/runtime/tool-probe.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

## Help 键盘发现与窄屏补充（2026-09-15）

原双栏 Help 在 60×20 将首条说明截为 `Compact resear…`、快捷键说明截为 `Ope…`，80×24 也无法完整显示部分命令含义。先增加原始按键测试，初验 0 pass / 6 fail，记录 `%TEMP%/whyj-help-navigation-before.log`；其中也包含尚未实现的视图切换和用法查询要求。

现在 [HelpPanel](../src/tui/src/help-panel.ts) 独立管理命令/快捷键选择，PanelController 只负责生命周期与事件转交；沿用现有 catalog、视图模型和共享面板绘制。全宽列表在 Commands / Hotkeys 之间用 Tab 或 Shift+Tab 切换，方向键滚动并保持选中项可见，两边位置独立保留。Commands 中 Enter 执行原命令，`?` 通过 `/help COMMAND` 查询用法；Hotkeys 中 Enter/`?` 不执行快捷键或隐藏的命令。关闭再打开重置到首条命令。新增按键进入 DEFAULT_APP_KEYBINDINGS，模块接受重映射并同步操作提示。

[help-navigation.test.ts](../src/tui/test/help-navigation.test.ts) 新增 **10 项测试**：60×20、80×24、120×32 各自验证十条命令全文、全部快捷键全文、选中项循环、缩放、切换/关闭与用法查询；另有按键重映射测试。三项 QuantTui + AppRuntime 联动从 `/hel` + Tab + Enter 开始，保留 `/exit` 选择后切到 Hotkeys 按 Enter，再返回查询退出用法，确认不会退出，随后继续查询组合用法。配置文件字节保持，无行情刷新、配置/诊断动作或模型初始化。最初联动 fixture 缺少必需的 onActivity 回调，补齐后通过；产品逻辑未因该测试配置错误改变。

专项 **10 pass / 0 fail，415 断言，1.70 秒**；全量 **1422 pass / 0 fail，173 文件、18448 断言，102.29 秒**。typecheck、architecture（0 baseline violations）、build（2962 modules / 6.71 MB）及 whitespace 通过。日志 `%TEMP%/whyj-help-navigation-final-targeted.log`、`whyj-help-navigation-tests.log`、`whyj-help-navigation-typecheck.log`。本记录证明解码后的实际 TUI/运行时行为与字符缓冲可读性，不证明终端字体、系统输入法或真实桌面视觉；完整配置/诊断/研究键盘流程和其余端点覆盖继续验收，F07 保持部分完成。

```powershell
bun test src/tui/test/help-navigation.test.ts src/tui/test/panel-views.test.ts src/runtime/command-help.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

## 引号与字面参数（2026-09-15）

原正则解析在删除引号后丢失字面值信息，`/portfolio create "--help"` 被误当帮助查询；未闭合引号可以进入名称，`"Core"extra` 被拆成两个参数。新 [arguments.ts](../src/cli/arguments.ts) 独立做词法扫描，保留每个 token 的 quoted 标记；registry 共用长/短选项处理，带引号的选项样式字符串作为值或位置参数。Windows 反斜杠、尾斜杠、证券前导零、负数与单词内部撇号不变。

未闭合、闭合后紧接其他字符、空命令名均形成 argumentError。预检优先于帮助、设置读取和业务动作；TUI 在 Composer 返回错误，不切活动、启动模型或刷新行情。未增加 shell 变量替换、转义引号、相邻引号片段拼接、`--name=value` 或 `--` 分隔符。

新增 [arguments.test.ts](../src/cli/arguments.test.ts) 9 项测试覆盖字面选项、路径/数字/撇号、长短选项边界、错误输入无副作用、实际组合创建/添加/删除与帮助保护、AppRuntime 反馈，以及三个真实 one-shot 子进程在损坏设置下提前返回 JSON 错误。数据均为 TEMP 内的合成观察组，不读取用户组合或账户；quoted 模型 ID 的词法通过不等于模型已配置可用。

初验发现测试文件中的尾斜杠模板字面量未闭合；修正后，合法 CRUD fixture 又触发了正确的损坏配置保护。改为在该测试中显式写入合法合成设置，保留所有错误路径的损坏设置 fixture，未放宽产品保护。新文件复测 9/9、12.53 秒，最终工程回归另记。

最终全量 **1525 pass / 0 fail，183 文件、20039 断言，163.38 秒**，日志 `%TEMP%/whyj-slash-arguments-full.log`；含后续补入的空命令/未闭合命令名边界。typecheck、architecture（0 baseline violations）、build（2974 modules / 6.75 MB）、whitespace 与本轮文档相对文件链接检查通过。本轮完成词法与入口行为验证，不将其扩展为全部动态端点参数、原生终端字体或完整研究流程验收，F07 保持部分完成。

```powershell
bun test src/cli/arguments.test.ts src/cli/registry.test.ts src/runtime/command-preflight.test.ts src/runtime/command-help.test.ts
```

## Doctor 端点 schema 查询（2026-09-15）

原错误提示要求查看 schema，但 CLI 没有查询入口。新增 `/doctor --tool NAME --market MARKET --schema [--provider NAME] [--endpoint NAME]`，在预检阶段返回静态端点声明，显式市场避免读取配置默认值。非法开关、混入探测参数、无对应路由均失败，不回落到网络检查；帮助仍优先返回用法。

[tool-probe-catalog.ts](../src/runtime/tool-probe-catalog.ts) 统一原路由 schema 和标量参数守卫，原执行器/编辑器与 [tool-probe-schema.ts](../src/runtime/tool-probe-schema.ts) 使用同一声明。查询返回独立副本，不允许修改回执改变后续验证。区分 declared-parameters 与 scalar-forwarding；动态指数端点的透传 schema 不宣称完整 API 参数覆盖。JSON 同时输出所有匹配 schema，文本在选择一路时展开完整参数。

初验子进程发现仅导入 render.ts 就调用 getQuotes，生成 insights.json。现将这项加载延迟到忙碌界面实际显示提示时，仍使用原缓存和提示内容；帮助、错误输入和 schema 查询不再因导入渲染模块写缓存。此变更不宣称所有 UI 渲染都无文件读取，首次实际显示提示仍可能按既有规则重建 insight 缓存。

新增 [tool-probe-schema.test.ts](../src/runtime/tool-probe-schema.test.ts) 8 项测试：基金必填/数值字段与探测校验一致、动态参数限制、全注册表四市场路由覆盖、回执修改隔离、非法查询/帮助不探测、AppRuntime 无活动/模型/行情动作，以及三个真实 one-shot 子进程在损坏配置下的 JSON/退出码/目录字节保持。所有数据隔离在 TEMP，进程内 fetch 被禁止。配合既有 tool-probe 与 render 测试初验 78/78、8.22 秒；随后补充直接处理器无探测断言，最终回归另记。

```powershell
bun test src/runtime/tool-probe-schema.test.ts src/runtime/tool-probe.test.ts src/tui/test/render.test.ts
bun run src/index.ts -- --json -c "/doctor --tool fetch_bars --market US --schema"
```

最终全量 **1533 pass / 0 fail，184 文件、20677 断言，156.73 秒**，日志 `%TEMP%/whyj-probe-schema-full.log`。typecheck、architecture（0 baseline violations）及 build（2976 modules / 6.75 MB）通过，日志 `%TEMP%/whyj-probe-schema-checks-final.log`。本轮验证静态参数发现、入口只读行为及既有渲染兼容；未调用真实数据端点，F07/F24 保持部分完成。

## AKShare 指数端点签名补充（2026-09-15）

之前 `fetch_index_rows` 等路由对 92 个 AKShare 白名单指数端点统一采用 `Type.Record` 标量透传：零参数的 `index_stock_info` 也会接受任意字段，`index_zh_a_hist` 无法发现 symbol、period、start_date、end_date 和默认值。当前工具注册表盘点有 278 条数据探测路由，其中 97 条标量透传全部来自这些指数端点及其重复工具路由。先将“字段全覆盖、未声明参数失败”写成测试，初验 **7 pass / 1 fail**。

[生成器](../scripts/generate-akshare-index-signatures.py) 从同一[端点白名单](../src/source/src/akshare-endpoints.ts)读取名称，并对 WhyJ 当前解释器 Python 3.14.3 / AKShare 1.18.63 的函数执行离线 `inspect.signature` 与 docstring 读取；92 个函数全部存在，参数名、类型、可选性、默认值和说明写入[生成声明](../src/runtime/akshare-index-signatures.generated.ts)。`--check` 对白名单或已安装版本变化失败，不请求供应商。生成声明的 TypeScript `satisfies` 约束使新增白名单端点而未重新生成时类型检查失败。

[端点目录](../src/runtime/tool-probe-catalog.ts) 在查询、探测和 TUI 编辑器中复用[同一字段 schema](../src/runtime/akshare-index-parameters.ts)。`index_stock_info` 现在只接受 `{}`；`index_zh_a_hist` 保留供应商字段与默认值，未声明字段在 Python 依赖/网络检查之前返回 invalid-input。`/doctor --tool ... --schema` 仍在设置读取之前只读返回，JSON 的 `signatureSources.akshareIndex` 标明版本；当前 278 条路由再盘点为 **0 条标量透传**。实际 one-shot 查询与有效参数通过合成 adapter 原样转交，未访问真实指数端点。

专项 **16 pass / 0 fail、1352 次 expect**；最终全量 **1611 pass / 0 fail、191 文件、21579 次 expect、278.11 秒**，日志 `%TEMP%/whyj-akshare-index-signatures-full-2026-09-15.log`。根 typecheck、architecture（0 baseline violations）、build（2985 modules / 6.80 MB）和签名 `--check` 通过。复跑：

```powershell
python -X utf8 scripts/generate-akshare-index-signatures.py --check
bun test src/runtime/tool-probe-schema.test.ts src/runtime/tool-probe.test.ts
bun run src/index.ts -- --json -c "/doctor --tool fetch_index_rows --market A --schema --endpoint index_zh_a_hist"
bun run test
```

静态签名对应生成时的 AKShare 1.18.63，并不是查询当下安装版本的实时证明；供应商文档中的取值范围、日期/标的含义及实际权限仍需另行检查，参考 [AKShare 官方指数文档](https://akshare.akfamily.xyz/data/index/index.html)。真实本机包版本变化后须用 WhyJ 选择的 Python 重新生成和复核；配置/诊断/研究的联合键盘流程及原生终端视觉仍待验收，F07 保持部分完成。

## AKShare 安装版签名差异查询（2026-09-15）

静态 schema 的版本字段只说明生成快照时的环境。新增显式 `/doctor --tool fetch_index_rows --market A --schema --installed [--endpoint NAME]`：先在纯预检中限制为只读 AKShare 指数白名单路由，再用市场请求的[同一 Python 选择器](../src/source/src/akshare-python.ts)导入本机 AKShare，仅对所选函数执行 `inspect.signature` 与 docstring 读取。普通 `--schema` 仍同步返回打包声明；本机查询在读取设置之前执行，可取消，不访问真实市场端点。

[安装版查询](../src/runtime/installed-akshare-index-schema.ts)用同一[字段转换器](../src/runtime/akshare-index-parameters.ts)生成 schema，并逐端点与打包快照比较。JSON 的 `scope` 为 `installed-signatures`，`signatureSources.akshareIndex` 为本机版本，`comparison` 分开报告版本是否相同、字段是否相同和变化端点。当前解释器实测 AKShare 1.18.63，`index_zh_a_hist` 的 symbol/period/start_date/end_date 与静态声明一致。合成版本漂移测试确认版本变化但字段相同不会误报字段变化；字段变化则显示安装版 schema 和具体端点。缺包、非法路由和预先取消返回失败，不读取损坏设置。

```powershell
bun run src/index.ts -- --json -c "/doctor --tool fetch_index_rows --market A --schema --installed --endpoint index_zh_a_hist"
bun test src/runtime/tool-probe-schema.test.ts
python -X utf8 scripts/generate-akshare-index-signatures.py --check
```

此查询是差异诊断，不自动替换实际探测所用的静态 schema，也不证明参数取值范围、响应或权限；包更新后须再生成快照并核对。F07 仍缺供应商取值语义、配置/诊断/研究连续键盘流程和原生终端视觉。

最终专项 **19 pass / 0 fail、1081 次 expect**；全量 **1616 pass / 0 fail、191 文件、124.44 秒**，日志 `%TEMP%/whyj-installed-akshare-schema-full-2026-09-15.log`。根 typecheck、architecture（0 baseline violations）、build（2986 modules / 6.81 MB）及生成签名 `--check` 通过。真实本机查询的版本与字段一致性单独核对，未向市场端点发请求。

## AKShare 指数参数取值与日期形状（2026-09-15）

本机 1.18.63 的 92 个白名单函数中有 19 处 docstring 写明完整 `choice of` 列表。原生成器只读取 `:param` 首行，使 Drewry 航运指数的跨行八项列表被截断；[生成器](../scripts/generate-akshare-index-signatures.py)与[安装版检查器](../src/runtime/installed-akshare-index-schema.ts)现均采集参数说明续行，重新生成的快照和真实安装版查询逐字段一致。[纯语义模块](../src/runtime/akshare-index-semantics.ts)只解析完整、带引号的列表，将 19 处选项放入同一 TypeBox 字符串 schema；不完整或无法解析的说明不被误作限制。

[AKShare 官方指数文档](https://akshare.akfamily.xyz/data/index/index.html)与本机函数源码分别确认 `index_zh_a_hist` 的 daily/weekly/monthly 和 `YYYYMMDD` 日期、`index_zh_a_hist_min_em` 的 1/5/15/30/60 和带秒时间戳。两种日期形状只应用于相应端点，不把全白名单的 `start_date` 误设为一种格式。离线 `/doctor --tool ... --schema`、显式 `--installed` 和实际探测共用转换后的 `enum`/`pattern`；非法 period 或日期形状在 Python/网络之前返回 invalid-input。分时路由的查询回执提醒其近期覆盖限制。

这一阶段只证明声明选项和文本形状，尚未检查日期真实有效或起止顺序；后续的[日历与窗口校验](#akshare-日历与窗口顺序2026-09-15) 补齐了本地输入规则。供应商是否还有未列出的别名、指数是否存在、历史是否可得及响应字段仍未证明。在线官方文档当前版本 1.18.94 与本机 1.18.63 不同，升级后仍须重新生成签名并做真实响应核验；F07 保持部分完成。

专项 **22 pass / 0 fail、1447 次 expect**；全量 **1617 pass / 0 fail、191 文件、123.40 秒**，日志 `%TEMP%/whyj-akshare-index-semantics-full-2026-09-15.log`。根 typecheck、architecture（0 baseline violations）、build（2987 modules / 6.81 MB）及签名 `--check` 通过。本机安装版 `drewry_wci_index` 查询显示完整八项选项，版本与字段比较均匹配。

另用 `000300`、weekly、2025-01-01 至 2025-01-31 执行一次真实 `index_zh_a_hist` 探测：参数和 Python/AKShare 依赖检查通过，但状态为 unavailable、0 行。直接适配器复测显示东财指数代码映射请求发生 `ProxyError`；该样本不能证明真实历史响应或权限，也不能据此推断所有网络环境都失败。下一步仍需在可连通的供应商链路验证数据覆盖与日期语义。

## AKShare 日历与窗口顺序（2026-09-15）

在已限定的 `index_zh_a_hist` 与 `index_zh_a_hist_min_em` 两路上，[语义模块](../src/runtime/akshare-index-semantics.ts)为字段 `pattern` 增加本地 TypeBox `format` 校验：八位日线日期与带秒分时日期须是真实公历日期，含闰年和时分秒范围；年 0000 不可用。静态与安装版 schema 都展示 `format`，实际探测调用同一校验器。跨字段顺序无法由单字段 JSON schema 表达，[探测入口](../src/runtime/tool-probe.ts)在依赖检查前比较有效起止日期，并取打包函数的默认值补齐省略字段；倒置窗口返回具体提示，不发供应商请求。

固定反例覆盖 2025-02-30、1900-02-29、2000-02-29、24:00:00、结束早于开始，以及开始晚于省略时的默认结束日期；有效 2024-02-29 和正常窗口仍通过。此处只验证本地日历/时间和顺序，不证明指数身份、交易日、供应商历史覆盖或真实数据响应。此前周线真实样本在东财代码映射处的代理请求失败仍待网络链路核验，F07 不升级为已完成。

直接 slash 处理器和隔离设置目录中的打包 CLI 对 `--start_date 20250230` 都返回 `invalid-input` 与日历格式提示，打包进程退出 1、stderr 为空。专项 **22 pass / 0 fail、1467 次 expect**；最终全量 **1617 pass / 0 fail、191 文件、125.09 秒**，日志 `%TEMP%/whyj-akshare-index-calendar-final-full-2026-09-15.log`。根 typecheck、architecture（0 baseline violations）、build（2987 modules / 6.81 MB）及签名 `--check` 已通过。

同一 Python 网络环境中，本机代理端口可连接，AKShare 文档、东财主站与 `push2.eastmoney.com` 收到 HTTP 200；`80.push2.eastmoney.com` 和 `push2his.eastmoney.com` 报 `ProxyError`。这说明本轮探测不能归因于日期校验或缺包，也不能把代理端口开放推定为所有东财子域名可用。历史响应及与 F08 关联的可用来源矩阵仍待真实连通性和回退验收。

## 根级启动版本与参数（2026-09-16）

`whyj --version` / `whyj -V` 在设置迁移和 TUI 启动之前返回当前 WhyJ 包、内置 Pi agent core 与 Pi AI 的版本；`whyj --json --version` 提供结构化回执。根级不认识的选项、单独 `--json`、缺值的 `-c`/`--command`、重复或混合版本/帮助动作现在返回 `invalid_arguments`，不会无意进入交互界面。离线 `whyj --json -c "/help"` 也在设置读取前派发，损坏配置时仍能查询命令。实际安装版 `whyj --json --help --bogus` 退出 1，`whyj --json --help` 正常退出 0。

本机安装版 `whyj` 指向当前工作区构建；实际运行 `whyj --version` 退出 0，输出 `WhyJ Quant v1.2.0 · bundled Pi agent core v0.85.1 · Pi AI v0.85.1`。JSON 版本同样退出 0，拼错的 `whyj --json --versoin` 与混合未知参数的 `whyj --json --help --bogus` 均退出 1 并返回 `invalid_arguments`；正常 `whyj --help` 列出版本命令。这是本机安装行为，不代表发布仓库或不同安装版本。版本/帮助专项 **5 pass / 0 fail、67 次 expect**；前轮源入口、文件锁八进程与端点 CLI 的三文件专项 **14 pass / 0 fail、153 次 expect**。最终完整回归 **1706 pass / 0 fail、200 文件、22285 次 expect、247.28 秒**，日志 `%TEMP%/whyj-root-cli-version-final-full-2026-09-16.log`。类型、架构（0 baseline violations）、测试围栏与构建（3012 模块 / 6.92 MB）通过。F07 仍缺配置/诊断/研究连续键盘流程和真实终端视觉。

```powershell
bun test src/cli/version.test.ts src/cli/tool-probe-entry.test.ts src/storage/test/durable-preferences.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
whyj --version
whyj --json --version
whyj --help
```

## 日线、新闻与汇率探测日期声明（2026-09-19）

此前 `/doctor --tool ... --schema` 把这些路由的 `start` / `end` 仅声明为非空字符串。实际日线探测会自行拒绝坏日期，但新闻路由可能先检查 Python，汇率路由可能先进入适配器；离线 schema 也不能提示合法日历日期。现在[端点目录](../src/runtime/tool-probe-catalog.ts)为这三类路由共用 `YYYY-MM-DD` 模式和本构建的公历 `format`，[探测入口](../src/runtime/tool-probe.ts)在凭证、依赖和适配器前拒绝倒置窗口。AKShare 指数专用 `YYYYMMDD` / 带秒格式仍按原端点规则处理。

[回归](../src/runtime/tool-probe-schema.test.ts)先在旧实现上出现 1 个失败，再验证三类 schema 的有效闰日、无效日期/斜杠格式，以及无效公历日期和倒置窗口均不触发 Python、新闻或 FX 适配器。两文件专项 **23/23、1519 次断言**。隔离设置目录中的实际 one-shot CLI 查询 `compare_portfolios` / `frankfurter` 得到 `whyj-daily-date`；倒置窗口返回 `invalid-input` 和明确的起止提示，未请求供应商。该校验只保证输入有效，不证明时段内存在行情、新闻或汇率数据，F07/F24 仍部分完成。

最终完整回归 **1812/1812、222 文件、23221 次断言**，日志 `%TEMP%/ohq-probe-date-full-final-2026-09-19.log`；根 typecheck、architecture（0 baseline violations）、build（3043 modules）通过。第一次全量测试在代码仍调整时启动，加载旧模块后出现 1 项旧提示断言失败；最终文件状态下重新启动的这轮全量为验收结果。

```powershell
bun test src/runtime/tool-probe-schema.test.ts src/runtime/tool-probe.test.ts
bun run src/index.ts --json -c "/doctor --tool compare_portfolios --market US --schema --provider frankfurter --endpoint ecb-fx"
```
