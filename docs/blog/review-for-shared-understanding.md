# 多个 PR 都在前进，团队怎样确认它们能一起工作？

工程实践补篇 · 2026-10-17 · WhyJ 分析

这次 review 从一个直接的问题开始：三个开放 PR 与当前 main 有没有分支冲突？#35 替换社区技能与 MCP 的接入方式，#28 统一视觉设计，#27 增加本地研究工作台。它们看起来各有目标，但判断能否合入，需要同时确认代码、基线和证据是否指向同一份系统。

本文使用这次审查的固定提交，讨论一个更具体的问题：**怎样让 review 帮助团队保持简单、共享理解，并且收敛到可交付的改动？** 下面的缺陷来自本地复现，流程建议是 WhyJ 分析；外部文章与讨论只提供参照。这不是团队历史缺陷率调查。

## 一个文档冲突，暴露了三个不同的“当前版本”

审查开始时，本地主工作区还在 `b0b55db`，有大量未提交修改。远端 API 返回的 main 已是 `076b78661e61660e4e1c8b0cf7830f72714615e5`。如果直接在主目录运行测试，结果会混入尚未进入 PR 的代码。因此，本次以远端 SHA 为准，核对本地对象，并在独立 worktree 检查；Git HTTPS 拉取失败，没有被写成一次成功同步。

| PR | 审查 head | 相对远端 main | 本轮关键观察 |
| --- | --- | --- | --- |
| [#35](https://github.com/yangjingo/oh-my-quant/pull/35) | `183559c` | 落后 0、领先 2 个提交；无文本冲突 | 最终 head 的跨平台 CI 成功，局部回归 28 项通过 |
| [#28](https://github.com/yangjingo/oh-my-quant/pull/28) | `a3bb573` | 落后 19、领先 2；docs/README.md 冲突 | 描述仍将 `10184e1` 称为最终实现，之后又追加了站点和图片变更 |
| [#27](https://github.com/yangjingo/oh-my-quant/pull/27) | `999ce68` | 落后 19、领先 15；docs/README.md 冲突 | 当前无 GitHub checks；工作台测试通过，另有元数据反例 |

两个冲突都包含文档导航中的手工文件计数。main 新增了维护说明，视觉分支改变了素材集合，工作台分支新增了功能文档。直接保留任意一侧，都可能漏掉另一侧的信息。这说明公共导航是协作热点；每次增加文档又维护一份总数，会制造与功能无关的冲突。

这里可以做一个小改进：导航维护入口与职责，统计交给工具。它只减少无意义的共享编辑，不能消除正常的功能集成。本次 skill 和博客更新也采用这一原则，保留导航覆盖检查，撤掉易漂移的手工文件总数。

#28 还提醒我们，PR 是会变化的容器。旧提交的全量测试和截图有历史价值，但不能自动覆盖后加的改动。本次在 `a3bb573` 重新跑了类型检查、12 项颜色/可读性测试及站点构建，均通过；这些结果仍不能补齐 Windows 安装和实际运行验收。其红色 PR policy 日志显示缺少 `.github/scripts/pr-policy.mjs`，应按检查基础设施问题处理，不能据此宣称视觉代码有 bug。[失败运行](https://github.com/yangjingo/oh-my-quant/actions/runs/38918415702)

## 测试通过的研究工作台，仍会丢掉项目编辑

#27 的研究主链已有较完整的保护：真实 Pi 循环的本机模拟、取消与继续、固定证据、不可变保存及重启恢复。本轮工作台的 28 项测试全部通过。问题出在新增的另一条状态通路：项目名、置顶和研究标题等元数据。

浏览器读取整份 metadata，在内存修改，再把整份对象写回。服务端调用 `atomicWriteJson` 替换文件。原子写可以避免半个 JSON 落盘，却没有判断客户端是否基于过期版本编辑。[浏览器读取与保存](https://github.com/yangjingo/oh-my-quant/blob/999ce68a5ce5dd951a4121cdef70421cadcde038/src/app/research-workspace/web/app.js#L31) · [服务端存储](https://github.com/yangjingo/oh-my-quant/blob/999ce68a5ce5dd951a4121cdef70421cadcde038/src/storage/src/workspace-meta.ts#L84)

用同一份文件模拟两个标签页即可复现：A、B 先读相同快照；A 新增一个项目并保存；B 重命名原项目并保存。最终文件只剩原项目，A 的新增项消失。两次写入都成功，JSON 也完全有效。这不需要多人账户，同一用户打开两个标签页就足够。修复需要明确的过期编辑策略，例如版本校验并提示刷新，或以项目为单位的更新；只在最后写文件时加锁，仍然会覆盖旧快照。

第二个反例发生在读取失败。当前实现把解析异常统一转换成空项目列表。再进行一次正常编辑，就会用新对象替换原来的损坏文件。本地使用临时截断 JSON 复现时，没有抛错，原始字节也未保留。[异常处理位置](https://github.com/yangjingo/oh-my-quant/blob/999ce68a5ce5dd951a4121cdef70421cadcde038/src/storage/src/workspace-meta.ts#L69)

这两项都是新代码引入的可确认问题，影响的是项目元数据，不代表不可变研究快照也被覆盖。主线已有的 [durable-json](https://github.com/yangjingo/oh-my-quant/blob/076b78661e61660e4e1c8b0cf7830f72714615e5/src/storage/src/durable-json.ts) 会区分文件不存在与文件非法，并提供内容修订标识。值得审查的地方是新通路为什么没有接上已有契约，而不是再设计一个通用存储框架。

**WhyJ 分析：** 本次最值得警惕的是，界面增加一个看似辅助的小功能时，顺带创建了一套新的状态读写规则。研究证据受到严格保护，并不会自动保护项目编辑。review 要沿实际状态通路追到恢复行为，测试数量无法替代这条因果链。

## 把外部经验缩成适合自己的审查方法

Anthropic 的 [How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/) 强调持续验证、核实发现、减少噪声、审批绑定具体提交，并让复审逐渐聚焦增量。它还用事故样本和干净样本评估 reviewer。本文借用这些机制，不照搬其人工审批人数或自动合并策略；公司自述的成效也不构成本团队的效果证明。

[Hacker News 讨论](https://news.ycombinator.com/item?id=50122951) 补充了一个重要分歧：jonahx 担心按需生成局部解释会削弱共享的因果理解；csallen 则认为测试、版本控制及可理解代码仍能支持调试与恢复。这些是参与者观点，没有形成实验结论。本文选择保留一条可操作的要求：评审者应能解释受影响状态由谁拥有、失败在哪里显现，以及如何恢复。无需每个人理解全部实现，但关键交接不能只剩一句“AI 说没问题”。

Google 的 [The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html) 将整体代码健康和持续改进放在一起考虑；[Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) 则强调自包含的变更，而非只看行数。这对本次案例很实用：#35 改了 138 个文件，其中大量是撤销重复实现；#27 只有 22 个文件，却同时增加宿主、页面和元数据行为。文件数不能直接排序审查风险。

我们据此把审查分成三个问题：Git 能否组合文本；组合后行为是否满足契约；最终版本有没有足够的验证。它们分别需要合并检查、调用链与反例、绑定修订的验证记录。任何一个答案都不能替其他两个作答。

这次也检查了 #35 与 #27 的候选组合：源码类型检查、架构边界、测试布局和工作台 28 项回归均通过。文档冲突仍保留，未生成最终合并提交，也未跑三份 PR 的完整组合验收。因此结论是“所检查的兼容路径通过”，没有发现组合缺陷，不能写成“三份 PR 可直接一起上线”。GitHub 的 [merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) 可自动在最新 base 与前序候选上检查，但有可用性和工作流要求；本次未启用。少量 PR 先明确顺序、更新基线再验证，同样能落实这个判断。

## 简洁需要落实在评论、分工和结束条件里

仓库 [AGENTS.md](../../AGENTS.md) 的四条原则可以直接转成 review 的动作，而不再写一套口号：

| 原则 | Review 应做的判断 |
| --- | --- |
| Think Before Coding | 先还原问题、范围、关键假设与非目标，再评价实现 |
| Keep It Simple | 新抽象、配置与状态副本是否真的减少当前问题的复杂度 |
| Make Surgical Changes | 独立功能是否混入；必要接线是否解释清楚；是否保护别人的工作 |
| Define the Goal and Verify It | 每个结论是否对应行为、反例、提交和验证边界 |

一条有效评论可以很短：“两个标签页基于相同快照编辑不同项目，后提交会覆盖前一个新增项目；复现见固定 head 的存储接口；请拒绝过期写入或只更新指定项目。”它已经包含场景、影响、证据和修复目标。再要求作者更换框架、统一所有变量命名，只会稀释这个问题。Google 的 [评论指南](https://google.github.io/eng-practices/review/reviewer/comments.html) 同样建议说明原因，并区分必须修改与可选意见。

多人协作时，每个行为单元需要明确的修复负责人，共享接口需要相关维护者达成同一个契约。评审者先集中报告已确认的问题；作者修复或说明设计依据；复审检查新 diff 与受影响路径。已解决的问题不重复提出，不相关旧问题另行记录。若多轮仍无法达成判断，应明确分歧，考虑缩小 PR 或交由维护者决策，不能用“再来一轮”无限延长。

这次形成的 [review-skill](../../.agents/skills/review-skill/SKILL.md) 只维护审查方法，issue 的范围约定和 PR 的交付检查仍由原有技能负责。默认不增加多人或多 Agent 审批；确有必要且已获授权时才分工，并由一位汇总者去重与核实。衡量它是否有效，后续应观察有效发现、误报、复审轮数和合并后回退；本次只完成规则和案例校验，没有声称这些指标已经改善。

在上述审查快照上，建议先处理具备最终提交 CI 的 #35，再让 #28 更新基线、证据和 Windows 验收，#27 修复元数据问题并补齐最终提交检查。#28 与 #27 没有发现必须依次合并的硬依赖，顺序可以按就绪程度调整。每次 main 前进后，后续 PR 都应重新确认自己的结论仍然成立。

## 合入以后：绿灯仍然有明确边界

后续按授权合入了 #35，main 前进到 `1d4488f7f006510265bc228923b3596d9dd22f36`（2026-10-17 14:59 UTC）。网络恢复后也重新 fetch 并核对了这个版本。本文前面的冲突与领先/落后数字仍属于 `076b786` 快照，不能当成合入后的实时状态。

同一个合并提交上，[通用 CI 成功](https://github.com/yangjingo/oh-my-quant/actions/runs/39043090573)，[Windows desktop 失败](https://github.com/yangjingo/oh-my-quant/actions/runs/39043090574)。失败位于共享 CLI 测试步骤：`recorded-year YTD excludes declarations backed by comparisons extending beyond its cutoff` 报 5000ms 超时，随后记录了临时文件锁路径的 ENOENT。日志证明本次运行失败；还不能证明 #35 引入回归，也不能据此认定只是 runner 偶发波动。此前 main 的桌面运行也失败过，但失败的是另一个 Python 导入测试，[旧运行](https://github.com/yangjingo/oh-my-quant/actions/runs/38917440064) 不能用来证明两者同根因。

这里有一个实际的覆盖边界：[Desktop 工作流](https://github.com/yangjingo/oh-my-quant/blob/1d4488f7f006510265bc228923b3596d9dd22f36/.github/workflows/desktop.yml) 只在符合路径条件的 main push 或手动触发时运行，并不响应 PR 事件。所以“PR 的检查通过”和“合入后的所有适用工作流通过”是两份证据。review 应记录 workflow、事件、受测 SHA、环境、状态和链接，先分类失败，再决定定位或重跑；不能用旧绿灯覆盖新失败，也不能靠反复重跑把失败记录抹掉。

合并后的另一项工作是确认依赖。[#36](https://github.com/yangjingo/oh-my-quant/pull/36) 当时仍以 `refactor/32-pi-community-tools` 为 base。虽然 #35 已交付，这个父分支及其 worktree 仍因开放依赖而保留。后续需要更新子 PR 的基线、复验，再按既有规则清理。合并按钮完成的是代码进入 main；依赖与验证记录也要随之更新。

这些观察已补入 review-skill，属于贡献者的检查方法。本次没有修改工作流、分支保护或自动合并策略，也没有顺带修复产品和测试问题。已有的 [取消计时问题 #37](https://github.com/yangjingo/oh-my-quant/issues/37) 与 [刷新时间戳问题 #34](https://github.com/yangjingo/oh-my-quant/issues/34) 提供了另外的测试边界案例，不能替代对这次新失败的诊断。

## 证据范围与延伸阅读

本次检查固定于上述 SHA；三个 PR 的完整 diff 清单、冲突输出和关键代码路径均已检查，重点动态验证社区技能、视觉语义、工作台状态及候选组合。未逐项重验全部 UI、Windows 安装、真实市场/模型或全部 PR 的 release gate。本文属于有明确覆盖边界的审查记录。

- [#35 最终 head 的 CI](https://github.com/yangjingo/oh-my-quant/actions/runs/39021268590)：远端核实的证据，本轮局部运行不能冒称重跑了该完整矩阵。
- [工作台既有回归](https://github.com/yangjingo/oh-my-quant/blob/999ce68a5ce5dd951a4121cdef70421cadcde038/src/app/research-workspace/test/workspace.test.ts)：研究快照与元数据是不同的验证对象。
- [Google · Speed of Code Reviews](https://google.github.io/eng-practices/review/reviewer/speed.html)：回应时效应服务团队进展，同时保护专注时间；本团队尚未制定新的响应 SLA。
- [方法来源与适用限制](../../.agents/skills/review-skill/references/methods.md)：保留原文入口及本地采用范围，按需要阅读。
