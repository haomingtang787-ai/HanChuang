# 寒窗 · 本地 AI 授课老师

把课件丢进去，老师一段一段讲给你听——会提问、会总结、会出题，还记得你的学习习惯。
全程本地跑（Electron 桌面端），课件不出本机；只有讲解、追问、出题这类需要模型的动作才调 DeepSeek API。

当前版本 **1.4.5**。

## 它和「聊天框 + 提示词」的区别

- **先备课，后上课**：导入的课件会先被拆成「原文片段 → 讲解 → 停一下的问题」的结构，讲稿一次生成；之后逐段上课、反复「继续上课」都不再花 token，只有你追问、出题、总结才另算。
- **原文常驻左侧**：PDF/PPT 会被渲染成逐页图片，边讲边翻；支持「用 WPS 打开」原件，DOCX/TXT/代码则显示这一页的原文段落。
- **讲不清有后手**：某段听不懂，可以点「这段详细讲」，或者直接在对话里追问，进度不会丢。
- **图解**：链表、页表、进程状态机这类结构关系，老师会用 Mermaid 画出小图（渲染失败退回代码块，不会崩）。
- **备课前先看价**：素材行会标出这一份备课大概多少钱（按页数本地估算），点「备课」还会再确认一次，取消就一个 token 都不花。
- **左栏可收起，课件与对话对半**：全屏时收起课程树，两边各占 50%，窗口怎么拉都保持比例；双击分隔条复位。
- **设置里能检查更新**：走 `api.github.com` 的 release 接口（不抓网页、不登录），有新版可直接下载安装包并运行安装；只换程序文件，课程与对话都在本机数据目录里。

## 界面

三栏式：左边课程树（课程 → 课件 / 素材），中间对话，下面是输入框 + 模型选择 + 本课 usage。

## 技术栈

| 依赖 | 版本 |
| --- | --- |
| Electron | 45.3.2 |
| TypeScript | 7.0.2 |
| React / React DOM | 19.3.1 |
| Vite / electron-vite | 8.3.8 / 6.0.0 |
| PDF | pdfjs-dist 6.5.438 + @napi-rs/canvas 1.1.1 |
| Office 包 | fflate 0.8.3、fast-xml-parser 5.12.1 |
| 图解 | mermaid 12.x（按需分包，首屏不加载） |
| 测试 | vitest 5.1.0 |

精确版本在 `package.json`，安装锁在 `package-lock.json`。

## 目录

```
src/main/         Electron 主进程（窗口、IPC、文档服务、原生打开 WPS）
src/preload/      暴露给渲染层的 API
src/renderer/     hanchuang/ 新界面；study/ 旧版界面代码
src/documents/    导入、解析、分页、检索（SQLite FTS，中文按字 + 双字）
src/study/        备课与课堂逻辑、提示词
workers/          文档解析 worker（读图、切页不卡界面）
scripts/          界面冒烟脚本（CDP 驱动）、图标生成、成本核对
tests/            单测
docs/             设计文档、验收说明、更新日志
```

## 开发

```bash
npm install
npm run typecheck     # 主进程 + 渲染层两套 tsconfig
npm test              # vitest，当前 333 项
npm run build         # 构建到 out/
npm start             # 直接跑构建产物
```

打包（Windows）：

```bash
npm run dist:win                        # dist/HanChuang-setup-<version>.exe
npx electron-builder --win portable     # dist/寒窗 <version>.exe
```

图标是代码画的：改 `scripts/build-icon.mjs` 里的几何与配色，再 `node scripts/build-icon.mjs`
重新生成多尺寸 `build/icon.ico`（256/128/64/48/32/24/16 逐尺寸绘制，小图标不糊）。

界面冒烟（需先启动带调试端口的实例）：

```bash
npm run build
node node_modules/electron/cli.js . --remote-debugging-port=9222
node scripts/smoke-r6-layout.mjs        # 左栏收起 + 课件/对话对半
node scripts/smoke-r5.mjs               # 素材行预估价 + 备课前价格确认
```

## 本地数据

运行数据在 `%APPDATA%\desk-teacher-agent\library`（SQLite 库 + 课件原件 + 页图缓存），
`settings.json` 里存 API Key，**这两样都不进仓库**。换机器时拷走这个目录即可带着课程走。

## 说明

- 需要本机模型密钥才能上课；没有密钥时只能导入、翻页、搜索原文。
- 「用 WPS 打开」按扩展名找本机 WPS（Writer / 演示 / 表格 / PDF），没装则回退系统默认程序。
- 旧版 `.ppt` / `.doc` 会被拒绝并提示另存为 PPTX / DOCX。
