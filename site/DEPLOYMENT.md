# 官网交付与部署记录

日期：2026-10-13。

## 已交付

- 同仓库的 `site/` 独立静态官网，按 `DESIGN.md` 的黑金色、Geist、左对齐与留白设计。
- 顶部 Feature 功能目录、Blog、文档、语言切换与安装入口；移动端折叠菜单。
- 首页和 Blog 均支持完整的中英文静态页面，Blog 当前显示待发布状态。
- 市场研究、组合比较、研究报告三种交互示意，明确标注合成数据。
- 设置分组切换、涨跌配色切换、Overview 显示开关、减少动态效果和本地偏好保存。
- npm / Bun 安装方式、复制安装与启动命令、FAQ、GitHub / npm / 文档入口。
- 自托管字体与 SIL OFL 许可证、独立构建、Vercel 部署配置及维护说明。

## Vercel 状态

| 项目 | 结果 |
|---|---|
| Vercel Project | `yangjing-s-projects/oh-my-quant` |
| 固定地址 | <https://oh-my-quant.vercel.app> |
| 当前 Production | <https://oh-my-quant-290afai8q-yangjing-s-projects.vercel.app> |
| 首次部署 | <https://oh-my-quant-1psxo238y-yangjing-s-projects.vercel.app> |
| 初版 Preview | <https://oh-my-quant-nrhmr2uty-yangjing-s-projects.vercel.app> |
| 中英文 / Blog / Feature Preview | <https://oh-my-quant-7ju1lhceo-yangjing-s-projects.vercel.app> |
| Taste 优化 Preview | <https://oh-my-quant-2jf02y5f3-yangjing-s-projects.vercel.app> |
| 首次部署 ID | `dpl_E8EauEqejxNkTHyiZMhQhaRcyuSh` |
| 初版 Preview ID | `dpl_73YG2NPS5WDHcoE67HrvrwgDcSXE` |
| 中英文 Preview ID | `dpl_5JdPM8WRqaEjJNaeDosWSFrfxsct` |
| Taste Preview ID | `dpl_Dha4GqhtD6HURtDQL3gsgufjqkMf` |
| 当前 Production ID | `dpl_33g58YmkQU1NnA9xPV8MWXZy9v4R` |
| 部署证据 | Vercel CLI 确认正式域名指向最新 Production，状态 Ready；本地构建生成 4 个语言页面与 4 类 public 资产 |
| 发布内容 | 仅从 `site/` 上传，未上传根目录业务代码、`.ohquant/` 或个人笔记 |

新项目首次执行 `vercel deploy --yes` 时，Vercel 自动将其设为 Production，并绑定固定地址。随后显式执行 `--target preview`，生成相同网页资产的独立 Preview。部署结果由平台状态确认；浏览器验证在本地完成，不据此宣称已做线上端到端检查。

2026-10-13 用户确认正式发布后，使用 `vercel promote dpl_5JdPM8WRqaEjJNaeDosWSFrfxsct --yes --scope yangjing-s-projects` 提升已验证的中英文 Preview。Vercel 生成 Production 部署 `dpl_ECpzN9wjDmhhr6TFnkMtf1sFswNL`。通过 `vercel inspect oh-my-quant.vercel.app` 确认固定域名已指向该部署，状态为 `production / Ready`；当前正式版包含中英文首页、Blog 与 Feature 目录。

同日完成 taste-skill 优化后，提升 Preview `dpl_Dha4GqhtD6HURtDQL3gsgufjqkMf`，平台生成 Production `dpl_33g58YmkQU1NnA9xPV8MWXZy9v4R`。再次通过 `vercel inspect oh-my-quant.vercel.app` 确认正式域名已切换，状态为 `production / Ready`。

当前通过 CLI 在 `site/` 目录部署，因此项目 Root Directory 为 `.`。**尚未连接 Git 自动部署**。若以后导入整个 GitHub 仓库，需把 Root Directory 改为 `site`；不要保持 `.` 后直接构建整个仓库。

## 验证

- `node --check site/public/app.js` 通过。
- `bun run --cwd site build` 通过；构建仅包含允许的公开文件。
- Chromium 浏览器交互验证通过：三类研究场景、方向键和 Home 标签导航、三组设置、行情与风险颜色隔离、Overview 隐藏、刷新保留偏好、恢复默认、减少动效、三种复制操作、FAQ、移动端菜单及 Escape 关闭。
- 1440、1024、768、390、320px 宽度均无页面横向溢出；所有站内锚点存在，系统 `prefers-reduced-motion` 生效。
- 本地页面控制台检查为 0 errors / 0 warnings。
- 人工查看桌面首屏、设置区和移动端截图。截图及本次浏览器检查脚本保存在工作区 `output/playwright/quant-site-*`，不进入发布包。

### 中英文与导航更新

- 构建生成 `/`、`/en/`、`/blog/`、`/en/blog/`；两种语言缺失文案时构建失败，页面元信息和运行时提示共用文案目录。
- Chromium 97 项检查通过，覆盖 Feature 的 Enter / Tab / Escape、点击外部关闭、功能跳转、Blog 空状态、语言切换保留章节与偏好、研究和设置标签、三种复制操作以及禁用 JavaScript 后的静态内容。
- 四个页面分别检查 1440、1024、820、768、760、520、390、320px，无页面横向溢出；英文正文无遗漏的中文文案。
- 补充检查桌面和手机切换时关闭旧菜单、无尾斜杠地址跳转、所有站内链接及章节存在、未知页面返回 404。
- 本地浏览器未出现脚本异常；人工查看英文 Feature 目录、手机菜单、英文首页和中英文 Blog 截图。

这些检查针对官网静态内容和浏览器交互，不代表 CLI、模型提供方或真实行情端点完成重新验收。

### Taste 优化复核

- 按 [设计复核](./DESIGN-REVIEW.md) 调整首屏、功能列表、正文与触控目标；没有新增运行依赖。
- 97 项中英文和交互检查再次通过；四页面的八个宽度均无横向溢出，保留原有功能。
- 补充 26 项检查：四页面的 canonical / Open Graph / hreflang、开关边缘点击、键盘焦点、减少动效及中英文手机控件的 44px 点击区域。
- 响应式菜单状态、路由重定向、所有站内链接和锚点、404 检查通过。
- 本地英文首页 Lighthouse 移动端模拟：Performance 91 / Accessibility 100 / Best Practices 100 / SEO 100。相对 hreflang 地址与可见标签的辅助名称问题已修复；分数仅代表本次本地运行。
- README 24 个链接及引用文件检查通过，使用 GitHub Markdown API 渲染后检查本地深色桌面和浅色手机排版。已刷新示例截图；不等同于实际 GitHub 页面端到端验证。
- 人工查看中英文首屏、功能、设置与移动端截图；检查脚本、截图和 Lighthouse JSON 位于本地 `output/`，不进入发布内容。

## 后续维护

使用短期 `feat/website-*` 分支开发，合并回 `main`；无需建立长期官网分支或独立仓库。安装方法、命令或设置变更时，在同一 PR 更新官网和对应产品文档。部署命令见 [README](./README.md)。
