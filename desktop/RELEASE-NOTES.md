Windows 桌面版正式提供一键安装包。下载 **WhyJ-Quant-Setup-1.3.0-win-x64.exe**，双击安装后从桌面或开始菜单启动。

- Electron 内直接使用原 CLI 界面，命令、设置、组合、历史会话与报告保持一致。
- 内置 Bun、Python 3.13.12、AKShare 1.18.63、AKQuant 和 Git，无需另装开发环境。
- 首次使用默认选择免 Token 的 AKShare；按 **Ctrl+P** 配置自己的 AI 模型连接。
- 支持中文输入、复制、多行安全粘贴、字号调整和窗口状态保存。
- 数据保存在 `%APPDATA%/WhyJ Quant/workspace/.ohquant`，升级保留设置、会话和报告。

支持 Windows 10 1809+ / Windows 11 x64。模型和行情服务需要网络及相应账号权限。此版本未作 Authenticode 签名，Windows 可能提示未知发布者；启用严格应用控制的设备可能阻止运行，本机已观察到这种限制。

安装包经干净 Windows 环境实际安装，并验证了无开发运行时 PATH 启动、CLI 面板、设置持久化、中文多行粘贴、窗口缩放、随包 Python/Git、重启与退出。此验收不代表所有外部模型和行情供应商均可用。可用同页 `SHA256SUMS.txt` 核对下载完整性。
