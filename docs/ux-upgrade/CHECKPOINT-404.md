# Session 404 · 个人文档键盘切换与关闭

## 1. 执行摘要

从 `c781ed4` 恢复。个人笔记现在可以在打开的文档之间用键盘切换，关闭当前笔记后可以从相邻标签继续操作。Windows 强制颜色下也能辨认焦点。另修复本地 PostgreSQL 物理还原夹具重用已释放端口的问题。

## 2. 模块范围

|范围|本轮验收|
|---|---|
|笔记和文档工作区|三篇合成笔记的首末定位、左右回绕、中文标题输入、关闭、保存与重开。共享标签组件亦供文档、日记和文件使用。|
|设计系统与无障碍|明色、深色、320 像素强制颜色、减少动态效果、窄屏、键盘焦点和标签面板的名称关联。|
|Windows/Tauri|独立标识、独立 WebView2 配置、无签名测试程序。Windows 实窗复核关闭、焦点和中文标题重载。|
|存储和质量门禁|真实 PostgreSQL 事务、重启、物理副本和源库隔离，完整本地检查与浏览器回归分别记录。|
|全产品其余模块|逐项状态见 [§13 台账](ACCEPTANCE.md)。多人功能按用户决定暂缓。Android 真机、系统输入法和真人读屏仍开放。|

## 3. 品牌与设计系统

标签沿用现有文字、按钮和主题色。键盘焦点使用向内偏移的 2px 轮廓，滚动容器不会裁掉边缘。强制颜色使用系统 Highlight。旧版在 Windows 实窗里能查询到焦点，计算样式的 outline 却为 none。

## 4. 模块体验

焦点位于标签时，左右键切换并回绕，Home/End 选择首末标签。关闭当前项优先选择右邻，末项关闭时选择左邻。保存会暂时禁用关闭按钮；如果焦点因禁用回到页面正文，完成后将焦点送到相邻标签。回归在输入框用真实浏览器组合事件将“山野二”改为“山野二笔记”，核对持久化正文“山野二的正文”。

## 5. 资源中心

此次改动位于多个资源共用的打开标签栏。最终 Windows 程序复测了 18,875,129 字节合成 PDF 的前两页像素与关闭焦点，另以四页样本直达第 4 页，并在文件夹名称组字时按 Escape、确认名称后在目录树中找到“阅读草稿”。前次按段读取字节数和取消的独立核对见 [Session 402](CHECKPOINT-402.md)。[本轮大 PDF](evidence/session404/windows-large-pdf.json) · [跳页与文件夹](evidence/session404/windows-paging.json)

## 6. 架构和变更文件

|提交|文件|职责|
|---|---|---|
|`68da806`|`packages/storage-postgres/src/{testing,index.test,v22-backup.test}.ts`|测试库每次启动前申请环回端口；恢复副本与源库独立连接；占住旧端口后验证可重启。|
|`8de38ba`|`apps/web/src/DocumentWorkspace.tsx`、`tests/e2e/work.spec.ts`、`tests/ux-dark.playwright.ts`|标签和面板的可访问名称、键盘切换、异步关闭焦点及明暗交互回归。|
|`ff18859`|`apps/web/src/workspace.css`、`tests/e2e/work.spec.ts`|可见轮廓和浏览器计算样式断言。|

## 7. 数据库、API 与同步

编辑和关闭仍通过既有应用契约保存，正常浏览器用例从隔离宿主独立读取正式标题与正文。Windows 夹具在本机重载后从笔记入口重新打开已改名笔记。此次改动无需迁移 Schema、API 或同步数据。

## 8. 性能与环境

本地 Windows 11 build 26300，i5-12500H，15.8 GiB 可见内存，Node 24.20.0、pnpm 11.25.0。Vite 同配置构建，主 JS 的 gzip 报告值从 809.39 增至 809.74 kB，主 CSS 从 36.13 增至 36.17 kB。两次均有大于 500 kB 的既有构建告警。本轮测量的是产物大小，低端设备交互时延和峰值内存仍需实测。

## 9. 自动化验证

本地 `pnpm exec vitest run packages/storage-postgres/src/connected.test.ts` 通过 2/2，测试与数据库启动日志在 `.artifacts/ux404/connected*.log`。上轮 interrupted 日志无法确定这两个用例的失败根因。另一次旧版物理还原的 server.log 有明确的 IPv4 端口 bind 拒绝记录。新用例直接占住旧端口，并分别向在线源库与物理副本查询实际监听端口。

初次全检因夹具格式失败，修正后完整全检通过 1595/1595。中间候选也曾因新增 E2E 代码格式失败，已修正。旧版浏览器专项在 Home 定位失败；第一次实现还复现保存禁用关闭按钮后焦点丢失。最终 Windows 检查用 `node docs/ux-upgrade/evidence/session404/windows-tabs.mjs <新输出目录> <隔离测试程序>`。原始日志保存在 `.artifacts/ux404`。

交付候选 `ff18859` 的 `pnpm check` 退出 0。Biome 检查 1089 文件，架构边界通过，11/11 包类型检查，309 文件、1595/1595 测试通过，Vitest 用时 727.29 秒，构建 2/2。最终日志为 `check-focus.log`。Windows 实窗使用 WebView2 158.0.4370.33；强制颜色、减少动态效果与 320 像素视口联合专项通过 1/1，900 像素专项通过 1/1。

最终候选用 `pnpm test:e2e --workers=2 --reporter=line --output=.artifacts/ux404/browser-final` 跑完三个配置，855/855 通过，退出 0，用时 1.2 小时。关闭宿主后的扫描重试日志为 0。完整深色套件 `pnpm exec playwright test -c tests/ux-dark.playwright.ts --workers=1` 通过 48/48，用时 7.4 分钟。之前两次浏览器运行分别在 198/852 和 193/855 更换候选时终止，均未计入通过数。[日志摘要及 SHA-256](evidence/session404/gates.json)

## 10. 交互证据

[改前桌面](evidence/session404/before-desktop.png) · [改后桌面](evidence/session404/after-desktop.png) · [窄屏](evidence/session404/after-narrow.png) · [移动深色](evidence/session404/after-mobile-dark.png) · [强制颜色改前](evidence/session404/before-forced-colors.png) · [强制颜色改后](evidence/session404/after-forced-colors.png) · [Windows 实窗](evidence/session404/windows-tabs.png)

## 11. 发布、备份与回退

本轮采用隔离宿主、合成笔记及测试库。需回退时，从 `c781ed4` 的独立工作树重建上一个 Web 候选并运行笔记、关闭草稿和物理备份专项。建议先在测试环境验证回退后重开 Markdown 与标题。无需处理已有数据库或真实用户文件。Windows 验证产物为独立测试程序，未签名、未制作安装包。

## 12. 待验与风险

Android 低内存真机、系统输入法候选窗、读屏器口播和全套安装升级仍待实测。模拟手机视口和 CDP 组合事件分别记录。旧 PostgreSQL 事务运行缺少终态堆栈，保留为未确诊的历史失败。

## 13. 运维影响

线上服务、正式发布和运维配置均无变更。本机测试库由夹具选择临时环回端口，排查时从该次运行的 server.log 获取实际端口。Windows 使用已有本地离线工具链。首次构建未找到 windres；改用已有 ucrt64。绝对前端路径曾导致 WebView2 打开 file URL；改用相对 frontendDist 嵌入候选后在 Tauri 源上复验。
