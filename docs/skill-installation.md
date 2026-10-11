# Skill 安装与更新

R07 实施契约，对应 PRD F23。安装、发现、模型调用资格和依赖就绪是不同状态；本阶段先修复安装的数据保留边界，不据此宣布 F23 完成。

`store.ts` 负责默认仓库、发现白名单与存储根目录；独立 `installer.ts` 负责 Git 安装事务，CLI 继续通过 `/skill install owner/repo` 调用。默认启动和手动安装使用同一事务实现。

- 新安装在 skills 根目录下的 `.install-*` 临时目录克隆，校验 Git HEAD 后才 rename 到正式目录。发现过程跳过安装临时目录，失败清理只限本次创建的临时目录。
- 更新前核对目录本身为 Git 根目录、origin 与请求来源一致、工作区没有已跟踪修改、未跟踪或被忽略的文件。生成缓存也可能阻止更新，需要用户先处理；安装器不自动清理。拒绝条件返回具体原因，不删目录、不重克隆、不 reset/stash 用户内容。
- 只允许 fast-forward 更新，并显式关闭 rebase；网络或分叉失败保留原安装，返回原位置和重试提示。Git 自身可能更新 FETCH_HEAD 等元数据，不声称逐字节不变。
- 成功返回实际 HEAD 与来源。默认仓库另按第三阶段的 catalog 固定版本；非默认仓库的 HEAD 回执不代表版本固定，两者均不证明技能依赖可用。
- 回归用 TEMP 中的真实 Git 仓库，替换网络传输地址；检查脏工作区、未跟踪文件、分叉、错误来源、非仓库目录、克隆中断及重试。

后续仍需安装/发现/模型调用/依赖就绪的联合呈现。第二阶段已接入后台安装和可见失败回执，第三阶段补上 [固定精选版本和声明依赖](./curated-skills.md)，第四阶段支持在原会话空闲时刷新安装结果；完整首次安装到调用的终端交互体验与依赖探测仍待验收。下方各阶段记录保留当时的验证范围。

## 2026-09-14 验证记录

新增 [installer.test.ts](../src/skill/installer.test.ts) 的 16 项回归，使用实际 Git 与独立 TEMP 仓库，没有访问或更新用户已安装的技能。网络地址在命令端口替换成本地 fixture；不据此宣布 GitHub 网络可用。包含成功克隆/fast-forward、已跟踪/未跟踪/忽略文件保护、断网保留、分叉保留、来源不符、父仓库误认、临时克隆不可发现、实际 Git 克隆失败和发布前目录冲突。

初次全量 1010 pass / 0 fail 后，追加“忽略文件阻止更新”反例，实际得到 success=true，确认普通 status 检查不足；加入 `--ignored=matching` 后通过。最终全量 **1011 pass / 0 fail，131 文件、10201 断言，68.17 秒**，日志 `%TEMP%/whyj-r07-skill-installer-reviewed.log`。typecheck、architecture（0 baseline violations）、build（2667 modules / 5.96 MB）、diff whitespace 和 83 个本地文档链接检查通过。

```powershell
bun test src/skill/installer.test.ts src/cli/handlers/skill.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

这组证据证明当前安装事务的保留与失败行为，不覆盖跨进程并发升级、进程中途被杀、默认版本固定、UI 安装状态或第三方技能依赖可用性。

## R07 第二阶段实施契约

Git 子进程改为异步、限时且接收 AbortSignal；取消后等待子进程退出才清理临时目录，并在发布前再检查取消。同一进程的同路径安装冲突明确失败，不排队重复升级。默认安装在终端 bootstrap 后后台执行，运行状态与失败回执作为本地消息显示，不写入研究会话；退出取消后台任务。已有目录不触发网络更新。新技能安装完成与当前会话加载分开说明，当前阶段不通过重置研究会话强行激活技能。

`git.ts` 管理实际子进程与输出上限；Windows 通过 taskkill /T 结束该进程树，Unix 结束独立进程组，结束后再完成 Promise。AppRuntime 显式启动安装，普通 headless bootstrap 不下载仓库。`/exit` 与空输入时的 Ctrl+C、Ctrl+D、Esc 统一走宿主 shutdown，等待后台安装和当前本地命令清理。强制终止进程不保证执行这些清理钩子，跨进程锁与崩溃恢复另行验收。

`/skill install` 仍是安装操作，已从 SKILL 调用状态分类中移出；不启动模型执行同名 skill。默认缺失目录逐个安装，一项失败会继续另一项；取消后不启动下一项。成功回执显示实际 commit 与重启提示，失败保留具体原因和 `/skill install owner/repo` 重试入口。已有目录只标记 present，不推定为有效 Git、已发现或依赖 ready。

第二阶段工程验证：**1023 pass / 0 fail，135 文件、10231 断言，65.59 秒**，日志 `%TEMP%/whyj-r07-async-skills-full.log`。typecheck、architecture（0 baseline violations）、build（2668 modules / 5.97 MB）通过。新增 12 项测试：真实 Git 运行/超时/取消、后台安装时帮助可用、shutdown 等待及迟到事件隔离、默认目录离线保留/失败继续/取消、三个退出键路由、重叠安装与取消后禁止发布。原 16 项实际 Git 安装回归改为等待异步结果，保护断言保留。

专项入口：`bun test src/skill/git.test.ts src/skill/installer.test.ts src/skill/store.test.ts src/app-skills.test.ts src/tui/test/exit-cleanup.test.ts`。真实子进程检查在 Windows 执行；Unix 进程组路径尚未实机验证。没有在用户技能目录进行安装，也没有据此宣称真实 GitHub 网络、完整终端视觉或第三方技能的执行依赖已通过。

## R07 第三阶段：固定精选版本

默认仓库由独立 catalog 声明完整 commit、每个技能入口和分模式依赖。新安装直接 fetch 指定 commit，在临时目录 detached checkout；实际 HEAD 必须等于 catalog，全部核心入口必须存在才发布。手动安装同一个默认仓库也遵守固定版本；非默认仓库仍沿用原 fast-forward 流程。

已有默认目录启动时保留且不联网；这不能证明它匹配固定版本。显式更新只允许从现有版本 fast-forward 到固定提交，拒绝回退、分叉和本地修改。不会 reset 用户安装以强行匹配版本。依赖清单记录上游所需能力，不等于已完成运行探测或第三方脚本审计；按模式评估和模型可见性联动继续实施。

第三阶段工程验证：**1028 pass / 0 fail，136 文件、10258 断言，82.98 秒**，日志 `%TEMP%/whyj-r07-pinned-skills-full.log`。typecheck、architecture（0 baseline violations）、build（2669 modules / 5.98 MB）通过。新增测试覆盖上游推进后仍安装指定提交、显式 fast-forward、拒绝回退、缺失核心入口时禁止发布或更新、非法版本与路径提前拒绝，以及同名项目 skill 不误用精选仓库的依赖声明。

专项入口：`bun test src/skill/installer.test.ts src/skill/store.test.ts src/skill/catalog.test.ts`，25 pass / 0 fail。另用生产安装器在独立 TEMP 目录实际获取两个 GitHub 仓库，核对两个完整 commit、十个技能入口的名称与 SHA-256，结果见 [安装验证记录](../output/skill-catalog-verification-2026-09-14.json)。没有修改用户已安装技能，没有执行第三方技能脚本或安装 Python 依赖；这项验证不证明技能运行就绪。

## R07 第四阶段实施契约：会话刷新

安装成功后清除发现缓存并推进进程内版本；失败不推进。默认宿主在加载时重新收集安装目录，技能和 External Skills 配置的版本变化在空闲查看列表或下一次独立 prompt/skill 时生效。刷新不创建会话、不移动 leaf、不清空研究或队列。运行中的模型/工具循环及排队续问保留原资源快照。

独立宿主可提供 `readSkillRevision()` 通知内容变化；未提供时保留显式初始化快照。加载、名称检查或 prompt 准备失败时保留旧资源并向调用者返回错误；之后可以重试。刷新期间切换会话或开始运行时，不将迟到的加载结果提交到新状态。安装就绪与第三方运行依赖仍分开验收。

第四阶段验证：新增 8 项回归，最终 **1036 pass / 0 fail，137 文件、10302 断言，72.77 秒**，日志 `%TEMP%/whyj-r07-skill-refresh-final.log`。typecheck、architecture（0 baseline violations）、build（2669 modules / 5.98 MB）通过，97 个本地文档链接及 whitespace 检查通过。

- 真实 Pi + 本地 HTTP/SSE：原会话调用新技能，工具循环/排队续问保留原快照；移除技能在下一独立请求生效；加载/重名/prompt 失败可重试，分支与日志保持；切换后的迟到加载被丢弃；压缩准备阶段也推迟刷新。
- 默认本地组装：会话依赖先于安装创建，安装失败版本不变，成功后重新发现五个 fixture 入口；同路径内容更新清除缓存后可见。安装传输为隔离 fixture，不据此新增真实 GitHub 或技能脚本的验证结论。
- 终端与宿主：成功安装通知补全刷新，失败/取消不通知；补全接受新扫描、忽略旧扫描、失败保留和移除生效。这里验证了输入建议数据，不代表完整真实终端视觉验收。

专项入口：`bun test src/agent/test/session-dependencies.test.ts src/agent/test/skills.test.ts src/skill/store.test.ts src/app-skills.test.ts src/tui/test/skill-refresh.test.ts`。F23/F24 仍保留依赖运行探测、模型可见性联动与完整终端体验的未完成状态。

## R07 第五阶段实施契约：依赖判定

精选技能按实际来源路径和模式评估，保留 `requirements-met`、`needs-input`、`blocked`、`unverified` 四种状态。输入材料不足与宿主依赖不足分开：前者允许进入技能收集资料，后者不进入模型可用索引，显式调用返回缺项。只允许使用符合条件的模式；日历助手可用不能代表市场研究可用。此约束作用于技能索引和显式入口，不是 shell 安全沙箱。

`/skill info <name> --check` 使用与行情相同的 Python 选择规则，读取解释器及发行包版本，不安装依赖、不导入第三方技能脚本、不访问账户或网络。检查结果只存进程内，取消不发布，较早检查不覆盖较晚结果，状态变化使空闲会话重新准备技能。发行包版本满足只证明已安装元数据；网络、传递依赖、实际脚本执行和用户输入另行核验。

默认宿主根据当前活动工具判断 shell/本地文件读取；没有专用搜索、完整 LLMQuant 研究数据服务或图片输入入口时明确缺少相应能力。未检查的网络及脚本传递依赖保持 unverified。完整注入宿主可提供自己的技能准备策略，不能把本地默认能力强加给独立宿主。

第五阶段验证：新增 8 项回归，最终 **1044 pass / 0 fail，140 文件、10358 断言，72.82 秒**，日志 `%TEMP%/whyj-r07-skill-readiness-final.log`。typecheck、architecture（0 baseline violations）、build（2672 modules / 5.99 MB）及 109 个本地文档链接/whitespace 检查通过。

依赖回归覆盖缺解释器/包、版本不足/精确版本/预发布版本、未知网络、模式与输入差异、来源覆盖、取消/迟到检查及检查后补全刷新。真实 Pi 与本地 HTTP/SSE 验证拒绝时无模型调用或日志写入、原会话启用日历模式、受限资料收集和撤销 shell 后重新阻止调用。[本机验证](../output/skill-readiness-verification-2026-09-14.json) 通过生产 info --check 入口实际读取 Python 元数据，没有安装包或运行第三方技能脚本。使用方式、当前限制和后续验收见 [技能依赖](./skill-readiness.md)。F23/F24 仍为部分完成。
