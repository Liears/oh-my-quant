# Session 依赖注入

更新：2026-09-24。`createAgent({ dependencies })` 接收完整宿主依赖，默认本地组装集中在 [session-dependencies.ts](../src/agent/src/session-dependencies.ts)。量化工具、模型连接、skills、技能能力和会话存储可以独立替换；没有新增 slash 命令或 Pi ExtensionAPI 宿主。

## 端口与所有者

[QuantAgentDependencies](../src/agent/src/session-contracts.ts) 是当前 TypeScript 契约：

| 端口 | 输入/输出与责任 |
|---|---|
| `env` | `ExecutionEnv`，提供宿主工作目录与执行环境 |
| `sessions` | `create/open/list`，返回现有 `Session<JsonlSessionMetadata>`；不要求使用 JSONL 文件实现 |
| `tools` | 完整工具集合，包含 schema 和 execute；空集合就是没有工具，不回退到内置注册表 |
| `readTools()`（可选） | 原子返回 revision、完整 tools，以及可选扩展 skills/capabilities；空闲边界按版本刷新，见 [扩展宿主](./extensions.md) |
| `readConnection()` | 一份 model、thinking、压缩阈值、延迟 `getAuth` 的连接快照；可选 `restore(context)` 定义旧会话模型恢复策略 |
| `loadSkills()` | 加载已解析的 `QuantSkill[]`；会话消费内容快照，不自行扫描外部目录 |
| `readSkillRevision()`（可选） | 发布新技能后改变返回的字符串；空闲列表或新 prompt/skill 发现版本变化时调用 loadSkills，未提供时保留初始化快照 |
| `readSkillCapabilities()`（可选） | 返回按 requirement 命名的可信宿主事实；会话先复制，再交给技能准备策略 |
| `prepareSkills(skills, tools, capabilities)`（可选） | 根据原始技能、当前活动工具与同一轮能力快照生成资源；默认宿主附加精选技能依赖状态，独立宿主自行决定策略 |
| `prepareRequestResources({research, skills, rawSkills})`（可选） | 已提交分支与空闲资源快照 → 临时工具名子集和技能；不刷新宿主目录、不写 active-tools entry。Quant 工厂在此应用任务范围 |
| `beforeToolCall(call)`（可选） | Pi 校验工具参数后、执行工具前收到名称/ID/参数；可返回 `block/reason/terminate`。Quant 工厂先执行宿主回调，再检查已提交任务范围；宿主已阻断时保留其结果 |
| `prompts` | system 收到当前活动 tools 与 skills；turn 收到用户输入和最近对象提示；skill 提供调用附加文本 |
| `verifyResearch()` | 分支 entries → 归档核验后的 `ResearchReport`；默认使用共享 research 核验器，可替换其数据读取来源 |
| `verifyReport(ref, provenance)`（可选） | 核对固定报告版本可读、完整且与任务记录的来源元数据一致；默认宿主检查不可变快照及其指纹，未提供时要求报告的任务保持未核验 |

提供 `dependencies` 时，`settings/sessionsRoot/skillPaths` 的本地默认组装不执行，cwd 默认取 `dependencies.env.cwd`。需要沿用本地某些能力时，显式创建默认依赖再覆盖，而不是依赖隐式补全。宿主回调是受信任代码，须自行约束 IO；收到取消信号的端口还须响应取消。这些端口不构成安全沙箱。

默认组装仍使用本地 settings、内置工具、skill 发现和 JSONL repo，路径由 storage 管理。架构 gate 禁止 `session.ts` 直接导入 storage、tools、source 或 tui；默认 IO 的绑定留在组装模块。

`skillPaths` 可传数组（构造时复制）或返回路径数组的函数（加载时调用）；交互宿主使用函数收集新安装目录。默认技能版本包含进程内安装通知、Python 检查、目录集合与 External Skills 配置；不会监视任意外部文件编辑，也不把关闭发现缓存解释为会话自动刷新。

`createDefaultSessionDependencies` 的 `skillCapabilities` 是受信任宿主的能力端口：`read()` 返回按 requirement 命名的当前事实，`revision()` 在能力变化时发布新版本。它可提供 `web-search`、`model-image-input`、`private-output-authorization`、`llmquant-research-data` 或宿主已核验的网络/运行时依赖；缺省仍按 missing/unverified 关闭。返回对象里的 `requirement` 会按映射 key 规范化，防止标签错配。`shell-execution` 和 `local-resource-read` 不接受该端口覆盖，始终由本轮实际 `bash` 工具决定；任务装配撤销 bash 后也会撤销资格。该端口声明宿主事实，不替代精选文件指纹、任务输入或工具执行结果。

## 接入一个专用分析工具

以下函数保留默认本地模型、存储与 skill 加载，只用传入的量化工具启动会话。系统说明跟随活动工具集合，避免宣称未提供的内置能力。

```ts
import { createAgent } from "./src/agent/src/session.ts";
import { createDefaultSessionDependencies } from "./src/agent/src/session-dependencies.ts";
import type { AgentTool } from "./src/agent/src/session-runtime/index.ts";

export function createAnalysisSession(tool: AgentTool) {
  const local = createDefaultSessionDependencies({ cwd: process.cwd() });
  return createAgent({
    dependencies: {
      ...local,
      tools: [tool],
      prompts: {
        system: ({ tools, skills }) => [
          "根据显式数据进行研究，说明证据和缺项。",
          `当前工具：${tools.map(item => item.name).join(", ") || "无"}`,
          `Skills：${skills.map(item => item.name).join(", ") || "无"}`,
        ].join("\n"),
        turn: input => input,
        skill: (_name, instructions) => instructions ?? "",
      },
    },
  });
}
```

独立宿主应直接提供完整端口，示例见 [注入测试](../src/agent/test/session-dependencies.test.ts) 和 [独立内存 repo](../src/agent/test/fixtures/memory-session-repo.ts)。新增工具可直接进入 Pi 调用循环，无需修改 TUI。新增计算若要成为核验发现，还须扩展对应 research 验证规则；自定义工具返回成功并不自动变成 verified。

## 快照、切换与失败

工具描述和 schema 在构造时复制，skills 在加载后复制，`getSkills()` 返回副本；重复工具/skill 名称失败可见。恢复的 active tools 与宿主集合取交集，未知旧工具被排除，空交集保持空。每次模型请求的 system prompt 使用同一个活动工具集合。

启用技能版本端口后，空闲 `getSkills()` 或新 prompt/skill 会准备完整技能和 prompt，再更新资源，不写入研究日志或移动分支。加载、名称或 prompt 准备失败可重试，旧资源保留；迟到刷新不会覆盖已切换的会话。运行中的循环、压缩、导航和排队续问不触发刷新，判断依据为 Harness 操作阶段，覆盖模型输出开始前后的准备与落盘。

R08 增加动态工具端口：同一 readTools 快照的扩展技能、capabilities 与本地技能合并校验，准备成功后更新工具和 prompt。工具变更会写入已有 active-tools entry，区别于纯技能刷新；自动选择模式接纳新增工具，恢复的显式选择继续取交集。`extensionSessionDependencies` 合并基础能力源与扩展事实、拒绝重名，并把宿主 revision 合入技能 revision；因此仅 capability 改变也会在空闲边界重算 readiness。Capability 的 `requiresTools` 由准备策略同时对空闲会话活动工具和任务级工具子集检查，不能在工具被排除后继续保留资格。默认 AppRuntime 已使用此端口和 `/config --extensions` 管理；源码接入用 `await extensionSessionDependencies(base, host)`，由适配器预留宿主工具名和基础能力名。独立 `createRuntimeAgent(dependencies)` 工厂仍可接收显式依赖，未传入时沿用默认静态组装；扩展生命周期由应用管理器拥有。

新 prompt/skill/手动压缩读取连接；一个运行中的模型/工具循环及排队续问保持原连接。宿主的 `getAuth` 必须闭包捕获同一配置，不能在执行时读取已切换的全局 key。默认实现捕获设置与环境变量；遗留模型恢复也固定端点、窗口和凭证，下一次独立请求才采用新连接。

恢复先验证报告 entries/hash/父链，再准备目标分支 context、skills、prompt、证据和模型。准备全部成功后才移动报告来源 leaf 并替换活动状态；准备失败保留当前分支。Session repo 自身须保证 move/append 的提交语义，文件端口的故障恢复见 [Pi 会话适配](./pi-agent-loop-harness.md)。

## 独立验证

```powershell
bun test src/agent/test/session-dependencies.test.ts
bun test src/artifact/test/report-pipeline.test.ts
bun test src/agent/test/research-recovery.test.ts src/artifact/test/report-recovery.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

最初 9 项会话测试覆盖真实 Pi + 本地 HTTP/SSE 的自定义均值工具/skill、独立内存存储、连接切换、压缩/导航/恢复、取消、名称冲突、空工具集合和报告准备失败。测试特意写入无效本地设置，完整注入的宿主仍能运行且不产生默认存储文件；默认连接测试另用隔离设置验证环境快照。后续覆盖技能刷新、依赖状态、任务装配和迟到刷新；2026-09-24 再增加默认能力端口及 revision 投影，当前该文件 **18 项**通过。与 readiness 合跑为 **23/23、201 次断言**；扩展会话另以第 4 项测试覆盖 capability 生命周期及工具绑定撤销。最终全量 **1874/1874、224 个文件、23761 次断言、300.38 秒**，typecheck、architecture、test fence 与 3052-module 生产构建通过。默认安装、缓存、补全和依赖的联合验证见 [安装实施记录](./skill-installation.md)。

4 项报告阶段测试分别检查：分支加载后源文件消失仍有快照；注入乱序观察的规范化/白名单和缺失处理；仅凭 DatasetRef/数据/参数核对独立人工动量值；仅凭序列化 DTO 渲染。渲染函数不承担数据核验，调用方必须先经过核验 pipeline。现有七类研究报告的完整工具/归档/分享回归继续保留。

这些证据验收 F19 的本地可替换边界，不证明可选 npm 安装、外部扩展兼容、真实模型研究质量或完整 UI 任务完成；后续范围见 [PRD](./PRD.md)。
