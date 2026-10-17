# Agentic / Vibe Repo Ops：让 AGENTS.md、Skills 与 CI 对同一次交付负责

初稿 2026-10-15 · 修订 2026-10-18 · oh-my-quant 工程实践

本文扩写自《Agent Repo 的基础建设：从工作约定到可核验的交付》。原文解释为什么建立规则；这次进一步追问：规则已经写下、工作流已经运行，为什么仍然频繁失败，又为什么检查失败没有阻止合并？

## TL;DR

- **规则有不同的执行者。** `AGENTS.md` 帮助 Agent 理解约束，Skill 组织操作，脚本验证可判定条件，Workflow 调度执行，GitHub ruleset 才负责阻止不合格合并。任何一层存在，都不能代替下一层已经生效的证据。
- **检查结果必须带版本和状态。** PR head、合并候选、策略代码、PR 描述、Issue 状态和运行 attempt 都可能变化。“这个 SHA 曾经绿过”不足以证明现在可以合并。
- **历史红灯有不同原因。** 初次全量快照包含 44 次运行；补查至 61 次后为 35 成功、18 失败、8 取消，另有成功 run 的首次失败 attempt。失败覆盖真实产品缺陷、跨平台假设、异步测试预算、工具链下载和策略竞态，不能统一用重跑处理。
- **修复必须保留拒绝能力。** 已合并 PR 不再因为 Issue 关闭而误报；开放 PR 的无效引用仍要失败。测试给予合理执行时间，也必须等待被取消的工作退出，不能只延长超时或弱化断言。
- **外部经验需要条件。** Codex 的合并前/后分层、DSH 的测试可靠性与局部规范、ZCode 的可执行架构策略各有价值；公开源码不证明对方的私有合并配置，也不直接证明本项目已经获得相同效果。

## 1. 从一次“合并成功以后检查变红”开始

2026-10-16，产品形态计划 PR #22 的代码 CI 和一轮 PR policy 已经通过。随后更新了 PR 描述，触发另一轮 policy。PR 在这轮检查结束前合并，关联的 Issue #20 自动关闭。几秒钟后，校验脚本读到关闭的 Issue，报告“关闭引用必须指向一个开放 Issue”。[失败运行](https://github.com/yangjingo/oh-my-quant/actions/runs/38908970604)

单独看每个动作都很合理：编辑描述应该重新检查；合并应该关闭已完成的 Issue；一个正在实施的 PR 应该关联开放的问题。错误出现在组合上：检查器没有区分“仍在实施的 PR”和“已经完成的 PR”，合并操作也没有等待最后一次描述编辑触发的运行。

```text
13:35:05 UTC  PR 描述编辑，触发新 policy
13:35:09 UTC  PR 合并，Issue 自动关闭
13:35:12 UTC  policy 读取 Issue.state = closed
              ↓
              用开放 PR 的条件判断已经完成的 PR，误报失败
```

这个例子让仓库运维问题从“怎样配置 YAML”变成了“怎样维护交付状态的一致性”。Agent 能修改代码、文档、PR 描述，能调用测试和合并工具；这些能力越完整，越需要说明每个判断依据哪个版本、在哪个时间点成立。

本文把这套工作称为 **Agentic / Vibe Repo Ops**：维护 Agent 参与开发时的仓库知识、验证、评审、合并、发布与恢复流程。这个名称是本文的主题归纳，不是一个已有统一标准，也不意味着自然语言可以替代确定性检查。

## 2. 先把全部历史展开，避免修错对象

第一次排查取得 38 次运行。继续工作期间，仓库又产生了新运行，因此后续改用 Actions API 分页取得全部可见历史，核对返回的 `total_count`，再检查每次运行的 jobs、失败 steps 和 `run_attempt`。冻结快照覆盖 2026-10-11 至 2026-10-16 UTC，读取于北京时间 2026-10-17；后续新增验证不混入这份历史分母。

| 观察对象 | 快照结果 | 能支持的判断 |
| --- | --- | --- |
| Workflow runs | 44 | 本次 API 可见的全部运行，不承诺包括已删除记录 |
| Success / failure / cancelled | 20 / 16 / 8 | 历史运行结果，不能直接当作当前 main 缺陷率 |
| Run attempts | 全部为 1 | 这份快照没有被最终成功覆盖的旧重跑 attempt |
| 失败运行日志 | 16 份均取得 | 可以回到具体平台、阶段和错误，而非只看红色图标 |
| 取消运行中的失败 job | 3 次出现 `CI required` 失败 | 上游取消后，聚合门禁拒绝放行；不是另一个产品缺陷 |
| 旧桌面 UI 失败证据 | 两份 artifact 均可下载 | 可结合失败截图、等待行号与后续修复判断原因 |

最新一次快照中的 main 是 `076b786`：根 [CI 成功](https://github.com/yangjingo/oh-my-quant/actions/runs/38917440076)，但同一提交的 [Windows desktop 工作流失败](https://github.com/yangjingo/oh-my-quant/actions/runs/38917440064)。失败发生在重复执行根测试的 `checks` job，真实 Python 探针超过了 5 秒；这和“安装包构建失败”不是同一个事实。

这里有两个统计陷阱。一个测试失败可能同时使平台 job 和 `CI required` 失败，不能算两个独立根因。相反，一个 workflow 失败也可能包含两种原因，例如安装验收访问不存在的注册表路径，同时另一个 job 的 provider 测试未在期限内发出请求。归因单位应该是“故障机制及其证据”，不是 UI 上红灯的数量。

复查命令可以保持简单：

```sh
gh api --paginate 'repos/yangjingo/oh-my-quant/actions/runs?per_page=100'
gh api 'repos/yangjingo/oh-my-quant/actions/runs/<run-id>/jobs?filter=all&per_page=100'
gh run view <run-id> --repo yangjingo/oh-my-quant --log-failed
gh api 'repos/yangjingo/oh-my-quant/actions/runs/<run-id>/artifacts'
```

如果某次 `run_attempt > 1`，还要按 attempt 读取日志；如果 jobs 超过一页，也要继续分页。已过期 artifact 应标为无法取得，不能用另一轮成功截图替代。我们这次确实找回了两份原始截图，因此可以把旧报告里“UI 超时、内部原因待查”的判断继续收窄。

### 继续审计时发现：成功 run 也可能藏着一次失败

2026-10-17 再次分页读取全部历史，快照扩展到 **61 次 run：35 成功、18 失败、8 取消**，共有 **62 个 attempt**。新增 17 次运行全部检查 jobs；唯一 `run_attempt=2` 的 [39039089298](https://github.com/yangjingo/oh-my-quant/actions/runs/39039089298) 最终成功，但 attempt 1 的 Windows 取消测试失败。若只按 `conclusion=failure` 搜索，这个问题会完全漏掉。后续本 PR 的验证不计入这份冻结分母。

| 新增证据 | 观察与归因 | 对应处理 |
| --- | --- | --- |
| [39020264369](https://github.com/yangjingo/oh-my-quant/actions/runs/39020264369) | task lifecycle 用例约 5.2s 被外层 5s 终止，出现迟到状态断言 | #35 在 `183559c` 给这项多轮集成测试独立预算；已在 main，不重复补丁 |
| [39039089298 attempt 1](https://github.com/yangjingo/oh-my-quant/actions/runs/39039089298/attempts/1) | Skill 取消用例总耗时 1573ms，断言小于 1000ms；计时从启动命令开始 | 本次用响应 barrier 检查取消因果关系；关联已有 #37 |
| [39043090574](https://github.com/yangjingo/oh-my-quant/actions/runs/39043090574) | main `1d4488f` 的 Desktop 重复根检查：YTD 归档用例超时，迟到写入报目录 ENOENT | 本次给存储集成测试独立预算，持有并等待完整测试 Promise 后清理 |

第一行不能只看到 `Expected cancelled / Received active` 就直接修改产品状态机：同一日志明确有测试超时与清理阶段的迟到错误。第三行也不能因为独立根 CI 成功，就删除 Desktop 重复 job 后宣称测试已经修好。本次消除重复执行，同时修复根测试自己的生命周期，因此它在单独 CI 中仍有保护。

main 在这期间合并 #35，删除了旧 Python 探针模块。本次隔离分支更新到 `1d4488f`，撤掉已经失去对象的 Python 测试补丁，保留历史解释。审计记录应该固定时间和版本；修复分支则应跟上实际交付基线。

## 3. AGENTS.md、Skill、CI 与平台规则分别保证什么

原方案的方向并没有错。仓库需要一个短入口，让 Agent 知道当前架构、修改范围和验证方式；复杂操作需要可重复的步骤；常见违规需要脚本自动拒绝。问题在于，我们容易把这些不同层次合并成一句“已经有规范了”。

| 载体 | 当前负责的事实 | 不能据此推断 |
| --- | --- | --- |
| `AGENTS.md` | 原则、范围、文档与 Skill 索引 | Agent 一定读到且遵守，GitHub 已启用门禁 |
| Issue | 问题、允许路径、非目标、可观察验收 | 功能已经实现 |
| PR | 本次代码和文档、验证结果、风险 | 填满模板就意味着验证充分 |
| 仓库 Skill | 从问题到交付的操作步骤与例外 | 步骤自动执行，外部平台已经配置 |
| 检查脚本 | 明确输入下可以机械判断的条件 | 任意业务语义、审美或架构都正确 |
| Workflow | 事件、代码版本、环境、权限、job 依赖 | 检查一定属于必需的合并条件 |
| Branch protection / ruleset | 哪些结果必须通过才能合并 | 通过的检查覆盖所有产品行为 |
| 当前 docs | 现行契约、命令与维护操作 | 所有历史运行仍可完整复现 |
| Blog | 反例、选择理由、代价和重审条件 | 当前配置的唯一操作手册 |

本仓库的 [AGENTS.md](../../../AGENTS.md) 已经提醒“这些指令本身不强制 GitHub 合并规则”。但审计时，main protection API 明确返回 `Branch not protected`，repository rulesets 返回空数组。这说明提醒是准确的，执行闭环却没有完成。给 job 命名 `CI required` 也不会自动改变平台权限。

**WhyJ 分析：一条规则只有同时说明执行者、验证对象、拒绝条件和失败后的动作，才有完整的操作含义。** 比如“提交前测试”没有说明测试哪个版本；“CI 通过后合并”没有处理描述编辑触发的新检查；“合并后删分支”没有处理 stacked PR、未交付提交和 worktree 内的私有数据。

短入口的价值在于让这些责任可发现，而不是把所有细节复制到入口里。OpenAI 的 [Harness Engineering](https://openai.com/index/harness-engineering/) 讨论过大而全的 `AGENTS.md` 带来的上下文与维护问题，采用短入口连接结构化仓库知识。这里借鉴的是组织方式；文章所述团队规模和效率不能算作本项目收益。

### 规则放错位置，也会制造新的错误

我们选择“一份实现 Issue、一个主要功能模块、一个实现 PR”，目的是让范围和验收能对应。但“主要模块”不等于只能改一个目录：CI 修复必然涉及工作流、策略测试、相关慢测试和说明文档。机械统计目录数反而会迫使必要修复被拆散。允许路径和跨模块理由应写在 Issue，语义范围由评审判断。[Issue Skill](../../../.agents/skills/issue-skill/SKILL.md)

“每个 PR 都更新 docs”也有成本。脚本可以拒绝没有 docs Markdown 变更的 PR，却不能判断新增文字是否有价值。为了过门禁随手改一个标点，只满足路径条件。现行 [PR Skill](../../../.agents/skills/pr-skill/SKILL.md) 因此要求解释行为、契约或验证变化，禁止纯粹为了检查而修改文档。将来若建立例外，例外必须有可审阅的理由，不能简单关闭整个检查。

博客同样不能被模板化成所有小修复的强制产物。它适合解释非显然的取舍，这次恰好有真实反例；普通修正只需当前文档与自足的 PR 描述。

## 4. 策略脚本为什么会在自己的工作流里消失

两次 PR policy 失败都报 `ERR_MODULE_NOT_FOUND`，找不到 `.github/scripts/pr-policy.mjs`：一次发生在 #22，一次发生在 #28。[#22 运行](https://github.com/yangjingo/oh-my-quant/actions/runs/38907862456) · [#28 运行](https://github.com/yangjingo/oh-my-quant/actions/runs/38918415702)

旧配置是：

```yaml
on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened, ready_for_review]
# ...
- uses: actions/checkout@v6
  with:
    ref: ${{ github.event.pull_request.base.sha }}
```

工作流被加载，并不意味着随后 checkout 的提交一定包含它需要的脚本。旧 PR 的 payload base 仍是 `b0b55db`，早于策略文件引入；运行环境加载了新工作流，却检出旧代码。我们在一个 job 里组合了两个不同版本。

最初让 PR 同步 main 可以避开这一次错误，但不能消除配置缺陷：另一个旧 PR 仍会再次触发。#28 的复发正好证明这一点。修复因此落在 [pr-policy.yml](../../../.github/workflows/pr-policy.yml)，将可信策略 checkout 固定为该 `pull_request_target` 事件的 `github.sha`，并输出策略 SHA 与事件 PR head，便于追踪。

```yaml
- uses: actions/checkout@v6
  with:
    ref: ${{ github.sha }}
    persist-credentials: false
```

这个取值依赖事件语义，不能复制到所有工作流。`pull_request` 常用于测试合并候选，`pull_request_target` 的执行上下文来自可信默认分支；GitHub 对后者的默认分支语义有过调整，维护者必须核对当前[事件文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)和[变更说明](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/)。

我们保留只读 permissions，不在 target job 中检出 PR head、安装 PR 依赖或执行 PR 提供的脚本。PR 描述和路径只是数据。这样，贡献者不能通过同时修改策略脚本来让自己的不合格 PR 在可信检查中自我通过。

回归检查不只验证字符串解析，还读取实际 YAML，确认触发器、checkout ref、`persist-credentials: false` 和只读权限。它能防止已知配置退化；不能证明 GitHub 将来不会改变事件行为，也不能代替首次上线后的真实运行。

## 5. 为什么最终 SHA 还不够：给策略加入生命周期

旧脚本按顺序读取 PR、文件列表和 Issue，然后立即判断 Issue 是否开放。它没有在开始时检查 PR 是否已经结束，也没有在结束时检查校验期间的 PR 是否变化。[旧策略源码](https://github.com/yangjingo/oh-my-quant/blob/076b78661e61660e4e1c8b0cf7830f72714615e5/.github/scripts/pr-policy.mjs)

这和第一节的合并时序正好相撞。解决方法不是允许所有 closed Issue，而是对适用对象作区分：

| 状态 | 应有结果 | 原因 |
| --- | --- | --- |
| PR open，Issue open，其他条件满足 | 通过 | 正在实施的有效引用 |
| PR open，Issue closed | 拒绝 | 不能把已完成问题当作新的实现目标 |
| PR 已关闭或合并 | 不适用 | 已结束对象不再接受开放 PR 门槛 |
| 检查期间修改 body、head、base 或文件数 | 重新读取并验证 | 旧快照不能说明新内容合格 |
| 开放 PR 遇到 API 错误 | 失败 | 无法验证不等于已通过 |
| 连续变化导致无法获得稳定快照 | 明确失败并说明需重检 | 有界处理，避免无限循环 |

[修复后的策略](../../../.github/scripts/pr-policy.mjs) 使用最多三轮读取。每轮先检查 PR 状态，再验证描述、文件、Issue 和竞争 PR；无论这轮成功还是抛错，都重读 PR。已结束则返回不适用，相关字段变化则重新验证，稳定时才返回结果或原始错误。这是并发状态变化的重试，不是把断言失败不断重跑到成功。

回归包含“检查中合并并关闭 Issue”“无效描述被修正”“有效描述变无效”“head 改写同时文件数变化”“API 失败”“持续变动”。这很重要：只添加一个 merged 场景，很容易修掉红灯却留下更危险的旧成功覆盖新错误。[策略回归](../../../.github/scripts/quality.test.mjs)

这些 REST 读取仍然不是事务。最后一次读取之后，Issue 仍可能再次改变；两个 PR 也可能并发引用同一个 Issue。现行工作流不监听所有 Issue-only 状态变化，因此我们不声称实现了原子唯一性。更强的保证需要重新设计事件协调或合并服务，成本不能藏在“再读一次”里。

合并操作本身也要修正。[PR Skill](../../../.agents/skills/pr-skill/SKILL.md) 现在明确要求先完成描述，再检查最后触发的运行。**同一个 head SHA 上，旧成功与新 pending 可以同时存在。** 核对内容版本之后，还要核对相关运行是否已经完成；不能只找一个绿色历史结果。

一个可追踪的验收记录至少包含：

```text
PR number
head SHA + base SHA + 实际 checkout 的候选 SHA
策略代码 SHA
PR 描述是否在检查后修改
workflow run ID + run attempt + 平台
命令与结果 + artifact / 日志
仍未验证的行为
```

这是本文根据故障提出的记录模型；仓库尚未把全部字段实现为统一自动回执，不能把设计表当成已上线功能。

## 6. Windows 的“偶发”为什么有重复结构

### 6.1 外层 5 秒，内层 120 秒

研究评测失败时，日志显示用例执行约 5434ms，被 Bun 默认 5000ms 的外层期限终止；随后出现测试之间的未处理断言错误。内部 `runResearchEvaluation` 却默认允许 120 秒，并且负责 HTTP、工具调用、证据持久化、会话恢复和第二轮回答。这不是一个纯函数单测。[失败日志](https://github.com/yangjingo/oh-my-quant/actions/runs/38680849899) · [评测入口](../../../src/runtime/evaluation/research-evaluation.ts)

外层先超时，会开始清理 fixture；内部异步操作未必已经结束。旧 `afterEach` 停服务器、恢复环境变量、删除目录，却没有持有并等待评测 Promise。日志证明发生了超时与迟到错误；清理与内部工作之间存在缺少等待的代码事实，但我们不能从这一次日志精确推断每个调度时刻。

本次修复限定在测试夹具：操作预算 10 秒，文件内测试预算 30 秒，清理预算 15 秒；部分用例会执行两轮评测，因此外层还要容纳两轮及断言。生产评测默认值没有修改。显式测试 100ms 业务超时的场景仍使用 100ms，不会被新默认值覆盖。[测试实现](../../../src/runtime/test/research-evaluation.test.ts)

时间预算之外，还增加 fixture 自己的 AbortController 和在途 Promise 集合。清理先 abort，再等待所有拥有的评测结束，最后停止服务器、清除定时器、恢复环境与删除临时目录。退出状态下拒绝启动新评测，防止已超时测试的后续步骤重新创建工作。新增回归先等服务器实际收到请求，再触发清理，验证评测返回 cancelled、在途集合为空、工作目录仍在，然后才释放环境。

```text
测试结束 / 外层失败
  → fixture 发出取消
  → 等待评测内部 finally 与 waitForIdle 完成
  → 确认在途评测已结算
  → 停服务器、清定时器
  → 恢复环境变量、移除临时目录
```

“取消信号已发出”和“资源已释放”是两个事件。只写 `abort()`，不能推出再也没有迟到回调。

### 6.2 真实 Python 进程也被更短的测试期限杀掉

全量历史扩展后，新发现的 [38917440064](https://github.com/yangjingo/oh-my-quant/actions/runs/38917440064) 在真实 Python import 测试中执行约 5016ms，日志明确记录 killed dangling process。内部探针允许子进程运行 10 秒，外层测试仍默认只给 5 秒。[历史 Python 探针](https://github.com/yangjingo/oh-my-quant/blob/076b78661e61660e4e1c8b0cf7830f72714615e5/src/skill/python-probe.ts) · [进程入口](../../../src/source/src/akshare-python.ts)

最初在隔离分支验证的修复，是只将真实进程用例设为 15 秒，让内部 10 秒期限先产生结果。但随后 main 合并 #35，删除了旧探针模块与测试。本次同步基线后移除了这个已无适用对象的改动，不重新引入废弃代码。[历史测试](https://github.com/yangjingo/oh-my-quant/blob/076b78661e61660e4e1c8b0cf7830f72714615e5/src/skill/test/python-probe.test.ts) · [#35](https://github.com/yangjingo/oh-my-quant/pull/35)

原修复针对的是期限关系。它不能证明 Windows 冷启动永远小于 10 秒，也不能被表述为所有 flaky tests 已消失。如果之后仍失败，要继续检查解释器选择、进程启动和 runner 负载，而不是无限增加数字。

### 6.3 取消要验证事件顺序，归档清理要等待整个使用者

新增的 Skill 取消失败已经由 [Issue #37](https://github.com/yangjingo/oh-my-quant/issues/37) 留下可复现反例：在 fixture 收到请求前插入 1100ms 准备耗时，旧测试把这段时间也计入“取消小于 1000ms”。这证明旧断言混合了两个阶段，不能证明 CI 当时具体是哪一段启动变慢。

本次服务器保留受控的成功响应 barrier。测试等待请求到达，主动取消，然后要求命令结算时响应仍未放行；保留原始取消原因、没有成功结果、没有正常 assistant stop、streaming=false 的断言。未取消路径仍必须正常完成。15 秒外层预算只用于发现挂死，不再冒充取消性能指标。若实现忽略取消并等待正常回答，barrier 不会释放，测试就会失败。[用例](../../../src/runtime/test/skill-command-cancellation.test.ts)

YTD 用例的 ENOENT 则来自另一个资源使用者：[research-decisions.test.ts](../../../src/runtime/test/research-decisions.test.ts) 在一项测试内创建多份真实锁定归档。旧清理会删除目录，但被外层期限中断的 Promise 仍可能继续写。只等一个 `saveBars` 还不够，因为它结束以后测试会继续生成另一份 fixture 和报告。本次持有完整测试 body 的 Promise，清理等待其结算再恢复环境；存储集成用例使用 30 秒预算，全部证据范围断言保留。无限挂起依然由测试和清理预算报告失败，不能声称 JavaScript 的任意 Promise 可以被强制取消。

### 6.4 同样的错误也藏在文件路径和机器环境里

Linux 凭证回归曾把 fixture 根路径写成 `C:\private-paper`。生产代码在 Linux 正确拒绝了这个非绝对路径，测试却期待先收到缺少凭证的错误。历史修复使用 `resolve()` 生成平台原生绝对路径，保留原凭证断言。[失败](https://github.com/yangjingo/oh-my-quant/actions/runs/38602368594) · [修复提交](https://github.com/yangjingo/oh-my-quant/commit/5be9cdf6b7d12793b629e650f5b14c7678170da5)

Doctor 的“所有提示为空”则依赖开发机已有 Python/AKShare。干净 runner 没有这些依赖，不应该被测试解释为产品错误。后续用显式缺 Python fixture 检查结构化失败，而不是假定机器总是健康。CLI 子进程也改为等待实际退出并读完输出，避免将空退出状态当作正常结果。[失败](https://github.com/yangjingo/oh-my-quant/actions/runs/38603140139) · [当前入口回归](../../../tests/app/index.test.ts)

更早的 Git skill 安装测试在 Windows 短路径与长路径别名上，把同一目录误判为不同仓库。修复比较目录身份，而不只比较路径字符串；这保留了“不可更新另一个仓库”的保护。[失败](https://github.com/yangjingo/oh-my-quant/actions/runs/38155354275) · [历史修复](https://github.com/yangjingo/oh-my-quant/commit/e35fdd2bff884adef9fc43f586b57972a0e91790) · [当前实现](../../../src/skill/installer.ts)

共同点是：**测试把开发机的偶然条件写成了产品必须满足的条件。** 跨平台矩阵的价值，是把这些条件暴露出来。删掉矩阵会减少红灯，也会同时删掉这类发现能力。

## 7. UI 超时之后，要看用户实际看到了什么

两次桌面 smoke 都停在等待界面文字的步骤，但它们不是同一种问题。只看 `TimeoutError`，会把测试编排和产品渲染混在一起。

第一次，[38156420320](https://github.com/yangjingo/oh-my-quant/actions/runs/38156420320) 在面板轮换时等待标题超时。原始截图仍显示 portfolio 面板，下面已经出现下一条命令的部分输入。脚本发出 Escape 后立即开始下一次输入，没有确认旧面板已关闭。后续修复增加关闭状态等待，并使用具体面板标题匹配。[修复 4aaf630](https://github.com/yangjingo/oh-my-quant/commit/4aaf630a9a10e24b1d210e3cf5eedb7718125c58)

![历史失败：旧面板仍显示，下一条命令已经开始输入](../../assets/ci-panel-transition-failure.png)

图为上述 Windows Actions 运行保留的 `failure.png`，属于历史失败证据，不是本次修复后的产品截图。它支持状态交接没有完成的判断，不能据此还原所有按键调度时刻。

第二次，[38234986954](https://github.com/yangjingo/oh-my-quant/actions/runs/38234986954) 已经走到多行粘贴，等待第二行 `/exit` 可见却失败。原始图中只看到第一行中文，第二行没有显示。这次后续修复落在 TUI composer 的多行绘制、换行和输入窗口，并补了 paste 回归；原 smoke 随后成功。[产品修复 8ba86ae](https://github.com/yangjingo/oh-my-quant/commit/8ba86ae3d6ab335d5013ffa797f8993e6373812b) · [后续成功运行](https://github.com/yangjingo/oh-my-quant/actions/runs/38236094545)

![历史失败：多行粘贴后第二行不可见](../../assets/ci-multiline-paste-failure.png)

这里不能把超时全部归为 runner 慢。第二次暴露的正是发布应用的可见行为缺陷。正确措施是保留 E2E 的拒绝能力，修产品，再用同一行为检查验证；用更宽泛的文本匹配让它通过，会丢掉原本有效的保护。

Anthropic 的 [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) 讨论过 Agent 仅用局部测试就过早宣布完成的问题，以及真实浏览器验证的作用。对本项目，可迁移的机制是让完成声明依赖可观察行为；其 Web 示例并不能直接证明 Windows 安装器和终端绘制正确。

## 8. 构建、安装与启动是三个不同的验收对象

早期 Desktop 红灯还揭示了另一条边界：编译通过不意味着安装成立，安装成立也不意味着发布应用可用。

| 失败机制 | 原来的隐含假设 | 已在历史提交完成的修复 | 仍需保留的验收 |
| --- | --- | --- | --- |
| Bun Windows compiler 解包失败 | 在线 compiler 下载与解包一定成功 | 下载固定版本 runtime、核对 SHA-256，再显式指定 compile executable | 固定版本与实际文件哈希对应；下载失败仍应失败 |
| 干净 runner 缺少 `yaml`、`ignore` | 开发机依赖树里的包等同于直接依赖 | 将真实 import 对应依赖写入清单和锁文件 | 冻结安装、类型检查、独立打包启动 |
| HKCU Uninstall 根键不存在 | 机器上必然曾经安装过应用 | 枚举前检查注册表路径存在性 | 首次安装、升级和卸载路径都能验收 |
| DisplayName 带版本号 | 安装器展示名始终固定 | 调整识别规则以匹配实际安装项 | 不把其他应用误识别成本应用 |
| Unicode 快捷方式目标读取错误 | 两种 COM 接口返回的路径等价 | 使用 Shell.Application 的链接目标读取 | 目标仍严格位于选择的安装目录 |

这些故障分别可在 [compiler 运行](https://github.com/yangjingo/oh-my-quant/actions/runs/38156159819)、[依赖运行](https://github.com/yangjingo/oh-my-quant/actions/runs/38583475117)、[首次安装运行](https://github.com/yangjingo/oh-my-quant/actions/runs/38591545423)和 [Unicode 运行](https://github.com/yangjingo/oh-my-quant/actions/runs/38592615490)中追踪。当前执行入口是 [prepare-runtime.ps1](../../../desktop/scripts/prepare-runtime.ps1)、[build.ts](../../../desktop/scripts/build.ts)和 [test-install.ps1](../../../desktop/scripts/test-install.ps1)。compiler 日志只证明提取失败并提示下载可能不完整，不能直接证明某一网络服务是根因。

这些验收有实际副作用。安装、覆盖升级、卸载测试应该运行在可丢弃的 GitHub runner 用户环境；开发机上运行一次打包命令，不能替代安装验收，也不应为了补一项检查冒险改变日常安装。

## 9. 门禁必须覆盖被交付的对象

原来的根 `check:release` 覆盖类型、架构、quality、测试、CLI 与十二篇文档合集，但不包含 `desktop/` 的独立构建，也不包含 `site/` 的站点构建。与此同时，Desktop workflow 原来只在 main push 和手动 dispatch 执行。于是一个 PR 可以在合并前得到根 CI 成功，第一次真正安装验收却发生在合并后。

这不是把根命令改名为“完整检查”就能解决的问题。必须逐项列出交付对象和对应消费者：

| 交付对象 | 本次安排 | 证据边界 |
| --- | --- | --- |
| 根源码与 CLI | Windows、Linux 完整 release gate | 不包含真实 provider 可用性 |
| npm tarball | 两个平台在 checkout 外安装并用 Node 读取版本 | 不代表 npm OIDC 发布成功 |
| 网站 | Linux 上执行 `site/scripts/build.mjs` | 构建和内容约束，不代表浏览器布局或部署成功 |
| Windows 应用 | 所有 PR/main push 执行 `Desktop required`：类型、打包、安装及交互验收 | Windows runner，不代表所有用户机器与签名策略 |
| PR 元数据 | 可信分支 PR policy，校验当前开放 PR | 不原子锁住 Issue，也不自动判断业务范围 |

Desktop 不再复制一份不完整的根 Windows 检查。PR 和 push 已有独立 CI；手动 Desktop dispatch 则复用整个 CI workflow，并让发布依赖它和安装验收都成功。这样，当根 gate 增加新阶段时，手动发布也会得到同一套检查。[CI](../../../.github/workflows/ci.yml) · [Desktop](../../../.github/workflows/desktop.yml)

我们暂时选择所有 PR 都跑 Desktop，不做路径过滤。这增加文档 PR 的耗时和成本，但避免遗漏共享 CLI/runtime 对桌面应用的影响，也避免必需检查因为整个 workflow 被过滤而迟迟不报告。以后若优化，应先建立可靠的影响范围映射，让总是出现的聚合门禁区分“确认不受影响”和“执行失败”，而不是直接跳过 workflow。

### 取消旧运行，不等于掩盖失败

新 concurrency 按 workflow 与 PR/ref 分组，仅对 PR 取消过时运行；main 和手动发布不主动中断正在进行的验收。复用 CI 的 caller 也进入分组，防止根 CI 与手动 Desktop 的根检查彼此取消。[GitHub concurrency 语义](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

`CI required` 仍用 `always()` 收集结果，并且只有所有平台成功才通过。上游取消而聚合失败，是拒绝把不完整证据当成功；查看历史时要分类，不能删除这个判断以美化统计。本次增加 14 天保留的 release 日志 artifact，方便定位第一处失败，但 artifact 没有生成时必须如实说明，日志也不是永久审计存储。

### 没有 checks 时，先检查 PR 是否有冲突

GitHub 对有 merge conflict 的 PR 不运行普通 `pull_request` 工作流；`pull_request_target` 仍可能执行。因此“policy 有结果，CI 没出现”不必然是 Actions 坏了。[官方事件说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

正确步骤是先看 mergeability、base/head 和依赖 PR，解决冲突、同步基线，再验证新的合并候选。反复重跑旧任务或者推空提交，只会增加历史噪声。这个操作已写入 PR Skill，和“最后一次正文编辑后重新核对 policy”放在同一处，避免规则分散。

这些 job 只有被平台规则要求，才会实际阻止合并。审计发现 main 尚无 branch protection/ruleset；本次代码不声称已替维护者完成平台配置。建议后续将 `CI required`、`PR policy` 和 `Desktop required` 纳入 main 的必需检查，并以故意失败的测试 PR 验证阻塞效果。不要只截图设置页面就宣布门禁有效。

## 10. 三个公开仓库提供了什么可以迁移的机制

外部源码采用固定提交，避免文章中的判断随 main 漂移。下面只陈述公开文件能支持的事实，不推断私有 ruleset、内部运行统计和未公开流程。

### 10.1 Codex：不同验证可以在不同阶段承担不同责任

在 [openai/codex 的工作流说明](https://github.com/openai/codex/blob/4eb4a65407d98cebc4c83bf13be440b9fbc78a7c/.github/workflows/README.md)中，PR 验证围绕合并候选组织：Bazel 承担主要 Rust 合并前检查，Cargo 的合并前任务相对轻，较重 Cargo 矩阵与 nextest 分片安排到 main 合并后。它不是每个提交在每个阶段都执行同一套完整矩阵。

其 [blocking-ci.yml](https://github.com/openai/codex/blob/4eb4a65407d98cebc4c83bf13be440b9fbc78a7c/.github/workflows/blocking-ci.yml)调用多个可复用工作流，再由 `CI required` 检查依赖结果。可借鉴的是：每个阶段的职责明确，聚合检查针对同一次候选执行，不能用“另一个 workflow 昨天通过”代替。对于我们的 Windows 安装体验，合并后才发现真实交互缺陷的成本较高，因此此次把 Desktop 提前到 PR 阶段；不能因为 Codex 有重型合并后测试，就把自己的安装检查后移。

OpenAI 的 Harness Engineering 文章还讨论了其内部场景中较少阻塞门禁、快速后续修复的取舍。这是特定团队的吞吐策略，与公开 Codex 的配置不是同一个证据对象，也不是所有应用都该忽略 flaky checks 的建议。选择发生在哪个阶段，需要同时看检测成本和逃逸成本。

### 10.2 DSH：把可靠性写成能执行的诊断步骤

[deepseek-ai/deepseek-harness 的 CI](https://github.com/deepseek-ai/deepseek-harness/blob/1517a4dbca0a2789ff1d41ba439600f8547d23fa/.github/workflows/ci.yml)包含 Node 兼容性、Python、原生 Windows 等任务，并用 `all checks passed` 检查明确列出的依赖。这里要读 `needs`，不能只读 job 名称：该快照中 `windows-coverage` 存在，但没有列入这个聚合依赖，不能声称全部任务都被它强制覆盖。

更值得借鉴的是 [dsh-ci-test-reliability](https://github.com/deepseek-ai/deepseek-harness/blob/1517a4dbca0a2789ff1d41ba439600f8547d23fa/.agents/skills/dsh-ci-test-reliability/SKILL.md)：排查进程、文件和共享主机层面的并发；使用动态端口与独立临时目录；恢复环境；等待实际状态而不是固定睡眠；取消以后等待清理结束。这直接对应本次评测 fixture 的问题。单纯复制其超时数字没有意义，复制“谁创建、谁持有、谁取消、谁等待退出”的责任关系才有价值。

[dsh-pre-push-checks](https://github.com/deepseek-ai/deepseek-harness/blob/1517a4dbca0a2789ff1d41ba439600f8547d23fa/.agents/skills/dsh-pre-push-checks/SKILL.md)将本地检查按变更范围选择，完整矩阵交给 CI；本仓库当前仍要求提交前完整 release gate。两者并不需要保持一致：本地机器成本、CI 排队时间、变更频率和漏检代价不同。后续优化应该用实际耗时和失败发现位置决定，而不是为了让 Skill 看起来先进就改成局部验证。

DSH 的 [issue-policy](https://github.com/deepseek-ai/deepseek-harness/blob/1517a4dbca0a2789ff1d41ba439600f8547d23fa/.github/workflows/issue-policy.yml)与 [issue-lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/1517a4dbca0a2789ff1d41ba439600f8547d23fa/.github/workflows/issue-lifecycle.yml)也分开验证和生命周期写操作。当前快照前者使用 `pull_request`/review 事件，并检出默认分支策略；不能把旧版本或本项目的 `pull_request_target` 写法套到它身上。我们借鉴职责分离，仍需根据自己的事件、fork 权限和凭证安排实现。

### 10.3 ZCode：架构约束需要有适用范围与遗留基线

[zai-org/ZCode](https://github.com/zai-org/ZCode/tree/aac4755666d09fdcd70272fcf063c077a639015f)的公开根目录在本次快照中没有 `.github`；因此本文不把它列为已核验 GitHub Actions 的例子，也不推断它完全没有 CI。可阅读的是仓库里的 [AGENTS.md](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/AGENTS.md)、[architecture-policy.yaml](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/architecture-policy.yaml)和 [architecture-governance Skill](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/.agents/skills/architecture-governance/SKILL.md)。

它把架构约束拆成明确管理的模块、边界与文件规模限制、带理由的例外和已有问题的 baseline。检查 changed 范围及其受影响依赖，而不是声称所有遗留模块已经合规。Skill 还要求先理解模块职责，不把更新 baseline 当作消除新问题的默认方式。

这对我们的 Desktop/apps 迁移讨论尤其相关。目录名称是可判定条件，状态归属、依赖方向、renderer 与宿主边界需要更具体的契约和检查。先确定计划与责任，再把稳定约束写进架构检查；不能让一个当前的 `src/` 路径规则提前强制尚未定案的未来结构。

读取规则也要继续追到消费者。[package.json](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/package.json)中的 `verify:pre-push` 实际包含 lint、changed architecture check 和 affected unit tests；只复述 AGENTS 中较短的标签会漏掉后者。**文档告诉我们去哪里找，真正执行的命令决定做了什么。**

## 11. Skill 的价值在于把失败经验压成操作，不是增加指令数量

Mitchell Hashimoto 在 [My AI Adoption Journey](https://mitchellh.com/writing/my-ai-adoption-journey) 中把 harness 工作的一部分描述为：遇到 Agent 的错误行为后，改进指令或者可用工具，让后续工作更容易做对。本项目可以用更具体的反馈链落实这个想法：

```text
观察失败 → 保留反例 → 定位错误假设
        → 选择责任层 → 改脚本/工具/Skill
        → 重放反例 → 确认正常情况仍通过
        → 在真实交付环境验证 → 更新当前文档
```

例如，本次“最后一次正文编辑后还要等待新 policy”属于 PR Skill 操作步骤；“开放 PR 的 Issue 必须有效”属于脚本拒绝条件；“已合并后不再做开放态判断”属于状态机；“必须通过哪些 job”属于平台设置。把四句话全部塞进 AGENTS，能增加文本，不能自动修复其中任何一个执行层。

一个可维护的规则通常有六项信息：触发条件、要读取的事实、执行动作、验收证据、失败处置、适用例外。并非要为每条规则写六个小标题，而是检查关键部分有没有遗漏。比如 worktree 清理需要先确认实际合入、没有依赖与未交付提交、私有数据已经保留，再以远端 head lease 删除确切 ref；“合并后删分支”五个字无法覆盖这些动作。

本次没有复制另一套 review Skill，也没有重写正在进行的 [#38](https://github.com/yangjingo/oh-my-quant/issues/38) / [#39](https://github.com/yangjingo/oh-my-quant/pull/39) 评审方法工作。这里补的是已有 PR Skill 中与工作流故障直接相关的两项规则。并行工作相交时，先确定谁拥有哪个问题，避免两个 PR 各自新增一套相近规范。

## 12. CI 成功之后，Ops 仍有自己的任务

CI 主要回答受控输入下，这次改动是否满足已知契约。运行中的 provider 凭证、网络、限流、缓存新鲜度和模型行为持续变化；它们需要独立的运行检查。当前审计没有找到定时 provider 运维工作流，不能把 `test:providers` 命令存在写成已经持续监控。

建议后续单独建设只读、预算受控的 provider 探针：记录阶段、耗时、错误分类与数据时间；凭证缺失、权限拒绝、限流、空数据、陈旧缓存分别报告；不打印 token，不触发交易；失败保留有限诊断。先证明它能区分应用回归与外部服务变化，再决定告警接收者和频率。这是提案，不在本次交付里假装已部署。

发布则需要另一条证据链。npm Trusted Publishing 的 provenance 说明产物来自哪个身份和构建，不保证应用正确；dry run 不证明 OIDC 配置有效。此次历史没有真正的 npm publish 运行，因此不能宣称发布链路已经验收。[现行发布说明](../../quant-harness/ci-release.md)

Desktop 本次增加发布前的 main 分支、稳定版本与 CLI/Desktop 版本一致性检查，并继续让发布依赖检查和安装验收。用实际 YAML 内的 guard 执行反例测试，覆盖分支、tag、预发布版本与版本不一致。它缩小误发布空间，仍不能证明用户机器的 Code Integrity、签名和杀毒策略全部接受安装包。

衡量改善时，不要以“把红灯数量降到零”为唯一目标。至少区分首次失败率、同版本重跑恢复率、修复后的复发率、各阶段耗时与逃逸到 main 的缺陷。取消的旧 PR 运行单独计数；一个失败引起多个聚合红灯只算一次事件；历史红灯不会因为修复而变绿。现在的数据量小、触发条件也已改变，本文不据此给出团队效率提升百分比。

## 13. 失败清单：每一个结论回到具体运行

以下是最初冻结快照中的全部 16 次失败。表中“历史已修”指代码在本次分支之前已经变更，不代表本轮重新复现了所有旧环境；“本次”只指本文配套改动，实际远端结果要以交付 PR 为准。

| Run | 失败阶段与可确认原因 | 处理归属 |
| --- | --- | --- |
| [38918415702](https://github.com/yangjingo/oh-my-quant/actions/runs/38918415702) | #28 policy 检出旧 base，脚本不存在 | 本次对齐事件策略 SHA |
| [38917440064](https://github.com/yangjingo/oh-my-quant/actions/runs/38917440064) | 真实 Python 测试外层 5s 先于内部 10s 期限 | 后续 #35 已删除旧模块；保留历史教训 |
| [38908970604](https://github.com/yangjingo/oh-my-quant/actions/runs/38908970604) | #22 合并后 Issue 关闭，被当作开放 PR 失败 | 本次生命周期校验；补最终正文检查流程 |
| [38907862456](https://github.com/yangjingo/oh-my-quant/actions/runs/38907862456) | #22 policy 旧 base 缺少脚本 | 同第一行，不能只同步一个旧 PR |
| [38680849899](https://github.com/yangjingo/oh-my-quant/actions/runs/38680849899) | Windows research evaluation 5s 超时，随后迟到异步错误 | 本次预算和 fixture 取消、等待清理 |
| [38603140139](https://github.com/yangjingo/oh-my-quant/actions/runs/38603140139) | CLI 子进程状态与 Doctor 开发机假设 | 历史已修，等待退出与显式环境 |
| [38602368594](https://github.com/yangjingo/oh-my-quant/actions/runs/38602368594) | Linux 测试使用 Windows 绝对路径 | 历史已修，平台原生路径 |
| [38592615490](https://github.com/yangjingo/oh-my-quant/actions/runs/38592615490) | Unicode 快捷方式目标解析 | 历史已修 COM 读取方式，保留目录断言 |
| [38591853539](https://github.com/yangjingo/oh-my-quant/actions/runs/38591853539) | 缺少 HKCU 卸载根键；provider 请求未在短预算内发出 | 历史已修路径存在性和测试预算 |
| [38591545423](https://github.com/yangjingo/oh-my-quant/actions/runs/38591545423) | 干净机器注册表根键不存在 | 历史已修首次安装前提 |
| [38589849838](https://github.com/yangjingo/oh-my-quant/actions/runs/38589849838) | provider 250ms 启动预算；Doctor 环境假设 | 历史已修，保留中止行为断言 |
| [38583475117](https://github.com/yangjingo/oh-my-quant/actions/runs/38583475117) | 缺少直接依赖 yaml、ignore | 历史已修清单和锁文件 |
| [38234986954](https://github.com/yangjingo/oh-my-quant/actions/runs/38234986954) | 多行粘贴第二行不可见 | 历史产品修复，非通用超时豁免 |
| [38156420320](https://github.com/yangjingo/oh-my-quant/actions/runs/38156420320) | 面板关闭与下次输入缺少状态等待 | 历史 smoke 编排修复 |
| [38156159819](https://github.com/yangjingo/oh-my-quant/actions/runs/38156159819) | Bun Windows compiler 提取失败 | 历史固定 runtime + SHA-256 + 显式路径 |
| [38155354275](https://github.com/yangjingo/oh-my-quant/actions/runs/38155354275) | Doctor 环境假设；Windows 8.3 路径误判仓库身份 | 历史环境 fixture 与目录身份修复 |

8 次取消运行是 `38907411029`、`38906719593`、`38906716456`、`38906711665`、`38593460526`、`38234809279`、`38155780744`、`38155606582`。其中 3 次的 `CI required` 因上游取消而失败；它们不计入上表 16 次 workflow failure。

这份清单的作用不是证明已经没有未知故障，而是让每项修复有具体对象。新的失败仍可能出现；下一次应该继续保存首次证据、识别错误假设、修在正确责任层，然后用最终版本完成同一条验证链。Agent 的执行速度越快，交付证据越不能靠记忆和口头串联。

## 14. 本次验证：正向通过，还要证明检查仍能拒绝错误

配套修复由 [Issue #40](https://github.com/yangjingo/oh-my-quant/issues/40) 跟踪。2026-10-17–18 在独立 Windows worktree、Bun 1.3.14、Node v25.8.1 上，`bun run check:release` 完成：2,686 tests / 299 files / 0 failures，26 项 policy/实际 YAML guard 检查通过，类型、架构、CLI 和文档构建/链接检查通过。网站单独构建得到 4 个本地化页面和 6 个公开内容入口。CI 使用 Node 24，最终平台结果必须查交付 PR，不能由这次本地 Node 25 结果代替。

为避免把“在快机器上又通过一次”当作修复证据，另做了六组对照。旧用例取自 main `1d4488f`；修改版取自本次分支；负控仅修改临时验证副本，生产源码没有改动。

| 对照 | 操作 | 实际结果 |
| --- | --- | --- |
| 旧取消测试 | 每个 HTTP 请求进入 fixture 前等待 1100ms | 3 个取消路由均因旧总耗时断言失败 |
| 新取消测试 | 相同准备延迟 | 3 个取消路由全部通过，响应仍未放行 |
| 忽略取消负控 | 临时副本不向 handler 传 commandSignal | 3 个路由均无法在响应 barrier 前完成，按预期超时失败 |
| 旧 YTD 测试 | 每次创建归档 fixture 前等待 5500ms | 外层 5000ms 超时失败 |
| 新 YTD 测试 | 相同两次慢 fixture | 约 11.8 秒完成，范围与证据断言通过 |
| 新清理顺序负控 | 保留慢 fixture，将临时副本外层期限缩为 1000ms | 仍报告超时失败，但等待完整工作结算后清理；没有 ENOENT 或迟到未处理错误 |

最后一项没有把失败变成成功。它验证的是：即使测试自身失败，也不会立即拆掉仍被使用的环境。测试挂死和资源清理仍各有预算；这种对照不证明任意永久挂起都能安全恢复。

慢请求可以用 Bun preload 包装 `Bun.serve` 的 `fetch` 重现，等待插在调用原 fixture 之前；慢归档则在 preload 中包装 `annualComparisonFixture`，保留原存储代码与断言。临时测试副本位于忽略的 `output/`，单独执行时显式覆盖测试路径过滤；正式 `check:release` 的发现范围与断言没有因此改变。原始日志留作本地诊断，公开文章保留实验条件和结果，不发布完整环境日志。

本次没有发布 npm 或 GitHub Release，没有启用 main ruleset，也没有新增定时 provider 探针。可信 policy 的线上代码切换要等修复进入默认分支；本 PR 的 `pull_request_target` 成功只能证明当时默认分支版本的检查成功。这些边界和最终 CI 链接应留在交付说明中，避免下一轮又把“本地已实现”“PR 已通过”和“main 已生效”合并成一个完成状态。

### 远端首轮又暴露了一个遗漏：skip network 不等于隔离机器环境

[PR #41 的首次 CI](https://github.com/yangjingo/oh-my-quant/actions/runs/39047623864) 中，Ubuntu 通过，Windows 的两项 Doctor handler 测试分别在约 5009ms 和 5001ms 超时，日志记录 killed dangling process。同一 head 的 [Desktop 安装与交互验收](https://github.com/yangjingo/oh-my-quant/actions/runs/39047623704) 成功。这是交付过程新增证据，不混进前述 61 次历史运行的分母。

两项测试设置 `WHYJ_DOCTOR_SKIP_NETWORK=1`，却直接调用默认 `doctorHandler`。这个开关只跳过网络阶段，Tools 阶段仍通过 `checkAkshareDependency` 启动真实 Python。收集器允许探针 30 秒，单元测试外层只有 5 秒。它们的验收目标其实是文本报告和 TUI 状态推送；宿主机进程不属于这个目标。早先修过独立 Doctor 测试与 CLI 子进程 fixture，并不能推出所有 Doctor 入口都完成了隔离。

后续修复使用已有 `createDoctorHandler` 和 `checkDependency` 注入口，显式提供 ready/Python fixture，保留真实 collect、format 和 onState 通路，并断言报告确实包含这个依赖状态；关闭该测试的日志写入，移除对全局 skip-network 环境变量的临时修改。[handler 测试](../../../src/cli/test/handlers/system.test.ts) · [Doctor 依赖测试](../../../src/cli/test/doctor-tools.test.ts) · [实际 CLI 进程测试](../../../tests/app/index.test.ts)

这里的教训与增加超时不同：先确认正在测试哪一层，再决定哪些环境应真实、哪些依赖应显式控制。生产 Doctor 的 Python 行为没有改，已有进程与缺失依赖矩阵仍保留；修复后要重新跑完整 gate 和最终提交的远端 CI，不能拿前一提交的 Desktop 成功作为最终验收。

补充对照将 `runPython` 替换为永不结算的测试 Promise：旧 handler 测试在 5 秒处稳定失败；修复版仍通过，并验证报告包含显式 dependency fixture。这个故障注入没有启动真实挂死进程，证明的是格式化测试不再依赖宿主探针，不证明生产 Python 的任意挂死都已解决。
