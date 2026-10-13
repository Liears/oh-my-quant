# 官网交付与部署记录

日期：2026-10-13。

## 已交付

- 同仓库的 `site/` 独立静态官网，按 `DESIGN.md` 的黑金色、Geist、左对齐与留白设计。
- 顶部功能、工作流、设置、文档导航与安装入口；移动端折叠菜单。
- 市场研究、组合比较、研究报告三种交互示意，明确标注合成数据。
- 设置分组切换、涨跌配色切换、Overview 显示开关、减少动态效果和本地偏好保存。
- npm / Bun 安装方式、复制安装与启动命令、FAQ、GitHub / npm / 文档入口。
- 自托管字体与 SIL OFL 许可证、独立构建、Vercel 部署配置及维护说明。

## Vercel 状态

| 项目 | 结果 |
|---|---|
| Vercel Project | `yangjing-s-projects/oh-my-quant` |
| 固定地址 | <https://oh-my-quant.vercel.app> |
| 首次部署 | <https://oh-my-quant-1psxo238y-yangjing-s-projects.vercel.app> |
| Preview | <https://oh-my-quant-nrhmr2uty-yangjing-s-projects.vercel.app> |
| 首次部署 ID | `dpl_E8EauEqejxNkTHyiZMhQhaRcyuSh` |
| Preview ID | `dpl_73YG2NPS5WDHcoE67HrvrwgDcSXE` |
| 部署证据 | 两次 Vercel CLI 返回 `readyState: READY`；首次构建日志确认复制 5 类 public 资产、下载 15 个源码文件并部署完成 |
| 发布内容 | 仅从 `site/` 上传，未上传根目录业务代码、`.ohquant/` 或个人笔记 |

新项目首次执行 `vercel deploy --yes` 时，Vercel 自动将其设为 Production，并绑定固定地址。随后显式执行 `--target preview`，生成相同网页资产的独立 Preview。部署结果由平台状态确认；浏览器验证在本地完成，不据此宣称已做线上端到端检查。

当前通过 CLI 在 `site/` 目录部署，因此项目 Root Directory 为 `.`。**尚未连接 Git 自动部署**。若以后导入整个 GitHub 仓库，需把 Root Directory 改为 `site`；不要保持 `.` 后直接构建整个仓库。

## 验证

- `node --check site/public/app.js` 通过。
- `bun run --cwd site build` 通过；构建仅包含允许的公开文件。
- Chromium 浏览器交互验证通过：三类研究场景、方向键和 Home 标签导航、三组设置、行情与风险颜色隔离、Overview 隐藏、刷新保留偏好、恢复默认、减少动效、三种复制操作、FAQ、移动端菜单及 Escape 关闭。
- 1440、1024、768、390、320px 宽度均无页面横向溢出；所有站内锚点存在，系统 `prefers-reduced-motion` 生效。
- 本地页面控制台检查为 0 errors / 0 warnings。
- 人工查看桌面首屏、设置区和移动端截图。截图及本次浏览器检查脚本保存在工作区 `output/playwright/quant-site-*`，不进入发布包。

这些检查针对官网静态内容和浏览器交互，不代表 CLI、模型提供方或真实行情端点完成重新验收。

## 后续维护

使用短期 `feat/website-*` 分支开发，合并回 `main`；无需建立长期官网分支或独立仓库。安装方法、命令或设置变更时，在同一 PR 更新官网和对应产品文档。部署命令见 [README](./README.md)。
