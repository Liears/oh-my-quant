# WhyJ 扩展宿主

更新：2026-09-24，R08/F17 实施契约及 skill capability 发布。协议为 WhyJ Extension API 1，使用 Pi AgentTool/Skill 数据类型；不实现 Pi Coding Agent ExtensionAPI，也不承诺安装 npm Pi 包即可运行。

扩展由显式静态 import 后交给宿主加载，不扫描或动态执行任意目录。manifest 声明 ID、发行版本、精确 API 版本，以及工具、skills、命令和 capability 名称；实现与声明必须完全一致。`capabilities` 是 API 1 的可选增量字段，旧定义省略时按空集合处理。命令通过扩展宿主 API 调用，现有十个公开 slash 命令保持单一 catalog。

宿主提供工作目录、扩展生命周期 AbortSignal 与诊断出口。业务不获得 TUI 或私有 storage 实例；Node 扩展属于受信任同进程代码，此接口不是恶意代码沙箱。未来 npm 分发、UI 管理或其他协议的适配不能由本接口推定已完成。

加载与重载先检查版本与名称冲突，再初始化和校验候选资源，最后发布。失败不替换已启用资源；候选初始化/校验失败清理其资源。禁用操作进入串行执行阶段后撤销旧调用入口，取消在途工作并等待协作退出后清理；重载在新资源发布后退休旧实例。清理失败记录诊断，不使其他扩展消失。初始化默认限时 10 秒，迟到返回的资源会清理；工具和清理函数须响应 signal 并结束，忽略取消或阻塞事件循环的代码不能在同进程被强制隔离。

Session 在独立请求的空闲边界读取同一份工具、技能和 capability 快照；运行中的循环保持注册快照，已经禁用的旧资源调用会明确失败。新增/替换不清空研究历史或重建会话。恢复中显式保存的活动工具选择继续取交集，不自动恢复被排除的工具。

首个内置扩展封装现有工具注册表，不复制计算或数据实现；独立 fixture 提供自有工具、技能与命令。验收涵盖版本不兼容、声明不符、跨扩展名称冲突、初始化/清理失败、取消、重复禁用、失败重载保留、命令调用和真实 Pi 会话的动态资源变更。

## 当前可用范围

R08 第二阶段已接通默认 AppRuntime 的扩展生命周期：启动加载静态 catalog 和持久化的禁用选择，再组装会话；退出取消初始化与工具并等待清理。`/config --extensions list|enable|disable|reload [id]` 复用现有入口，list 返回版本、声明、运行状态与诊断；更改需要空闲会话。启停在宿主变更成功后以 settings revision 保存，保存失败尝试恢复原启停状态并报告错误；重载不写设置。单次 CLI 使用临时宿主并在返回前清理，不创建模型会话。未知插件、非法参数和失败不得显示成功；持久化未知 ID 保留并标为不可用，避免升级丢掉用户选择。其他已运行进程需重启读取新选择。

默认 `whyj` 通过宿主加载 `whyj.core`，其工具来自原有注册表。管理结果显示在 Composer 的命令回执中，技能补全从活动会话读取并在启停后刷新，未新增 Settings 子面板或一级命令。分发方式为随构建静态注册的 WhyJ 扩展，不提供 npm 发现/安装，也不执行任意目录的脚本。新增模块在 [应用注册表](../src/runtime/extensions.ts) 顶层 import 后加入 definitions；独立源码宿主仍可直接使用下面的 API。

| 模块 | 职责 |
|---|---|
| [公共契约](../src/extensions/types.ts) | manifest、资源、生命周期上下文与快照 |
| [校验](../src/extensions/manifest.ts) | API 1、发行版本、唯一名称和声明/实现一致性 |
| [宿主](../src/extensions/host.ts) | 加载、替换、禁用、取消、诊断与清理 |
| [内置扩展](../src/runtime/builtin-extension.ts) | `whyj.core` 复用内置工具，提供只读 `quant-capabilities` 命令 |
| [会话适配](../src/runtime/extension-session.ts) | 同一次快照携带 tools/skills/capabilities/revision，预留 `research_task` 和基础宿主能力名 |
| [应用管理](../src/runtime/extensions.ts) / [命令适配](../src/cli/handlers/extensions.ts) | 静态 catalog、保存启停选择、失败回执与单次 CLI 清理 |
| [独立示例](../src/extensions/test/fixtures/statistics-extension.ts) | 均值工具、分析 skill、echo 命令和 observation capability，无 TUI/存储依赖 |

## 开发接入

用户可在交互终端输入：

```text
/config --extensions list
/config --extensions disable whyj.core
/config --extensions enable whyj.core
/config --extensions reload whyj.core
```

`whyj.core` 禁用后，数据、量化和 shell 工具从后续模型请求移除，宿主的 `research_task` 仍保留；本地 `/config`、`/help` 等管理操作仍可使用。list 是只读查询，可在模型运行时使用；更改在模型准备/执行或其他命令期间明确拒绝，请等待后重试。重载重新初始化当前构建中的模块，不会从磁盘热导入新代码；升级源码后需重新构建/启动。

单次 JSON 调用：`bun run src/index.ts -- --json -c "/config --extensions list"`。成功返回 `data.extensions`（manifest、enabled、configuredEnabled、diagnostics）及 `data.unavailable`；查看成功不代表所有扩展初始化成功，应检查每个条目。操作失败返回非零退出码和错误说明，不回退到默认启用。

以下代码放在仓库根目录的 TypeScript 入口中。实际插件可按独立示例定义 `ExtensionDefinition`，由顶层静态 import 引入。

```ts
import { ExtensionHost } from "./src/extensions/index.ts";
import { builtinQuantExtension } from "./src/runtime/builtin-extension.ts";
import { extensionSessionDependencies } from "./src/runtime/extension-session.ts";
import { createDefaultSessionDependencies } from "./src/agent/src/session-dependencies.ts";
import { createQuantResearchAgent } from "./src/runtime/quant-harness.ts";

const cwd = process.cwd();
const host = new ExtensionHost({ cwd });
await host.load(builtinQuantExtension);
const dependencies = await extensionSessionDependencies(
  createDefaultSessionDependencies({ cwd }), host,
);
const agent = createQuantResearchAgent({ dependencies });
try {
  await agent.waitForIdle();
  console.log(host.list());
  console.log(await host.executeCommand("quant-capabilities"));
  // await agent.prompt("你的研究问题"); // 使用已配置的模型与数据能力
} finally {
  agent.abort();
  await host.dispose();
  await agent.waitForIdle();
}
```

适配器把宿主视为完整工具集合；希望保留内置能力就显式加载 `whyj.core`。`createQuantResearchAgent` 为后续新装工具继续绑定研究任务范围与取消守卫，自定义工具成功不自动成为已核验的研究证据。

插件只有在确实提供并核验某项宿主能力时才发布 capability。下面的资源声明表示同一插件同时提供搜索工具和 `web-search` readiness 事实；`status` 也可为 `missing`、`unverified` 或 `input-required`，重载后会在空闲边界重新计算精选 skill。完整工具 schema 与取消实现可参照 statistics fixture。

```ts
import type { ExtensionDefinition } from "./src/extensions/index.ts";

export const searchExtension: ExtensionDefinition = {
  manifest: {
    id: "example.search",
    version: "1.0.0",
    apiVersion: 1,
    tools: ["example_web_search"],
    skills: [],
    commands: [],
    capabilities: ["web-search"],
  },
  activate: () => ({
    tools: [searchTool],
    skills: [],
    commands: [],
    capabilities: [{
      requirement: "web-search",
      status: "available",
      reason: "example_web_search returns timestamped source records.",
      requiresTools: ["example_web_search"],
    }],
  }),
};
```

能力名在扩展之间及基础宿主能力源之间必须唯一；冲突在初始化前拒绝。宿主复制 capability 回执，调用方后续修改对象不会改变活动快照。能力依赖插件工具时必须用 `requiresTools` 绑定 manifest 中由本插件声明的工具；恢复会话的活动工具选择或研究任务范围移除其中任一工具后，状态会收缩为 missing。绑定未知工具、重复绑定或非数组值在候选发布前拒绝。`shell-execution` 与 `local-resource-read` 即使被插件声明为 available，也不会覆盖会话策略：两者只由当前活动 `bash` 工具决定。Capability 只参与调用资格，不把一次工具成功升级为研究证据。

`load(definition)` 添加新 ID；`reload(definition)` 替换已有 ID；`disable(id)` 撤销资源；`enable(id)` 重新执行已保存的初始化工厂。`snapshot()` 返回启用资源，`list()` 包含已禁用条目，`getDiagnostics(id)` 可查询初始化失败和清理错误。初始化失败的 ID 不加入 list。`reserve({ tools, skills, commands, capabilities })` 原子预留宿主名称，已占用时失败；会话适配器自动预留 `research_task` 和基础宿主当前发布的能力名，因此需要 `await`。`dispose()` 取消整个宿主并清理资源。

会话在空闲 `getSkills()` 或下一次独立 prompt/skill 时读取版本，先准备工具、合并技能与 prompt，再提交。基础技能与扩展技能重名时保留旧会话资源，修复后可重试。只刷新技能不写研究日志；工具集合变化通过已有 active-tools entry 保存选择。自动选择模式接纳新增工具，恢复的显式选择仅与当前工具取交集；显式空集合保持为空。

默认 AppRuntime 在启动及启用/重载前预留已发现的本地技能名和基础宿主能力名，名称在此宿主生命周期中保持预留；冲突在扩展初始化前拒绝。后续外部技能编辑若产生冲突，刷新失败会明确提示，用户可禁用扩展或修正技能后重试。当前活动工具清单随 system prompt 更新，旧工作流说明仅在对应工具启用时适用；禁用能力不能通过 shell 自动绕过。只接管 Agent 工具、扩展技能和 readiness 能力事实，Overview、Doctor 与本地配置服务具有各自生命周期。

## 测试方式

```powershell
bun test src/extensions/test/host.test.ts src/runtime/extension-session.test.ts
bun test src/runtime/extensions.test.ts src/app-extensions.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

宿主 7 项测试覆盖内置/独立扩展、四类名称冲突、版本与声明拒绝、capability 工具绑定、失败重载、取消、清理、超时和实现快照。会话 4 项测试通过真实 Pi 循环与本地 HTTP/SSE，检查均值工具升级前后为 4/14、禁用后从请求中移除、会话 ID/历史保留、空选择、技能冲突无日志副作用、任务守卫，以及 capability 在 load/disable/enable/reload 后的 readiness 变化。插件伪造 shell 的回执仍为 missing；基础能力名冲突在激活前拒绝，绑定工具退出活动集合后也撤销资格。当前专项 **11/11、78 次断言**。所有数据来自隔离 fixture，不访问真实模型、行情或个人资产。

2026-09-24 capability 接入验证：六个关联文件合跑时，源码 CLI 子进程用例受并行负载影响超过 30 秒，其他 45 项通过；该文件隔离复跑 7/7，子进程用例 6.85 秒。随后串行 `bun run test` 为 **1874/1874、224 个文件、23757 次断言、304.19 秒**。增加 `requiresTools` 的任务级撤销反例后，专项为 11/11、78 次断言，最终串行全量为 **1874/1874、224 个文件、23761 次断言、300.38 秒**；typecheck、architecture（0 baseline violations）、test fence 和生产构建（3052 modules / 7.1 MB）通过。未放宽测试时限，也不把首次并行超时改写为通过。

R08 第一阶段历史验证（2026-09-14）：扩展专项 10/10（62 assertions）；typecheck、architecture（0 baseline violations）、build（2672 modules，5.99 MB）、diff 检查通过，5 份关联文档的 149 个本地路径有效。当时默认构建尚未引用扩展宿主，构建成功不作为 CLI 插件接入证据。

第一阶段全量在加入名称预留前为 1054/1054；复测为 1053 pass / 1 fail（142 files，181.55 秒），唯一失败是既有 `model-benchmark.test.ts` 脚本入口测试超过其 15 秒限时。该文件随后独立复跑 6/6，入口测试耗时 11.94 秒；未修改原超时阈值或省略断言。扩展专项也已在取消测试 fixture 的预设保留名后重新通过，验证适配器自行预留名称。保留这次超时记录，不把独立通过改写为全量通过。

R08 第二阶段新增 [应用管理测试](../src/runtime/extensions.test.ts) 7 项和 [默认 AppRuntime 测试](../src/app-extensions.test.ts) 5 项。验证真实单次 CLI 的 JSON/退出码，禁用后重启不初始化，未知 ID 保留，失败重试，不兼容 API 仅拒绝该模块，设置 revision 冲突双向回滚，非法文件保留，以及实际 Pi 请求的工具增减/原会话保留、忙时只读查看、启动取消、本地技能冲突在激活前拒绝、实际 Composer 补全随扩展技能启停更新。构建现包含 2680 modules（6.0 MB），类型和架构检查通过；这次单次 CLI 测试实际执行源码入口，默认应用测试使用生产组装和本地 SSE。

第二阶段首轮全量为 1062 pass / 2 fail（1064 tests，116.70 秒）：一个 CLI Doctor 子进程超时，以及异步启动导致配置修复后紧接的输入未发送。后者已修复为等待正在进行的启动后提交；原有模型恢复测试、CLI Doctor、新扩展管理联合复跑 35/35（221 assertions）。前者在同次复跑通过，保留超时事实；未调整任何既有测试时限。

修复后、补全接入前的全量已通过 1065/1065（144 files，10503 assertions，78.74 秒）；补全接入后，应用与 TUI 专项 6/6，通过真实建议列表检查，而不只检查刷新回调次数。

第二阶段最终验证（2026-09-14）：`bun run typecheck`、`bun run check:architecture`（0 baseline violations）、`bun run build` 通过；`bun run test` 为 **1066 pass / 0 fail，144 files，10507 assertions，72.24 秒**。7 份关联文档的 170 个本地路径与工作区 diff 检查通过。未执行真实模型、行情或账户请求；测试超时历史与修复过程保留在上文。额外打包 CLI 复验命令被自动审批以 `blocked by policy` 拦截，整条命令未执行；因此这里只声明源码 CLI 子进程验证与构建成功，不声明独立运行打包 CLI 已通过。

## F17 验收证据

| 要求 | 当前证据 |
|---|---|
| 内置与独立扩展的 manifest、版本及四类资源声明 | whyj.core 与 statistics fixture，host.test 校验工具/技能/命令/capability 集合及执行结果 |
| 加载、禁用、重载和可发现管理入口 | ExtensionHost API、默认 AppRuntime、`/config --extensions`；源码 CLI 子进程与实际 Pi 请求测试 |
| 版本/名称冲突失败可见 | host.test 的 API/version/四类重名拒绝；管理返回 error，AppRuntime 在启用前预留本地技能名和基础能力名 |
| 能力随生命周期进入 skill readiness | 单一宿主快照携带 capability 与 revision；真实 Session 验证 load/disable/enable/reload，shell/本地读取继续绑定活动工具 |
| 单个失败不破坏其他扩展或研究会话 | 初始化失败继续加载其他模块，失败重载保留原资源，持久化冲突恢复原启停，会话 ID/原文保留与重试测试 |
| 明确协议及业务依赖边界 | WhyJ API 1，静态模块分发；architecture 禁止 extensions 导入 runtime/TUI/storage/领域实现，业务实现由宿主显式封装 |
| 取消和退出清理 | host.test 的在途工具/超时/迟到资源清理，AppRuntime 启动取消及 shutdown 等待 |

以上是当前工作区的本地功能验收，不代表已发布 npm 版本或支持 Pi 原生 ExtensionAPI 包；同进程合作式取消及外部技能编辑的恢复边界见上文。
