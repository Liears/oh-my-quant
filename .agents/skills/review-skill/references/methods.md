# Review 方法与取舍

阅读日期：2026-10-17。本页用于解释方法，不是每次评审必读的完整检查表。

| 来源 | 可借鉴之处 | 在本仓库的边界 |
| --- | --- | --- |
| [Anthropic · How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/) | 让验证持续发生；核实发现、限制噪声；审批绑定提交；用事故和干净样本评估 reviewer | 公司自述，不能推断本团队效果；不照搬零人工审批、多 Agent 投票或自动合并 |
| [Hacker News 讨论](https://news.ycombinator.com/item?id=50122951) | jonahx 质疑临时生成解释能否替代共享因果理解；csallen 提出版本控制、测试与可读代码的反面论据 | 社区观点互有分歧，不是实验结论；本地采用可定位的状态归属、失败路径与恢复说明 |
| [Google · The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html) | 维护整体代码健康，同时允许非完美的改进前进 | 不把偏好、可选优化和正确性问题混成阻塞 |
| [Google · Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) | 变更应自包含、容易理解和回滚；相关测试与必要消费者随变更提交 | 不设统一行数阈值，也不按目录机械拆断完整行为 |
| [Google · What to look for](https://google.github.io/eng-practices/review/reviewer/looking-for.html) | 关注上下文、复杂度、实际功能和测试质量 | 本仓库优先核对模块接口与状态契约 |
| [Google · Review comments](https://google.github.io/eng-practices/review/reviewer/comments.html) | 评论解释原因，区分必改和可选，评价代码而非个人 | 给最小修复目标，不强制作者采用 reviewer 偏好的实现 |
| [Google · Speed of reviews](https://google.github.io/eng-practices/review/reviewer/speed.html) | 优化团队进展，及时回应，同时尊重专注时间 | 本团队尚未建立响应 SLA；不能冒称已有“一天内”制度 |
| [GitHub · Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) | 对最新 base 和前序候选一起跑检查；使用时需配置 merge_group | 可用性有账号/仓库条件，本次未启用。少量 PR 可顺序更新基线并验证 |

## 本地案例如何使用

2026-10-17，main `076b786`：#35 无文本冲突，#28/#27 各与 docs/README.md 冲突；#28 描述的验证版本落后于 head；#27 新增元数据通路可复现旧快照覆盖与损坏文件静默替换。具体证据见[博客](../../../../docs/blog/agent-repo-infrastructure.md#review)。这些是有限样本，不能称为团队缺陷频率统计。

回归样本应同时包含“确实有缺陷”和“应当放行”的例子。例如：文件多但主要是删除重复实现，不应仅因行数阻塞；已有 CI 失败应先辨别基础设施错误。后续可以观察有效发现、误报、复审轮数与合并后回退，但本次没有建立这些指标的基线，也未证明技能能降低事故率。
