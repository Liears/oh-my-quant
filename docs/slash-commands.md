# WhyJ Quant Slash Command 参考

Slash Command 只处理确定性的本地操作：设置、诊断、session、portfolio、skill 和报告浏览。量化研究不是 Slash Command；直接输入自然语言，由 agent 选择行情与 Quant tools。

## 一级命令目录

`src/runtime/command-catalog.ts` 是一级名称和英文描述的单一真源。Composer 建议、TUI Help、`/help` 与 `whyj --help` 必须展示同一组描述。

| 命令 | 统一描述 | 执行结果 |
|---|---|---|
| `/compact` | Compact current session context | 压缩当前 session 上下文；可附带本次压缩的关注点。 |
| `/resume` | Browse and restore saved sessions | TUI 中浏览并恢复 JSONL session；非 TUI 中列出或按 ID 恢复。 |
| `/portfolio` | Browse and select local portfolios | 浏览本地 portfolio，并把选中项设为当前 portfolio。 |
| `/config` | Review and edit runtime settings | TUI 中打开 Settings；非 TUI 中输出规范化设置摘要。 |
| `/doctor` | Configure and diagnose runtime | 未配置时进入配置流程；已配置时诊断模型、工具链和数据源。 |
| `/skill` | Discover, inspect, and run skills | 发现、查看、安装或通过当前 agent session 运行 skill。 |
| `/help` | Browse commands and shortcuts | TUI 中打开 Help；非 TUI 中输出命令目录和快捷键。 |
| `/clear` | Clear conversation and reset agent | 清空对话显示并重置当前 agent/session runtime。 |
| `/artifact` | Browse, restore, and open reports | 浏览有效报告；选中后恢复来源 session，并在浏览器打开报告。 |
| `/exit` | Exit WhyJ Quant | 退出 WhyJ Quant。 |

一级目录只有 `name` 和 `desc`，不承载二级菜单、示例或说明段落。参数只在命令已经明确后由 parser/handler 处理；composer 不为 `/artifact` 展开任何二级选项。

## 命令行为

### `/compact [focus]`

等待当前 agent idle 后压缩 session tree，并输出保留范围、token 和量化上下文摘要。`focus` 是可选的自然语言压缩指示。上下文已经足够小时返回说明，不改写 session。

### `/resume [sessionId]`

- TUI：`/resume` 打开有效 JSONL sessions 列表，`Enter` 恢复选中项。
- 非 TUI：无参数时列出 sessions；传入 `sessionId` 时直接恢复。
- `/session` 仅作为旧输入兼容别名，不出现在公开目录、建议或文档命令表中。

### `/portfolio`

TUI 中浏览本地 portfolio，`Enter` 选择并更新当前 portfolio。非 TUI 中列出可用项；兼容脚本仍可使用 `/portfolio use <name|file|index>`，但它不是一级 composer 选项。

### `/config`

TUI 中打开 Settings，统一编辑 Agent Runtime、Research Data 与 Workspace Experience。非 TUI 中只输出脱敏摘要和配置路径。字段、默认值与迁移规则见 [配置参考](./configuration.md)。

### `/doctor [--phase model,tools,data]`

首次运行且缺少凭证时提供配置入口；其余情况执行真实 readiness 检查。可用 `--phase` 限定诊断范围。输出可以包含认证来源和脱敏指纹，但不得包含完整 secret。

### `/skill`

`/skill` 用于发现 skills。实现还支持 `/skill info <name>`、`/skill run <name>`、`/skill install <owner/repo>` 和 `/skill:<name>`；后者是 composer 中唯一的上下文型 skill 展开流程。详细规则见 [Skills 文档](./trader-skills.md)。

### `/help`

展示与一级 catalog 一致的命令描述和键盘快捷键。它不复制每个命令的完整参数手册；完整语义以本文为准。

### `/clear`

清空当前对话界面，并重置 agent/session runtime。它不删除磁盘中的历史 sessions 或 artifacts。

### `/artifact`

`/artifact` 不接受参数或子命令。TUI 会先清理无法恢复来源 session 的失效报告，再显示可用报告；`Enter` 恢复来源 session 并在浏览器打开报告。非 TUI 只列出可恢复报告。

报告生成不属于 `/artifact`。只能在 `/config` 中开启 `Auto Artifacts`；开启后，量化研究 turn 完成并写入完整 trajectory 时自动生成 Dashboard + Trajectory，并打开浏览器预览。

### `/exit`

结束当前进程。它不删除设置、sessions、缓存或 artifacts。

## 自然语言与量化工具

不带 `/` 的输入进入 agent loop。因子、回测、风险和策略评分由 agent 调用 `Quant.Factor`、`Quant.Backtest`、`Quant.Risk` 与 `Quant.Benchmark`；不为这些工具新增平行的一级 Slash Command。

```text
分析 688981.SH 的 momentum 因子
回测 20/60 双均线并检查最大回撤
比较组合风险，并生成研究报告
```

## 维护约束

- 改一级名称或描述时，先修改 `src/runtime/command-catalog.ts`。
- README 和本文必须逐字包含 catalog 的英文描述；测试会校验一致性。
- `slashCommands` JSON 字段继续提供名称数组；`slashCommandDetails` 提供 `name` + `desc`，避免破坏既有调用方。
- 详细参数属于 handler 与本文，不得重新扩张一级 catalog schema。
