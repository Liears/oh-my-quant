# Skills：安装、发现与调用资格

更新：2026-10-13。本页统一维护技能的完整生命周期，不再把“文件装到了磁盘”“模型看见名称”和“本轮可以执行”混成一个 ready。命令参数见 [Slash 参考](./slash-commands.md)，会话和图片边界见 [Harness](./README.md)，误判与修正见[能力与技能](../blog/04-capability-and-skills.md#readiness)。

<a id="installation"></a>

## 1. 安装与更新

交互启动可在后台补齐缺失的默认精选仓库；headless 不自动下载。目录已存在会跳过安装，不代表完整、兼容或可调用。一个仓库失败不阻止检查下一个，取消则停止后续工作；进程内同一目标路径的并发安装拒绝。

新安装在不可被发现的临时目录中完成 clone、HEAD 和核心文件检查，再原子重命名到目标。失败只清理本次临时目录。已有目录更新先检查仓库根、origin，以及 tracked/untracked/ignored 文件；有用户变化则拒绝，不执行 reset、stash 或删除重装。更新采用明确的快进策略；精选目录使用审阅提交，普通外部仓库没有同等固定版本保证。fetch 可能修改 Git 元数据，不能把失败描述成字节完全没变。

退出会取消 Git 进程树（Windows）或进程组（Unix）并尝试清理。进程内保护不等于跨进程锁，也不保证崩溃后没有临时文件。安装成功才发布技能 revision，空闲会话在下一次列表/独立请求准备时重读；进行中的请求与已排队 follow-up 保留旧快照。准备失败保留旧资源，任意编辑文件不会自动热加载。

第三方技能的功能、工作流与使用教程直接参考上游，不在本页逐项复述：

| 上游文档 | 本项目固定版本 |
|---|---|
| [LLMQuant/skills](https://github.com/LLMQuant/skills) | [已审阅提交 1918237](https://github.com/LLMQuant/skills/tree/1918237467c2dff4cc97a18ebc0892dfd46e8129) |
| [Claude Trading Skills](https://github.com/tradermonty/claude-trading-skills) | [已审阅提交 a2506fd](https://github.com/tradermonty/claude-trading-skills/tree/a2506fd1bab662723fb7142734320fef23fc48fa) |

上游能力介绍不是本项目的就绪承诺；本地精选范围与模式要求以 [catalog](../../src/skill/catalog.ts) 和实际检查结果为准。

默认只展示精选白名单，不因上游新增文件自动扩张。自定义目录由 `OHQUANT_SKILLS_DIR` 等明确配置确定；普通仓库按其 skills 子目录或根目录发现。精选资格同时绑定实际路径和文件内容，不能因为项目中存在同名技能就附上精选认证。

<a id="discovery"></a>

## 2. 发现、模型索引与显式调用

项目祖先的 `.agents/skills`、`.pi/skills` 及额外配置路径参与发现。外部用户级 Codex/Claude/Agents/Pi 路径默认关闭，只有打开 externalSkills 才参与；旧设置按兼容迁移规则合并，设置字段以[配置参考](./configuration.md)为准。

`SKILL.md` 需要 name 和 description frontmatter；名称为不超过 64 字符的小写字母/数字/连字符，描述不超过 1,024 字符。同名按发现顺序先到者生效，覆盖不是合并文件。

模型默认只收到 `available_skills` 的名称、描述、位置，不把所有正文塞进 system prompt。`disableModelInvocation` 从模型索引排除；普通技能仍可显式调用，但精选技能的 blocked/unverified 不能靠显式命令绕过。显式调用由 `formatSkillInvocation` 包装正文进入模型轮次，用户只看到 `SKILL.<name>` 的 displayText；TUI 折叠重复同名 banner，不回显隐藏指令全文。

可见技能最终依据当前请求工具子集，而非全局注册工具。任务剔除 bash 后，依赖本地资源或执行的技能也需失效。发现缓存可由 `WHYJ_SKILL_CACHE=off` 关闭；该开关不等于刷新已运行会话的资源。

<a id="readiness"></a>

## 3. 资格是有范围的观察

```text
/skill
/skill info technical-analyst --check
/skill info market-breadth-analyzer --check-imports --check-network
/skill info macro-regime-detector --check-imports --check-network
/skill info market-environment-analysis --check-imports
/skill audit position-sizer --json REPORT.json --markdown REPORT.md
```

普通列表和详情不新发 Python、包导入或网络检查。此前成功的文件回执会在读取资格/revision 时有界重读内容：缺失、修改或超限撤销成功并通知空闲会话。恢复原文件不自动恢复资格，需重新显式检查。

| 检查 | 能证明什么 | 不会做什么 |
|---|---|---|
| `--check` | 精选路径的固定文件闭包、声明的 Python/包版本 | 不安装包、导入第三方 workflow、运行脚本、调用模型或联网 |
| `--check-imports` | 包含 Python/包版本与文件检查；同一选定解释器成功导入声明的包 | 不接受任意模块名，不执行 workflow，不代表脚本正确 |
| `--check-network` | 对指定公开 CSV / ETF 样本取得限时网络观察 | 不验证全部外部服务，不保存长期访问权限 |
| `audit` | 固定格式报告与显式输入之间的有限算术/方法核对 | 不授予账户读取或公开私有结果的权限 |

文件内容匹配不等于已核对当前 Git HEAD；安装事务的版本检查与调用资格的文件检查是不同观察。Python 选择与行情请求共用规则。需要包的模式仅版本满足时仍为 unverified，导入失败为 blocked；导入成功后仍须满足文件、网络、输入及能力要求。无 Python 的 LLMQuant 路由也需要固定文件检查。网络回执约 5 分钟有效，绑定解释器、导入/包观察和限定资源；重试失败、取消或状态改变不能接受晚到的成功。修复环境、重启或升级技能后应重新检查，不沿用未经验证的推断。

| 状态 | 含义与行为 |
|---|---|
| requirements-met | 至少一个模式的已声明运行要求有证据；只开放该模式，不认证脚本或回答质量 |
| needs-input | 某模式运行条件满足，但缺本次任务资料；可询问输入，不能先分析或执行 |
| blocked | 所有模式都有已知缺项；从可用索引移出，显式调用返回修复入口 |
| unverified | 没有可用模式且必要条件缺观察；从可用索引移出，要求先核验 |

模式独立判断；“日历助手可用”不等于“市场环境研究可用”。needs-input 不把普通对话自动认证为图表、账户或市场证据；先询问输入的指令不是任意 shell 参数的安全拦截器。

<a id="capabilities"></a>

## 4. 宿主能力与权限边界

默认宿主以真实 bash 工具提供 shell/local-resource-read，但没有通用 web-search、完整 LLMQuant workflow 服务或 private-output 能力。配置日线 API key 不会产生这些能力。model-image 另需实际模型支持和本轮输入通道；见[显式图片](./README.md#images)。

可信宿主或静态扩展可以补能力，须声明真实要求；`requiresTools` 在任务过滤后再核对。单纯声明 capability 不能伪造 bash。自定义 `prepareSkills` 的宿主需要承担自己的策略，不自动继承默认精选限制。

精选资格绑定实际路径和固定文件内容，不认证任意同名外部技能。涉及私有账户输入或输出的模式仍需单独的 private-output 授权；上游能生成报告不等于宿主已经授权读取或公开这些数据。当前机制不是第三方代码沙箱。

<a id="supplied-evidence"></a>

## 5. 已给材料与量化任务不是同一种证据

先识别用户在请求什么，再选择 workflow 和工具。出现 ticker、日期或“风险”一词，不足以强制建立 Quant 归档研究任务。用户给出一份研究快照、要求解释其中权重和风险时，可以在声明的 limited-evidence 模式内回答；只有需要执行受支持计算并以固定输入验收时才建立对应任务。已有任务仍须尊重原 scope，不能借技能调用清空它。

`research_task.read.acceptanceTools` 来自共享受支持核验器，`metricLabels` 是其中部分工具的具体指标目录。不能创造 `supplied_snapshot_audit` 之类并不存在的工具来满足统一模板；也不能把固定 Markdown workflow 的阅读升级为价格/财务已核验。

输入出处和缺项应随回答保留。workspace 的 drift 未提供时应记未知，不因材料中没有该字段就填 0；gross margin 是毛利率，thesis 在研究场景中是投资论点。明确单位的未年化 volatility 可以是合法期间离散度，不能被通用“必须年化”判据一刀切否决。

用户给定分数与权重可交给[显式评分](./quant-tools-design.md#weighted-score)；假设持仓可用[情景计算](./quant-tools-design.md#position-scenarios)。二者只验证所给参数的算术，不证明分数映射、账户真实性或市场结论。有限回答检查仍可能漏掉自由叙述中的错误，必须把流程通过和人工解释审阅分开。

<a id="implementation"></a>

## 6. 实现与回归

| 模块 | 所有权 |
|---|---|
| [installer](../../src/skill/installer.ts)、[catalog](../../src/skill/catalog.ts) | 安装、固定版本与目录约束 |
| [readiness](../../src/skill/readiness.ts) | 无 I/O 的模式资格规则 |
| [runtime skill-store](../../src/runtime/skills/skill-store.ts) | 存储和运行时绑定，不属于 skill 纯模块 |
| [runtime skill-readiness](../../src/runtime/skills/skill-readiness.ts)、[probes](../../src/runtime/skills/skill-probes.ts) | 依赖观察、revision 和请求上下文 |
| [CLI handler](../../src/cli/handlers/skill.ts) | 用户命令、输入与呈现 |
| [会话技能](../../src/agent/src/skills.ts) | 发现、索引与调用内容装配 |

列表、system prompt 和显式调用复用同一资格投影；预检失败发生在模型调用和用户任务 journal 写入前。请求级 `scopeRuntimeSkills` 只按任务缩小已有资格，不偷偷重新联网或探测环境。检查观察在内存中有生命周期，取消不会发布，最后有效代次才可覆盖。

```powershell
bun test src/skill/test src/agent/test/skills.test.ts src/agent/test/chart-image-session.test.ts
bun run typecheck
bun run check:architecture
```

固定工作流/合成输入、实际 Pi + 本地 SSE、真实模型与外部脚本执行是不同验证层。真实模型检查方法见[评测指南](./evaluation.md)，不会从旧的阶段通过数推出当前端到端能力。新增技能必须同时说明模式、输入、所需能力、副作用、失效规则与对应拒绝反例。

关键反例回归：[已给材料会话](../../src/runtime/test/supplied-skill-session.test.ts)、[术语](../../src/runtime/test/skill-terminology.test.ts)、[reference reader](../../src/runtime/test/chart-reference-reader.test.ts)、[运行资格](../../src/runtime/test/skill-readiness.test.ts)。它们分别检验不同边界，不合并成“技能质量通过”。
