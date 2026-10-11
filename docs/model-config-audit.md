# 模型接入与配置统一验收

核验日期：2026-09-14。对象为本仓库当前工作区，运行环境为 Windows、Bun 1.3.14；Pi AI / Agent Core 精确锁定 `0.85.1`。本记录针对“参考 Pi provider 包统一 CLI 模型接入、配置与交互”，不代表整个量化终端路线图或真实供应商账户已验收。

## 用户流程

启动 `bun run src/index.ts`，输入 `/config`，选择 `Model`。搜索 Provider 和实际模型 ID，填写 API key 或通过 `Provider setup` 完成 Pi 提供的凭证引导，选择 Thinking，最后 `Save` 或 `Save & Verify`。Doctor 的 `Configure → Model connection` 使用同一编辑器。

保存前为草稿，Esc 可以取消；保存后新提交的请求使用新连接，当前运行和排队续问保留原连接。会话历史与 ID 不变。字段、JSON 示例、凭证优先级和旧设置迁移见 [配置参考](./configuration.md)。

## 需求与证据

| 需求 | 当前实现 | 验证证据 |
|---|---|---|
| 参考 Pi provider 包，统一模型来源 | 目录、默认端点、协议、能力和 Thinking 来自 Pi；界面提供 38 个 API-key/环境凭证 Provider、1,346 个模型 | [连接测试](../src/agent/test/model-connection.test.ts) 遍历全部展示模型，验证实际 ID 和输出窗口边界；四种主要协议使用真实 SDK 构造请求 |
| 一套配置用于编辑、诊断和请求 | `provider`、实际 `model`、`providers[id]` 保存在同一 settings 文件；UI façade、Doctor、Agent 调用同一解析模块 | [模型解析](../src/agent/src/model-config.ts)、[UI façade](../src/runtime/model-settings.ts)、[实际请求测试](../src/agent/test/model-request.test.ts)；保存后 Agent 与 Doctor 请求的模型、端点和鉴权一致 |
| 易用的 Provider/Model 选择 | 可搜索列表、能力说明、手动模型 ID；切换 Provider 时恢复上次模型 | [面板测试](../src/tui/test/model-settings-panel.test.ts)、连接测试；检查空搜索、取消、精确 ID、Unicode 编辑、Thinking 约束 |
| 凭证引导与隔离 | 直接调用 Pi 的 API-key login；支持多步骤 secret/text/select；Key 与 provider 环境配置独立保存 | Cloudflare key/account/gateway 完整引导与中途取消测试；保存 key 优先级、进程环境 fallback、跨 provider 不复用旧全局 key |
| 高级连接可配置 | 默认值可直接使用；可覆盖 URL、四种自定义协议、每个模型的上下文/输出限制及 reasoning 能力 | URL 不推断协议；拒绝含凭证 URL、非法容量；模型覆盖不会污染其他模型或 Pi 目录 |
| Settings 与 Doctor 共用交互 | 两个入口实例化同一 ModelSettingsPanel；模型保存只写模型字段 | [父面板测试](../src/tui/test/panel.test.ts) 覆盖 Settings、Doctor、Save & Verify 和数据配置草稿隔离 |
| 保存生效且保留研究会话 | prompt、skill、压缩和分支摘要在新操作开始时同步设置；运行期间连接快照保持一致；恢复会话采用当前保存设置 | 实际 HTTP 测试覆盖模型/端点/key 切换、运行中排队、并发 prompt 被拒绝、重启恢复、压缩及分支摘要 |
| 原生 provider 的特殊鉴权可传递 | API key、nullable headers、provider env 和鉴权解析出的 baseUrl 传入内核 | Cloudflare 本地 HTTP 验证专用鉴权头、默认 Authorization 抑制、URL 占位符替换；覆盖普通请求、压缩、分支摘要、Doctor；Bedrock 环境凭证解析测试 |
| 配置错误可修复 | 非法草稿保留编辑状态；缺少凭证、错误模型与协议提示同一配置入口；启动配置修复后可恢复 Agent | [错误提示测试](../src/runtime/errors.test.ts)、面板测试、AppRuntime 本地请求恢复测试；显式 Agent options 不受无效磁盘默认连接阻断 |
| 验证命令不把空响应当成功 | Doctor / smoke 检查最终错误状态和非空文本；模型单阶段诊断不额外请求数据服务 | 真实 Pi SSE 解析器连接 localhost，覆盖成功、空响应、401、超时；两种 CLI 入口的 JSON 状态一致；Doctor/smoke 错误输出遮蔽 API key 和 header-only 凭证 |
| 终端交互与原有主题一致 | 使用现有 Buffer、Panel frame 和主题颜色；列表随选择滚动，编辑框随光标滚动 | 60×20、80×24、120×32 渲染测试；实际检查 80×24 主面板与 Provider 搜索输出；键位覆盖测试 |

## 已执行验证

```powershell
bun run typecheck
bun run check:architecture
bun run test
bun run build
git diff --check
```

- 类型检查通过。
- 架构检查通过，0 个基线违规。
- Test fence 通过；全量测试 **691 pass / 0 fail，80 个文件，5,610 次断言**。网络集成使用 `127.0.0.1` 临时服务，手工制品生成测试不在默认测试集合中。
- 构建通过：2,606 个模块，生成 `dist/index.js`，约 5.90 MB。
- 构建产物在临时 `OHQUANT_DIR` 和临时 cwd 中验证：`--json -c "/config"` 返回保存的实际模型与端点；`--json -c "/doctor --phase model"`、`--json doctor --phase model` 均覆盖文本成功和 HTTP 401。共收到 4 次 localhost 请求，模型、路径、鉴权与保存配置一致；成功为 `pass/pending/pending`，401 为 `fail/pending/pending`，输出无 fixture key。
- 差异空白检查通过；文档内本地链接存在。

全量测试日志：`%TEMP%/whyj-model-final-785b8958d4974342a3de45cc77446a99.log`。该路径是本次本机证据，不随仓库分发。

## 判定方式与边界

Doctor 沿用已有 JSON/退出码约定：报告生成成功可以返回退出码 0、`ok: true`、`ready: true`，即使模型 phase 为 fail。判断连通性必须检查 `data.phases` 中 model 的 `status`，并确认没有跳过网络的警告。`requestedPhases` 标识本次范围。需要以连接成功与否作为进程退出码时，使用 `bun run test:providers`。

本次没有用真实账户发供应商请求，没有测量各模型的线上成功率、TTFT 或 TPOT；38 个 provider 出现在目录中不等于每个真实服务均可用。真实账户应在终端执行 `Save & Verify`。

当前实现复用 Pi 的 API-key/环境凭证 provider 和引导接口；OAuth/订阅账号登录、自动导入 Pi 的 `auth.json/models.json` 尚未接入。Pi ExtensionAPI 插件宿主、金融数据源引导、全终端皮肤重设计和扩展化等 [GOALS.md](./GOALS.md) 中其他条目属于另外的工作，未以本记录宣称完成。
