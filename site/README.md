# WhyJ Quant 产品官网

官网与 CLI 在同一仓库维护，`site/` 是独立的静态部署单元。视觉真源是根目录 [DESIGN.md](../DESIGN.md)，产品文案以 [README](../README.md)、[配置参考](../docs/configuration.md) 和 [Quant UI/UX](../docs/quant-uiux.md) 为依据。

## 为什么这样维护

- **同仓库、独立目录**：产品功能、安装步骤与官网内容可以在一次 PR 中更新；不复制另一套产品规范。
- **功能分支开发，合并回 main**：使用 `feat/website-*` 做短期开发与 Vercel Preview。不要用长期 `website` 分支保存第二份产品，否则设计和功能说明容易漂移。
- **独立 Vercel 项目**：Root Directory 设为 `site`。官网部署不运行 CLI，也不上传 `.ohquant/`、个人 notes、账户数据或整仓库产物。
- 当官网有独立团队、独立权限或不同发布周期时，再考虑拆仓库。当前不需要。

## 本地开发

```sh
bun run --cwd site dev
bun run --cwd site build
bun run --cwd site preview
```

开发和构建预览均使用 `http://127.0.0.1:4173`，不要同时启动。没有第三方运行依赖，无需安装。构建为 Node.js 原生脚本，方便 Vercel 直接执行。

## 文件职责

| 文件 | 修改时机 |
|---|---|
| `public/index.html` | 文案、导航、功能介绍、演示内容与外链 |
| `public/styles.css` | 布局、响应式与设计 token；修改色彩前先更新或核对 `../DESIGN.md` |
| `public/app.js` | 标签切换、演示偏好、导航与复制命令 |
| `public/fonts/` | 自托管 Geist / Geist Mono 及 SIL OFL 许可；页面不请求第三方字体 |
| `scripts/build.mjs` | 只将审阅过的 public 资产复制到干净的 `dist/` |
| `scripts/serve.mjs` | 仅本机开发/预览服务器，不作为生产服务 |
| `vercel.json` | 构建路径、安全响应头与字体缓存 |

字体来自 Google Fonts 的 Geist v5 / Geist Mono v6，使用固定资源版本。品牌文字采用 DESIGN 规定的 Geist，不使用旧图片 Logo 的衬线字体。

## 内容与交互约定

页面是产品官网，不是在线量化服务。三种研究场景均标明交互示意与合成数据；设置只改变网页示例，localStorage 只保存涨跌色、Overview 显示与动效偏好。不收集 API key、不读取本机配置、不连接证券账户。

红绿仅用于涨跌和风险，`Market Colors` 翻转涨跌色，风险保持独立语义；平盘保持中性。默认黑金配色与颜色值对应 DESIGN。网页支持系统减少动态效果偏好。

发布前检查：桌面与手机无横向溢出；导航与全部标签可用；键盘方向键切换标签；复制结果明确；偏好刷新保留；配色不改变风险语义；安装命令与外链仍和产品一致。研究示例不是产品性能或真实模型运行证明。

## Vercel

在 `site/` 内执行：

```sh
vercel link --project oh-my-quant --yes
vercel deploy --yes --target preview
```

配置已写入 `vercel.json`：Framework Preset 为 Other，Build Command 为 `node scripts/build.mjs`，Output Directory 为 `dist`，无依赖安装。明确传入 `--target preview`；Vercel 新项目的第一次部署可能自动成为 Production，不能仅靠省略 `--prod` 判断目标。

若通过 Vercel Git Integration 导入仓库，Root Directory 必须填写 `site`；PR 生成 Preview，合并 main 后可触发 Production。当前是否已连接 Git、是否已正式发布，以 [部署记录](./DEPLOYMENT.md) 为准。

后续迭代先部署 Preview；正式发布时显式使用 `--prod`。项目使用独立的 Vercel 项目，不改动现有其他项目或绑定自定义域名。
