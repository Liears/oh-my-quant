# Pi 配置导入

F01 的文件互通由用户显式预览和应用：API-key 与模型配置是导入时快照；选定且可映射的 OAuth 账号建立指向 Pi `auth.json` 的本地链接，之后模型请求从该文件读取当前凭证。格式依据固定 [Pi 0.85.1 models.md](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/models.md)、[provider-composer.ts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/provider-composer.ts) 与 [auth-storage.ts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/auth-storage.ts)，合并优先级以该版本实际源码为准，不把未来 main 的字段自动当成本地支持。

入口为 `/config --pi list|preview|apply`。从 Pi agent 目录读取 models.json、auth.json 和 settings.json，选择 provider/model；preview 仅返回模型属性、覆盖范围、凭证来源和内容版本令牌，apply 再核对源文件、环境解析结果与 WhyJ 设置版本后原子保存。取消预览无需回滚；preview/apply 不修改 Pi 文件。OAuth 链接生效后的过期令牌刷新会在 Pi 的文件锁下更新 `auth.json` 中选定的 provider，Pi 登录保持为凭证所有者。

选定连接导入保留模型 ID、协议、地址、能力、显示名、输入类型及价格元数据，并支持请求头、兼容开关、采样参数、推理级别映射和阶梯价格。内置及自定义 provider 都保留原名称，多个连接独立保存；自定义连接写入 `custom: true` 声明。API-key 凭证优先使用选定 provider 的 auth.json，再使用 models.json；环境表达式按导入时快照解析，不能把变量名当 key。只有 Pi 0.85.1 所选 provider 支持 OAuth 且记录完整时才可链接；命令式凭证和未知字段仍明确拒绝，不称为完整 Pi 配置兼容。

运行时由模型配置模块映射和验证，storage 负责 Pi 文件快照、本地设置/链接，以及共享链接生效后的受锁保护 OAuth 读写；CLI 解析和呈现。成功导入后下一次独立请求读取新连接，当前研究历史保留；连接可用性另外通过 Doctor 的真实请求验证。

## 使用

默认读取 `PI_CODING_AGENT_DIR`，未设置时读取用户目录下的 `.pi/agent`。可以用 `--from` 选择其他目录，含空格的路径使用引号。读取缺失文件视为空内容；全部缺失、JSON 损坏或超过单文件 4 MiB 时停止。

`models.json` 支持 BOM、`//` 行注释与尾逗号，对齐 [Pi 0.85.1 的模型文件解析](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/utils/json.ts)。WhyJ 使用固定 `strip-json-comments` 5.0.3，也接受块注释；块注释不是此 Pi 版本的兼容保证。字符串内的 `http://`、引号和注释符号保留。`auth.json`、`settings.json` 仍使用严格 JSON。review 哈希基于原始字节，修改注释也必须重新预览；导入阶段不会格式化或写回源文件，链接后的 OAuth 刷新行为见下文。

```text
/config --pi list
/config --pi preview --provider deepseek --model deepseek-v4-pro
/config --pi apply --provider deepseek --model deepseek-v4-pro --review <预览返回的令牌>
/config --pi preview --provider openai-codex --model gpt-5.4
/config --pi apply --provider openai-codex --model gpt-5.4 --review <OAuth 预览返回的令牌>
```

省略 provider/model 时使用 Pi settings.json 的 defaultProvider/defaultModel；缺少所需默认值时明确指定。两次操作须使用相同的目录和选择。preview 检查可映射性，不测试网络；apply 更新活动模型/可支持的 thinking，替换选定模型的元数据，保留同一 provider 的其他已保存模型。该 provider 共用的端点、默认协议和凭证按本次源文件替换，因此预览提示这些字段影响其所有模型；已有模型自己的协议不被新模型的协议覆盖。其他 provider、数据凭证、观察组合、界面偏好和会话保留。

依次选择不同 provider/model 重复 preview/apply，即可保存多个连接。导入后进入 `/config → Model`，Provider 搜索原名称，Model 搜索已保存的模型 ID；切回某 provider 会恢复它上次选择的模型。多个 provider 可使用相同模型 ID，其端点、密钥与能力互不共用。界面的 Protocol 编辑只作用于当前模型；Base URL 和 API key 属于整个 provider。尚未导入的 Pi 模型不会自动全部添加。

CLI JSON 调用：

```powershell
bun run src/index.ts -- --json -c '/config --pi list'
bun run src/index.ts -- --json -c '/config --pi preview --from "C:\Pi Config\agent" --provider local --model my-model'
```

检查 `ok`、`data.applied` 和预览中的覆盖说明；只有 apply 成功才是导入完成。未导入即退出相当于取消。API key 仍保存在 WhyJ 原有明文 settings 存储中；OAuth 只保存本地指针和 Pi 文件路径，不复制 access/refresh token，也不把原始文件内容放入回执。

## 映射与边界

| Pi 输入 | 当前映射 |
|---|---|
| 内置 provider / 目录模型 | 保留 provider ID，使用锁定 Pi 目录 |
| 自定义 provider | 保留名称并声明 custom=true；独立保存、搜索、选择，与旧 custom 连接并存 |
| models 数组中的选定模型 | 替换该模型的目录元数据；默认 input=text、reasoning=false、context=128000、maxTokens=16384、价格=0 |
| modelOverrides 中的选定模型 | 在目录或 models 自定义定义之后应用；支持部分价格覆盖，samplingParams/thinkingLevelMap 按键合并 |
| api / baseUrl | 自定义定义的模型 api/baseUrl 优先于 provider 默认值；仅导入内置 modelOverrides 时保留目录原协议。未显式改 provider 地址时不将选定目录模型的地址固定给整个 provider |
| name / input / cost | 保存 provider/模型显示名、模态、四个基本费率和完整 tiers；由 Pi 按总输入（含缓存）与阈值计算费用 |
| compat | 合并 provider → model → modelOverrides；路由与 chatTemplateKwargs/chatTemplateArgs 的对象按键合并，数组替换 |
| compat.allowedFallbackModels | Anthropic 服务端 fallback 目标列表；保留 provider/model/完整 cost（含 tiers），数组按模型覆盖优先级整组替换 |
| samplingParams | 模型定义后合并 modelOverrides，再交给 Pi 请求构造器；OpenAI 兼容协议中这些字段可覆盖 Pi 生成的请求体字段，其他协议按 Pi 行为忽略 |
| thinkingLevelMap | 保留字符串/null 和缺项，null 标为不支持；Thinking 选项和实际请求使用 Pi 的约束与映射 |
| headers / authHeader | provider 及模型请求头按导入环境解析并保存在凭证快照；模型头优先，authHeader=true 先用解析后的 key 加 Bearer，模型显式 Authorization 可覆盖；false 不表示禁用协议自己的鉴权 |
| auth.json api_key | key/env 属于选定 provider；未选择的 OAuth 不会迁移 |
| auth.json OAuth | 所选 provider 支持 OAuth 且记录有效时，`oauthId` 指向本地链接文件；模型请求通过该文件定位 Pi 当前账号，Pi 负责刷新与鉴权派生；不复制 token |
| `$NAME`、`${NAME}`、`$$`、`$!` | 按导入时凭证 env/进程 env 解析；普通全大写字符串仍是字面值 |
| !command / 未知字段 / 无效 OAuth | 拒绝选定连接的导入，不静默删除或改成 API-key 连接 |

模型头在原始 Pi 文件中的合并顺序与能力字段不同：modelOverrides.headers → models.headers，之后覆盖 provider 请求头；实际鉴权合并不区分大小写。预览只显示请求头数量、采样参数数量、兼容字段名及阶梯数量，不输出头值。头部环境变量变化同样使 review token 失效。

单模型 baseUrl 导入后在编辑器显示 Model URL，清空该项恢复 provider 默认地址。共用 Base URL 仍可独立编辑。元数据校验和合并在 [model-metadata.ts](../src/agent/src/model-metadata.ts)，传输和计费由 Pi 实现。

`allowedFallbackModels` 使用安装的 pi-ai 0.85.1 类型契约。每项必须提供非空 provider/model 和完整非负费率，tiers 延续现有价格校验；空列表让 Pi 省略 `fallbacks`。Anthropic 请求只发送目标 model ID，不发送本地价格。服务返回的模型与同 provider 的目标匹配时，Pi 使用该目标价格及阶梯，并在回复中保留实际模型 ID；这不是 WhyJ 发起的跨供应商重试，也不证明供应商一定接受这些 fallback 目标。实现证据见 [Pi Anthropic 传输](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/anthropic-messages.ts)。

模型元数据、API key、请求头和设置不是双向同步：Pi 后续改动需重新预览/导入。链接的 OAuth 凭证例外，模型请求从 Pi `auth.json` 读取当前账号并在需要时刷新。通用自定义端点支持 Completions、Responses、Anthropic Messages、Gemini；内置 API-key provider 还保留其目录声明的原生协议。新增四种原生路径如下，鉴权和请求均经 Pi 自身 provider，不改成通用 custom 连接。

| Pi provider ID | 原生协议 | 导入后保留的配置 |
|---|---|---|
| `azure-openai-responses` | `azure-openai-responses` | API key、AZURE_OPENAI_BASE_URL / AZURE_OPENAI_RESOURCE_NAME / AZURE_OPENAI_API_VERSION 等环境设置 |
| `amazon-bedrock` | `bedrock-converse-stream` | Bearer token 或 AWS_PROFILE / IAM 等凭证链；无 key 的 profile/IAM 不生成 local token |
| `google-vertex` | `google-vertex` | API key 或 GOOGLE_APPLICATION_CREDENTIALS / project / location；服务账户文件仅保留路径，不导入文件内容 |
| `mistral` | `mistral-conversations` | Mistral API key、原生模型与地址 |

协议选择器显示当前 provider 的原生协议及通用兼容协议。需要原生传输时使用原 provider ID；自定义名称配 Bedrock/Vertex 等专用协议会拒绝，避免缺失其凭证解析流程。无需固定 URL 的内置连接可留空，面板显示 Provider environment/default。预览展示模型配置地址，最终原生请求地址由 Pi 结合环境配置计算，例如 Azure 的 AZURE_OPENAI_BASE_URL 优先于模型 baseUrl。

OAuth-only provider 可导入有效的选定 OAuth 记录，不能用 type=api_key 伪装成可用连接。兼容字段使用固定白名单，不能推定已支持 Pi 全部字段或未来版本。WhyJ 的独立 OAuth 登录仍可使用，见 [OAuth 文档](./model-oauth.md)。共享链接与 Pi [AuthStorage](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/auth-storage.ts) 使用同一 `auth.json` 文件锁；后续刷新只写选定 provider，保留其他记录及文件权限。`Sign out` 删除 WhyJ 的本地链接，不退出 Pi 或撤销供应商账号；链接缺失或损坏时不自动回退到 API key。用户不执行 apply 就不会建立链接。选定 OAuth 的真实账号权限与令牌轮换尚未验证；真实 API-key 的 Pi/WhyJ 并行检查见下文，也不执行 Pi shell credential。

## 验证

```powershell
bun test src/runtime/pi-config-import.test.ts src/cli/registry.test.ts
bun test src/agent/test/named-model-providers.test.ts src/tui/test/model-settings-panel.test.ts
bun test src/agent/test/pi-model-metadata.test.ts
bun test src/agent/test/pi-native-protocols.test.ts
bun test src/agent/test/pi-model-fallback.test.ts
bun test src/runtime/pi-oauth-link.test.ts src/runtime/model-oauth.test.ts src/tui/test/model-oauth-panel.test.ts
bun run typecheck
bun run check:architecture
bun run test
bun run build
```

专项测试覆盖：预览无导入写入/无密钥输出，源文件与本地设置冲突，环境凭证变化，目录环境变量，原生 provider 覆盖，自定义完整模型，Pi 字面量/插值，不能映射的 OAuth/命令/未知字段/损坏文件拒绝，取消和实际 CLI 子进程。共享链接另验证 OAuth-only provider、同文件锁等待与取消、六请求及四独立 worker 的单次刷新、其他账号保留、退出只删指针、设置锁冲突清理、真实 CLI 和重复导入。真实 Pi 循环连接 localhost，导入前后分别收到旧/新模型及鉴权，Session ID 和原分支记录保留。测试不读取用户真实 Pi auth 文件，也不调用真实模型供应商。

2026-09-14 最终工程验证：新增 16 项专项测试；全量 **1129 pass / 0 fail**，150 文件、10823 次断言、76.80 秒。typecheck、architecture（0 baseline violations）、build 与 diff 空白检查通过；构建 2698 模块、约 6.1 MB。七份相关文档共 171 个本地链接有效。日志位于本机 `%TEMP%/whyj-pi-import-final.log`，不作为分发文件。F01 仍为部分完成，未将本阶段计成完整 OAuth/模型目录互通。

2026-09-14 多连接补充：新增 13 项回归，覆盖多个命名 provider、相同模型 ID 的凭证隔离、模型协议覆盖、重复导入、手动模型保留、目录不变、非法名称及 TUI 保存/重新打开。真实 Pi localhost 链路连续六次请求在旧 custom、fixture、lab 间切换，同时验证第二个模型和切回旧模型；逐次核对路径、模型、Authorization 和会话历史。另使用 Pi 请求构造器检查 Completions、Responses、Anthropic 三种协议的 payload，在发送前中止。

本次全量 **1142 pass / 0 fail**，151 文件、82.36 秒；typecheck、architecture（0 baseline violations）、build 和 diff 空白检查通过。全量日志为本机 `%TEMP%/whyj-named-providers-full.log`。这些验证使用合成凭证和隔离存储，不证明真实供应商账户可用，也未迁移用户的 Pi 凭证。

2026-09-14 元数据补充：新增 23 项回归。测试覆盖定义/override 优先级、嵌套路由合并、采样/推理映射、大小写请求头及鉴权顺序、头部环境变化使预览失效、独立模型地址与 TUI 清除覆盖、负费率/不完整 tiers/非法字段拒绝。Pi Completions 发送真实 localhost 请求，Responses/Anthropic 使用实际 SDK payload 并在网络发送前中止；Pi calculateCost 验证等于阈值与含缓存输入跨阈值时的费用。

本次全量 **1165 pass / 0 fail**，152 文件、81.40 秒；typecheck、architecture（0 baseline violations）、build 和 diff 空白检查通过。构建 2699 模块、约 6.1 MB；全量日志为本机 `%TEMP%/whyj-pi-metadata-full.log`。F01 仍为部分完成，未执行 OAuth 登录或真实模型供应商验证。

2026-09-14 原生协议补充：新增 15 项回归。全 API-key 目录的 1,346 个模型逐项导入后仍保留 provider/ID/api/baseUrl；四种额外原生协议通过实际 Pi 请求构造和 localhost 请求检查，分别核对 AWS SigV4、Azure api-key、Vertex x-goog-api-key、Mistral Bearer 及原生 URL 路径。服务故意返回 400，验证错误收束，不将其当成成功模型回复。AWS profile 和临时 Vertex 服务账户路径的准备保留无 key 状态；四个 TUI 用例验证原生协议可选并保存。

本次全量 **1180 pass / 0 fail**，153 文件、16368 次断言、79.63 秒；typecheck、architecture（0 baseline violations）、build 和 diff 空白检查通过。构建 2699 模块、约 6.1 MB；日志为本机 `%TEMP%/whyj-pi-native-full.log`。全部使用合成凭证或临时文件，未访问真实云账户，未导入用户凭证。下一项为 OAuth 生命周期和剩余兼容边界，F01 状态仍为部分完成。

2026-09-14 解析与 fallback 补充：新增 7 项模型文件回归，覆盖注释、尾逗号、BOM、字符串保留、仅注释修改使 review 失效、auth/settings 严格 JSON 及损坏文件保留；另有 13 项 fallback 回归，覆盖列表优先级、空列表省略、请求只含 model ID、实际 localhost Anthropic 流的返回模型与阶梯计费，以及无效目标/价格的拒绝。人工费率样例为 100 input + 10 cacheRead + 20 output，跨 100 输入阈值后费用为 0.00086；仅是合成价格，不是供应商报价。测试不读取个人配置或连接外部模型服务。

本次全量 **1232 pass / 0 fail**，156 文件、16573 次断言、78.57 秒；typecheck、architecture（0 baseline violations）、build 和 diff 检查通过。构建 2717 模块、约 6.19 MB；日志为本机 `%TEMP%/whyj-pi-compat-full.log`。OAuth 凭证文件互通的共享/迁移/独立登录选择尚待用户决定，其他 F01 兼容工作继续进行，不将这批回归计作完整账号互通。

2026-09-15 选定 OAuth 互通补充：Pi 0.85.1 的账号所有权维持在 auth.json，本地只存链接，不复制 token。初始六项合成目录测试覆盖 OAuth-only 导入、六请求单次刷新、同路径 Pi 文件锁竞争和取消、其他账号保留、设置冲突清理、CLI 无 token 输出、重复导入指针复用；既有本地 OAuth 登录、不可映射连接拒绝和原生协议回归继续执行。全量 **1583 pass / 0 fail**，188 文件、21135 次断言、151.96 秒；typecheck、architecture（0 baseline violations）和 build（2980 模块、约 6.77 MB）通过。随后修正 Pi list 的旧“not imported”显示及对应断言，受影响的 41 项专项回归通过；再新增四独立 OAuth worker 对同一链接的合成跨进程刷新回归，`pi-oauth-link.test.ts` **7 pass / 0 fail**。全量数字对应这两项补充之前的版本。使用 Bun 1.3.14 / Windows、临时 Pi 文件和合成账号；没有读取或写入用户的 Pi auth.json，也未验证真实订阅/供应商请求或 Pi/WhyJ 两个真实终端并行刷新。F01 仍为部分完成。

补充后的全量复跑 **1584 pass / 0 fail**，188 文件、21143 次断言、150.45 秒；随后 Sign out 文案统一为“只移除本地访问、不撤销账号”，两份面板专项 35 pass / 0 fail，typecheck、architecture（0 baseline violations）和 build 再次通过。最终文案变化没有额外全量复跑，行为由面板专项覆盖；真实账号和真实 Pi/WhyJ 终端联用未验收。

## 真实 Pi/WhyJ 并行 API-key 检查（2026-09-16）

本机 Pi 目录有 DeepSeek `type=api_key` 连接和 `deepseek-v4-flash` 默认模型。可复跑的[隔离检查脚本](../scripts/check-pi-dual-cli.ts)先对该连接执行生产导入预览/应用，验证 WhyJ 的独立临时配置确实选中了 provider/model/key，再同时启动全局 Pi `--print --no-session --no-extensions --no-skills --no-tools` 与构建版 WhyJ `--json doctor --phase model`。Pi 使用原 Pi 目录，WhyJ 仅使用已导入的临时配置；两条请求均复用同一真实 API-key。最终构建上的复测：Pi 返回指定的 `ok`，exit 0、2.991 秒；WhyJ 仅请求 model phase，status `pass`、exit 0、0.955 秒。初次构建的同条件检查也通过；这是两个独立 CLI 进程的同时请求，不是 OAuth 令牌刷新，也不是完整研究任务。

[最终状态制品](../output/pi-dual-cli-live-2026-09-16-final.json)保存检查时间、构建代码哈希、版本、退出码、耗时和状态；没有原始密钥、模型回复或 Doctor 诊断正文。该机全局 Pi 为 0.73.0，WhyJ 内置 Pi agent core/AI 为 0.85.1；不同版本下这次 DeepSeek 连接都可用，不能推出其它模型、协议或后续版本均兼容。临时 WhyJ 目录检查位于系统临时目录下，检查完成删除，未覆盖持久 WhyJ 设置或 Pi auth.json。

```powershell
bun run build
bun run scripts/check-pi-dual-cli.ts --output output/pi-dual-cli-live-NEW.json
```

本轮最终完整回归 **1706 pass / 0 fail，200 文件、22285 次 expect、247.28 秒**；typecheck、architecture（0 baseline violations）、test fence、build（3012 模块 / 6.92 MB）通过。两次真实模型检查只覆盖当下单个 API-key/模型的并行请求；OAuth 账号、轮换、收费服务权限、反复可用性分布和原生终端视觉仍待验收，F01 保持部分完成。
