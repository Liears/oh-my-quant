# 模型 OAuth 生命周期

2026-09-14：已接通存储、Pi 刷新适配、runtime 登录/退出及共享模型设置面板。2026-09-15 补充选定账号的 Pi OAuth 文件共享链接；真实账号授权尚未验收，F01 保持部分完成。

## 终端使用

1. 进入 `/config → Model`，或 Doctor 的 `Configure → Model connection`。
2. 选择 provider、模型和 Thinking。目录显示支持 OAuth 的 provider，包括 OAuth-only 的 `openai-codex`。
3. 选择 `Sign in & Save`。Pi 可能先询问登录方式；例如 Codex 提供 Browser login 和 Device code login。
4. 授权提示区显示链接、设备码或进度。按 `Ctrl+O` 用默认浏览器打开当前链接，长链接用 `PgUp/PgDn` 滚动查看。若浏览器无法打开，可复制显示的地址。浏览器回调可自动完成；需要手动输入的授权码/回调 URL 会遮蔽显示。
5. 成功后立即保存此连接，父 Settings 同步最新版本，新提交的请求生效。登录过程中 Esc 取消并返回可编辑面板；再次 Esc 退出。关闭或替换父面板也会取消，旧登录的晚到结果不能覆盖新操作。

普通字段仍是草稿，使用 Save 或 Save & Verify 提交。`Sign in & Save` 已保存的结果不会因随后 Esc 被撤销。`Sign out` 立即删除当前本地登录文件或 Pi 链接，保持 OAuth 选中；不会删除 Pi `auth.json` 的账号。支持 API-key 的 provider 显示 `Use API key`，选择后仍需 Save，Esc 可丢弃切换草稿。

显示“OAuth saved”或“Pi OAuth linked”仅说明本地存在凭证或链接，不证明订阅权限、模型资格或连通性；真实请求用 `Save & Verify` 单独检查。不同 provider 的授权选项与账号规则由 Pi/供应商决定。

## 模块职责

| 模块 | 职责 |
|---|---|
| `src/types/model-auth.ts` | OAuth payload、凭证校验和不透明登录 ID 的共享契约 |
| `src/storage/src/model-auth.ts` | 独立登录文件或 Pi 链接文件的创建、校验及删除 |
| `src/storage/src/pi-oauth.ts` | 通过 Pi auth.json 同路径文件锁读写选定 provider；保留其他账号及文件权限 |
| `src/agent/src/model-oauth.ts` | 本地凭证或 Pi 链接适配到 Pi CredentialStore；Pi 负责登录协议、过期判断、刷新和请求鉴权派生 |
| `src/runtime/model-oauth.ts` | 登录成功后的配置版本检查、保存、冲突清理及显式退出 |
| `src/runtime/pi-config-import.ts` | 预览后核对文件和设置版本，建立 Pi 链接；保存失败清理未发布的指针 |
| `src/runtime/model-settings.ts` | 只读显示本地 OAuth / Pi 链接状态；打开编辑器不触发刷新 |
| `src/tui/src/model-settings-panel.ts` / `model-auth-notice.ts` | 复用按键编辑器和选择器，显示临时授权信息、取消及显式登录/退出动作 |
| `src/tui/src/panel.ts` | Settings/Doctor 共用入口；接收已保存配置，避免后续开关用旧版本覆盖登录 |

独立登录的凭证写入 `OHQUANT_DIR/model-auth/{UUID}.json`，默认位于 `.ohquant/model-auth/`；显式 `/config --pi apply` 导入 OAuth 时，同目录只存版本 2 的指针（Pi `auth.json` 路径/provider），不存 access/refresh token。`settings.json` 只新增 `providers[id].oauthId` 引用，OAuth token 不写入设置。API-key 的现有保存方式不变。独立登录凭证是本地明文，原子写入使用 mode 0600；链接包含用户文件路径，也不应发布、归档为研究报告或按缓存清理。它们不构成系统密钥库或 Windows ACL 隔离。

每次独立登录生成不同 UUID。切换账号后，旧连接只持有旧引用，不会读到新账号 token。重新登录目前保留之前的登录文件；退出服务只删除传入连接引用的文件，尚无历史登录管理或自动清理入口。重复导入同一 Pi provider/文件复用已保存的链接；Pi 自己替换该账号记录时，新请求读取当前内容。

## 调用与失败语义

`signInModelConnection(settings, interaction)` 接收草稿和 Pi 的 `ProviderAuthInteraction`。调用方负责提供 prompt、notify 和 AbortSignal。该服务完成登录后检查工作区和 settings revision，再保存新的登录引用；保存冲突或提交前取消会清理此次生成的文件，保留已保存的连接。UI 的 onSaved 只同步已提交结果，不执行第二次保存；后续普通编辑仍从该版本生成草稿。

OAuth 模块注册 Pi 官方 `registerBunOAuthFlows()` 静态加载器。否则 Pi 的变量相对路径导入会在单文件 bundle 中寻找未分发的 OAuth 文件。代码不复制供应商登录协议；构建测试在独立临时目录运行真实 Codex 登录方式提示并取消，验证静态加载路径。

`resolveConfiguredAuth` 检测到 OAuth 引用时使用 `resolveModelOAuth`。Pi 0.85.1 的实际 `auth/resolve.js` 在 token 剩余有效期不足五分钟时刷新；锁内再次检查，其他请求已刷新则复用新 token。刷新请求由 Pi 限时 15 秒。独立登录的本地存储使用异步租约，在网络请求期间每五秒更新锁，租约失效时间 90 秒、竞争等待最多 60 秒；未拿到锁时可取消。Pi 链接使用 Pi `auth.json` 的同路径 proper-lockfile 租约（30 秒失效、五秒心跳），读取及轮换选定 provider 时持锁；两种锁都与只允许同步操作的 settings 锁分开维护。

已验证的行为：

- 八个同进程请求或四个独立 CLI 进程共用过期凭证，只执行一次刷新，随后读取同一新 token。
- 独立刷新进程持锁后被强制终止，原凭证字节不变、锁仍留存；人为将废弃锁时间调到过期阈值之前，四个后续请求能接管且只刷新一次。这验证真实进程崩溃及锁接管路径，不是实际等待 90 秒的计时验收。
- 修改锁时间后，真实五秒心跳检测到租约失效，晚到的更新被拒绝，原凭证字节不变，也不会释放可能已属于其他进程的锁。
- 刷新失败保留原文件字节；界面错误不带 provider 原始异常中的 token。
- 刷新已返回新 token、请求随后取消时，仍保存已确认的轮换结果，避免丢失新 refresh token；调用方收到取消结果。
- 退出与刷新使用同一文件锁。退出完成后，等待中的刷新不能重新创建凭证。
- 退出保留 settings 中的 OAuth 引用；缺失凭证时要求重新登录，不自动使用仍保存的 API key 或环境密钥。
- provider 与 UUID 不匹配、非法引用、损坏 JSON 均拒绝读取并保留原文件。空引用也不能被解释成切回 API-key。
- OAuth 的 account headers、空值 header 和账号专属 baseUrl 由 Pi `toAuth` 返回并保留。

`signOutModelConnection` 删除本地独立凭证或链接，不删除 Pi 登录、不撤销供应商端授权，也不能收回已进入请求的 access token。远端已轮换但响应丢失或进程在落盘前崩溃时，旧 token 可能失效，需要重新登录；当前测试不证明这一窗口可自动恢复。崩溃测试使用未在远端轮换的合成凭证；租约丢失测试验证检测后的提交拒绝，不证明文件系统租约能消除所有跨进程竞态。

## 测试方式

在仓库根目录运行：

```powershell
bun test src/runtime/model-oauth.test.ts src/tui/test/model-oauth-panel.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

专项测试共 15 项，使用真实 Pi Models/鉴权解析、模拟 OAuth provider 和独立 TEMP 目录；四进程用例通过真实文件锁共享凭证，崩溃用例强制终止自己启动的子进程并等待退出后检查文件，租约失效用例等待实际心跳。测试不读取个人 Pi auth.json，不进行真实登录或模型计费请求。fixture 的成功 token 有效期为 30 分钟，明确超过 Pi 五分钟刷新窗口。

面板另有 18 项测试：OAuth-only provider、真实 Pi 登录方式提示、独立 bundle、三种尺寸的长链接/授权码遮蔽、设备码、浏览器回调取消手动输入、旧登录晚到隔离、设置冲突清理、父面板保存/关闭、退出及 API-key 切换、非法浏览器目标。默认/重映射 Ctrl 键从真实终端字节解析后进入面板；输入解析另验证 Return/Tab/Backspace 保持原语义。真实 Pi 提示测试在用户选择授权方式前取消，浏览器打开成功路径使用注入函数，不声称已验证本机默认浏览器或真实账号。

2026-09-14 Windows / Bun 1.3.14 验证：全量 1193 pass、0 fail，154 个文件、16419 次断言，83.77 秒；typecheck、架构检查（0 baseline violations）和 build 通过。源码 `--help` 入口通过；未执行真实 OAuth 账号验证。

同日补齐面板、静态加载器和控制键输入后：全量 1212 pass、0 fail，155 个文件、16525 次断言，87.11 秒；typecheck、架构检查（0 baseline violations）、build 和 diff 检查通过。构建为 2716 个模块、6.19 MB，构建后的 CLI `--help` 通过。F01 仍未完成全部兼容及真实账号验收。

2026-09-15 补齐崩溃与租约丢失测试后：专项 15 pass、0 fail；全量 1424 pass、0 fail，173 个文件、18463 次断言，112.18 秒。typecheck、架构检查（0 baseline violations）、build 和 diff 检查通过；Bun 1.3.14 / Windows，构建 2962 个模块、6.71 MB。本轮仅新增测试与文档，未修改凭证实现。

后续继续验证真实终端键盘/默认浏览器、真实账号请求和供应商权限边界。选定 OAuth 文件链接另有合成目录和真实 CLI 测试，不以这些测试推定实际订阅账号可用。

2026-09-15 后续全量回归发现崩溃后的并发接管偶发失败。隔离的 proper-lockfile 竞争诊断共 30 轮、每轮四个申请，观察到 9 次 `EPERM/rmdir` 和 1 次 `EPERM/mkdir`；过期锁正在被其他申请者移除时，Windows 可暂时拒绝删除。原实现只重试 mkdir，现对同一个凭证锁路径的 mkdir/rmdir 竞争使用已有的 40 ms 重试、60 秒等待上限及取消信号；其他系统调用/路径不扩大重试。受保护的刷新操作未被重复执行。修复后 `bun test src/runtime/model-oauth.test.ts --test-name-pattern 'refresh process crashes' --rerun-each 20` 为 20 pass、0 fail，220 次断言，14.29 秒；失败全量日志保留在 `%TEMP%/whyj-skill-network-full.log`，复跑日志为 `%TEMP%/whyj-oauth-rmdir-repeat.log`。不据此扩大为所有文件系统或跨进程失锁情形均已消除。

该修复后的最终全量为 1431 pass、0 fail，174 文件、18537 次断言、110.41 秒；typecheck、architecture 和 build 通过，日志 `%TEMP%/whyj-skill-network-final.log`。同轮新增的精选技能网络检查独立记录在 [技能依赖](./skill-readiness.md)。

2026-09-15 研究评测的全量回归发现退出 UI 测试偶发 `Missing field: Use API key`。ModelOAuthFile.delete 在 unlink 后还需异步释放锁，原测试仅等待文件消失及一次 tick，可能在面板仍处于 setup 时发送按键。测试改为通过已有 signOut 端口等待真实退出 Promise，并用可控完成门槛验证文件已删、操作尚未结束时仍阻止切换；完成后验证 OAuth 引用保留、API-key 切换可取消和显式保存。未改生产 UI/凭证逻辑或增加超时，原失败保留，工程结果见 [统一评测验证](./research-task-evaluation.md#2026-09-15最终回答与基金收益口径)。

2026-09-15 Pi OAuth 链接：`/config --pi preview/apply` 对选定有效 OAuth 账号建立版本 2 本地指针，Pi auth.json 保持凭证所有权；模拟的六并发请求和四个独立 OAuth worker 均只刷新一次，直接 Pi 同路径锁的竞争/取消、源文件其他账号保留、退出仅删除链接、设置锁冲突清理和真实 CLI 无 token 输出均通过。全量回归 1583/1583（四 worker 用例添加前）；其后的列表文案修复由 Pi 导入专项回归覆盖。没有验证个人订阅账号、真实 Pi/WhyJ 并行终端或远端失联后的令牌轮换恢复，故 F01 仍部分完成。

四 worker 用例添加后的全量回归 **1584/1584**，188 文件、21143 次断言；最后的 Sign out 中性文案由两份面板专项 35/35 覆盖，typecheck、architecture 和 build 通过。以上均用合成账号，不证明真实登录或供应商权限。
