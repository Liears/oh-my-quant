# 组合报告浏览器验收

日期：2026-09-15。环境：Windows、Chrome 152.0.7977.84、Playwright CLI；使用 localhost 上的合成报告，无实际账户、模型或行情请求。对应 F04/F05/F06/F14，不能替代完整终端研究流程验收。

## 发现并修复

1. **宽屏净值图裁剪**：图表复用了表格容器，继承 380px 最大高度；原页面实际内容 461px，日期轴落入内部滚动区。共享 [research-theme.ts](../src/artifact/src/research-theme.ts) 仅解除 comparison-chart 的高度上限，窄屏仍横向滚动，表格保留原高度限制。最终 1440px 页面图表 clientHeight/scrollHeight 均为 466px。
2. **320px 页头与长文本溢出**：页头弹性空位仍消耗间距，主题按钮被压缩并越界；叙述中的长连续标识也撑宽页面。[theme.ts](../src/artifact/src/theme.ts) 减少小屏间距、隐藏空位、保留主题按钮宽度，并让消息正文在必要时换行。最终页面 scrollWidth 为 305px，未超过 320px 视口；差值来自滚动条。
3. **分享预览空白**：iframe 中能读到完整 DOM，但正文布局尺寸为 0，截图为空白；等待标题可见也超时。重建同样 sandbox 和 srcdoc 的 iframe 后实际显示恢复。[template.ts](../src/artifact/src/template.ts) 现在先打开弹窗，再挂载新沙箱 iframe；每次打开使用原内嵌分享字节，没有放宽权限。浏览器验证增加标题可见断言，避免把 DOM 存在误判为用户可见。

原页面、各次生成及失败日志均保留，旧报告不自动改写。最终样例：[完整报告](../output/portfolio-report-2026-09-15-browser/final-v3/report.html)、[实际下载文件](../output/playwright/comparison-2026-09-15/download.html)。完整报告包含人工私密标记，用于验证分享过滤；这些不是用户账户资料。

## 实际检查

| 检查 | 结果 |
|---|---|
| 1440×1000、390×844、320×844 | 三条 SVG 曲线可见；图表没有纵向裁剪；页面无横向溢出 |
| 窄屏键盘 | 图表和收益表可聚焦后用 ArrowRight 横向滚动，Enter 展开/关闭原始净值 |
| 数值 | 原始净值末值 A=1.875、B=1.2、SPY=1.452，与独立合成期望一致 |
| 分享弹窗 | 三尺寸标题实际可见；iframe 保留空 sandbox；Escape 关闭并返回 Share preview 焦点 |
| 分享过滤 | 无 SYNTHETIC_PRIVATE 标记或人工金额 9876543.21；预览 srcdoc 等于内嵌分享文档 |
| 下载 | 实际触发浏览器下载，UTF-8 字节逐一等于内嵌分享文档；不是额外加合成横幅的 share.html |
| CDN 失败 | 主动拦截一次 ECharts CDN 请求；库未加载，三张静态 K 线回退存在，Chart/Raw 可切换 |
| 配色 | 默认上涨 rgb(229,73,77)、下跌 rgb(30,159,77)、中性 rgb(166,166,166) 区分；浅色主题三组曲线仍可区分 |
| 离线 | 下载 HTML 在新页面、浏览器 offline 模式下渲染，零请求/脚本错误，净值展开与数值核对通过 |

离线加载方法：先通过 loopback 读取已下载文件，再断开浏览器网络并用 setContent 加载这些字节。CLI 阻止 file 协议，因此没有声称完成“从资源管理器双击本地文件”的验收。该副本没有 script 或 iframe。仅确认当前合成样例和默认红涨绿跌；绿涨红跌完整图表、真实终端字体/视觉与首次配置到真实研究任务仍需验收。

下载 SHA-256：`8251D53D941FD57831DE19849535279A94B642A3A4FA8C6BF4FEDE9AC8496AF4`。

截图：[宽屏完整日期轴](../output/playwright/comparison-2026-09-15/chart-1440.png)、[320px 可见分享预览](../output/playwright/comparison-2026-09-15/preview-320.png)、[CDN 失败 K 线](../output/playwright/comparison-2026-09-15/cdn-failure-kline.png)、[浅色曲线](../output/playwright/comparison-2026-09-15/light-comparison.png)、[离线分享](../output/playwright/comparison-2026-09-15/offline-share.png)。

## 复跑

合成报告生成器拒绝覆盖既有目录，先选择新目录：

```powershell
bun run scripts/check-portfolio-report.ts output/portfolio-report-new
python -m http.server 18876 --bind 127.0.0.1 --directory output/portfolio-report-new
```

在另一个终端通过 Playwright CLI 打开 `http://127.0.0.1:18876/report.html`，使用 [浏览器回归脚本](../output/playwright/comparison-2026-09-15/verify-browser.js) 验证三尺寸、显示、键盘与下载。脚本通过 CLI 的 `run-code --filename` 调用，不是 Bun 单元测试。下载保存后放入上述服务器目录的 download.html，再运行 [CDN/离线脚本](../output/playwright/comparison-2026-09-15/verify-offline.js)；它明确使用端口 18876。截图和下载写到 output/playwright/comparison-2026-09-15，复跑若需保留本次证据，应先修改输出目录。

浏览器记录：[三尺寸最终结果](../output/playwright/comparison-2026-09-15/browser-final-v3.log)、[CDN/离线结果](../output/playwright/comparison-2026-09-15/offline-check.log)。这些是实际 Chrome 检查，不并入 Bun 测试数量。

工程回归：**1422 pass / 0 fail，173 文件、18448 断言，105.40 秒**，日志 `%TEMP%/whyj-report-browser-tests.log`。typecheck、architecture（0 baseline violations）、build（2962 modules / 6.71 MB）通过。浏览器回归脚本直接验证显示、布局和下载行为，本次没有增加镜像 CSS 字符串的单元断言。

## F06 绿涨红跌与窄屏静态图复核（2026-09-15）

使用 [合成生成器](../output/playwright/market-colors-preview.ts) 从实际 Artifact 模板渲染红涨绿跌、绿涨红跌两份 30 根日 K 线；每三根分别为上涨、下跌、平值，不接真实行情或账户。Chrome 已在两种约定、深浅主题、1440/390/320px 共 12 种交互图组合读取 ECharts 实际 option：蜡烛、成交量与 MACD 方向使用相应的涨跌颜色，平值中性；页面宽度无溢出，图表 canvas 存在。

主动拦截 ECharts CDN 后，原 390px 静态回退保留 10/10/10 根涨/跌/平蜡烛，颜色也正确；但 [初始截图](../output/playwright/market-colors-2026-09-15/green-up-cdn-failure-390.png) 可见 1000×520 的 SVG 被等比例缩到约 318×165，落在 390px 高的卡片中央，日期与价格太小。增加可读宽度与卡片内滚动的浏览器断言后初验失败。现在 [主题 CSS](../src/artifact/src/theme.ts) 只在手机且静态 SVG 尚在时允许图内横向滚动，保持 SVG 750px 宽；[K 线容器](../src/artifact/src/renderers.ts) 可通过键盘聚焦。交互版 canvas 没有额外滚动或尺寸变化。

最终 [浏览器验收脚本](../output/playwright/market-colors-2026-09-15-final/verify-browser.js) 的 12 个交互组合全部通过，图表在宽屏 520px、手机 390px 高；绿涨红跌静态回退在 390px 的图内可见 750×390 的价格区域，卡片宽 318px，方向键后 `scrollLeft > 100`。320px 的卡片宽 248px，图内可继续滚动；两个页面的 document scrollWidth 恰好等于视口。静态截图见 [390px](../output/playwright/market-colors-2026-09-15-final/green-up-cdn-failure-390.png)、[320px](../output/playwright/market-colors-2026-09-15-final/green-up-cdn-failure-320.png)，交互图见 [绿涨红跌深色宽屏](../output/playwright/market-colors-2026-09-15-final/green-up-dark-1440.png) 与 [浅色 320px](../output/playwright/market-colors-2026-09-15-final/green-up-light-320.png)。浏览器脚本报错 0；CDN 拦截对应的一条资源加载错误是预期故障注入。浏览器会话已关闭。这里验证的是合成 Artifact K 线，不是所有真实终端界面，F06 仍为部分完成。

复跑需选新目录并将验收脚本的 `--filename` 指向新目录：

```powershell
bun run output/playwright/market-colors-preview.ts output/playwright/market-colors-new
Copy-Item -LiteralPath output/playwright/market-colors-2026-09-15-final/verify-browser.js -Destination output/playwright/market-colors-new/verify-browser.js
npx --yes --package @playwright/cli playwright-cli -s=whyj-market-colors open file:///C:/Users/yangjing/Project/oh-my-quant/output/playwright/market-colors-new/red-up.html --browser chrome --config output/playwright/annual-browser.config.json
npx --yes --package @playwright/cli playwright-cli -s=whyj-market-colors --raw run-code --filename output/playwright/market-colors-new/verify-browser.js
npx --yes --package @playwright/cli playwright-cli -s=whyj-market-colors close
```

上述 Chrome `file:///C:/...` 地址是本机示例，应换成自己的实际目录。

最终工程复核：Artifact/TUI 配色与生成三文件专项 **34 pass / 0 fail、296 次 expect**；全量 **1598 pass / 0 fail、191 文件、21234 次 expect、153.18 秒**，日志 `%TEMP%/whyj-market-colors-full-2026-09-15.log`。typecheck、architecture（0 baseline violations）、test fence、build（2983 modules / 6.78 MB）通过；合成生成器另以 strict TypeScript 检查。PRD、年报与本记录 175 个相对文件链接无缺失，新增代码/文档无行尾空白。旧报告没有自动改写。

## 真实双组合报告的外部查阅入口（2026-09-18）

用[生产 PTY 连续任务](./terminal-workflow-audit.md#生产-pty-的双组合比较自动报告与恢复2026-09-18)自动生成的保存报告，在浏览器检查发现 `000001.SZ` 被指向 `danjuanfunds.com/funding/000001` 和 `fund.10jqka.com.cn/000001`；后者实际上是同号的基金页。原因是旧生成器从标题/对话抽六位号码，再依赖“指数/基金”字样猜类型。六位代码不足以区分股票 `000001.SZ`、基金 `000001.OF` 和指数。旧报告保留原始字节，作为故障证据。

[source-links.ts](../src/artifact/src/source-links.ts)现在只使用研究报告中已经核验的归档数据集：`fund-nav` 且 `.OF` 才给基金页，AKShare `stock_zh_a_daily` 的 A 股 `.SZ/.SH` 才给股票页；指数端点、ETF 和未知端点不生成猜测链接。dock 标题改为 **Instrument lookup**，并写明外部页面仅供查阅，报告上方的归档观测才是价格证据。[雪球的平安银行](https://xueqiu.com/S/SZ000001)、[贵州茅台](https://xueqiu.com/S/SH600519)和[同花顺股票页](https://stockpage.10jqka.com.cn/000001/)用于核对 URL 格式；[同花顺同号基金页](https://fund.10jqka.com.cn/000001/)说明碰撞风险。

从同一真实会话重新生成的**派生预览**（不覆盖保存报告）在 Chrome 中显示 `000001.SZ` 与 `600519.SH` 各两条股票入口、无 `000001` 基金入口；1440px 报告图表、风险表和来源卡正常，390px 页宽和文档滚动宽均为 390px。[宽屏截图](../output/playwright/report-live-2026-09-18/desktop.png)、[手机首屏](../output/playwright/report-live-2026-09-18/mobile-viewport.png)、[手机分享预览](../output/playwright/report-live-2026-09-18/mobile-share-viewport.png)是实际浏览器渲染。分享预览的标题和量化卡片可见，Download HTML 按钮可见；本次未重新验证下载文件或离线打开。控制台唯一错误为本地 Python 静态服务器的 favicon 404，非报告脚本错误。派生预览 SHA-256：`B44001533807072DE0815696590B85CB73A68B20788A518DECC471EEDBBED987`；原保存 HTML SHA-256：`7B5533A29FCC1EF64C2D9055FB730242CC2F2478BEC042DDFBF998C3B10B6486`。

回归测试同时覆盖同号股票/基金/指数、重复数据集、未知端点及完整生成器里“标题含基金字样但无相应归档”不生成入口。它验证的是路由身份和页面内容，外部查阅站点的将来可用性不由本地测试保证。

本轮定向 Artifact 测试 **42/42、290 次断言**；全量 **1777/1777、215 文件、22922 次断言**，类型检查、架构检查和构建通过。测试及浏览器均针对当前工作区，旧保存报告不自动迁移。
