# Session 402 · 个人阅读与中文输入

## 1. 执行摘要

用户于 2026-11-24 暂缓多人功能。本轮从 codex/ux-upgrade 的 d52ccc0 接力。4cf727e 改进 PDF 取段、跳页与重试，8256fa7 修复中文输入法使用笔记文件夹时的提前保存或取消。bba4419 修复窄屏弹窗收到浏览器原生 cancel 时的错误关闭。开发范围为本地个人工作区。

## 2. 范围

涉及 §13 第 5、6、14–17 项。此前候选 60553a4 的 pnpm check 为 1590/1590，完整 Playwright 为 843/843；本轮单独记账。其他个人模块仍按 [总验收表](ACCEPTANCE.md) 推进。

## 3. 品牌与设计系统

PDF 页码与重试沿用双语基础控件和阅读窗口。三页起提供数字输入；短文件使用逐页按钮。320 像素视口可换行，强制色和减少动态效果联合测试通过。点击重试后焦点留在阅读窗口，关闭后回到启动按钮。

## 4. 模块体验

个人笔记的根文件夹创建、子文件夹创建及重命名均识别输入法组合事件。候选期间回车或 Esc 保留草稿，组字完成后回车提交、Esc 放弃本次编辑。使用 Chromium 调试接口让输入框实际进入组合输入，发送可信 Escape 可观察到浏览器随后触发原生 cancel。bba4419 在保留输入法事件处理的同时忽略当次弹窗关闭请求；普通 Esc 取消重命名后目录面板继续可用。另有旧式 229 键码覆盖。真机输入法另行验收。[实际浏览器事件顺序](evidence/session402/ime-chromium.json)

## 5. 资源中心

四页合成文件验证第一页到末页、键盘直达、超界拒绝、逐页按钮同步页码和画布像素。真实 HTTP 注入一次 503 后，通过窗口内重试恢复第一页；另验关闭挂起请求和确认会话失效后的内容隐藏。[交互测试](../../tests/e2e/work.spec.ts)

## 6. 架构与代码

SQL 存储通过应用层可选的受权原件区间端口提供请求字节。完整下载和旧适配器仍验证整件。两种数据库均在原工作区与事务内检查读权限和描述符。[ADR 0154](../adr/0154-verified-personal-file-ranges.md)

- 应用与 Host 涉及 packages/application/src/{file-binary,files,local-persistence,verified-file-ranges,index}.ts 及 packages/host/src/file-routes.ts。
- SQLite、PostgreSQL 的 file-binary.ts 和 index.ts 实现同一份合同。两个摘要损坏用例和 tests/contracts/file-binary.ts 覆盖读出行与初次验证的原件身份。
- Web 改动集中在 PdfOriginalPreview.tsx、files.css、FolderTree.tsx 与 DismissibleDialog.tsx。完整文件清单可用 git diff --name-status d52ccc0..c186b0d 查阅。

## 7. 数据与同步

原件身份仍为 SHA-256。实例仅保存最近 16 份原件的分块摘要，每份最多 1024 块；首次读取逐块验证整件，后续逐块复核实际读取的字节。未访问块的后来损坏会在读取该块或整件下载时发现。会话、工作区、软删除与父级位置随请求检查。数据模型、文件原文和离线副本均沿用。多人委派与角色政策暂缓。

## 8. 性能与环境

Windows 11 build 26300、i5-12500H、16 GB、Node 24.20.0、SQLite、本机 HTTP。原件 18,875,129 字节，各取首块、尾部完整块、末尾短块共 525,049 字节。每次响应均验证 206 和返回内容的 SHA-256。

|每组三个请求|原实现 SQL 字节|改后 SQL 字节|原实现 / 改后耗时|
|---|---:|---:|---:|
|首次|56,625,387|19,138,034|511 / 119 ms|
|重复一|56,625,387|525,049|474 / 17 ms|
|重复二|56,625,387|525,049|490 / 19 ms|

SQL 单批最大值从 18,875,129 降到首次 1,048,576、重复 262,144 字节。数字衡量数据库返回给应用的二进制负载。耗时为单机样本；原始 RSS/CPU 包含同进程的 Host 和客户端。[原始测量](evidence/session402/host-range-comparison.json)

## 9. 质量门禁

- 本地 pnpm exec vitest run packages/application/src/verified-file-ranges.test.ts packages/storage-sqlite/src/files.test.ts packages/storage-postgres/src/files.test.ts packages/host/src/server.test.ts 为 4 个文件、138 项全部通过。
- pnpm exec playwright test -c docs/ux-upgrade/evidence/session402/host-range.config.ts 对改前、改后各通过 1 项。改后设置 ATLAS_EXPECT_VERIFIED_RANGES=1，强制检查读取量上界。
- pnpm test:e2e --grep 'personal PDF reading|large PDF originals' 在三配置通过 6/6。tests/ux-dark.playwright.ts 同组 4/4；窄屏配置 docs/ux-upgrade/evidence/session402/narrow-reader.config.ts 为 1/1。
- pnpm test:e2e --grep 'personal folder names' 在旧产物桌面中文复现 1 项失败，修复后 3/3 通过。检查根与子目录、重命名、取消及刷新。
- 早期 Host 的 Range 字面类型推断导致类型检查失败，经修正后 11/11 包通过。首次重试夹具将 503 注入了本地文件路径，未产生网络错误；已改用独立账号的已同步原件测试 503，将本地夹具用于检验跳页。
- 原始日志在 .artifacts/ux402。完整回归的终态见本节末的运行记录。

8256fa7 的两项个人功能联合回归 9/9。首轮完整 pnpm check 以 0 退出，309 个文件、1592 项测试、2 项构建通过。

bba4419 的个人场景联合回归 9/9，耗时 1.1 分钟；包含浏览器原生 IME 路径。此提交的 11/11 类型检查和架构边界通过。旧弹窗、浮动菜单、点击外部保留草稿的交互回归在三配置 6/6 通过。

完整深色套件 44/44 通过（2.6 分钟），覆盖本轮个人功能以及笔记、日记、图谱、项目等既有入口。c186b0d 增加两个兼容用例：1025 个单字节历史分块每次按批复核、不同工作区验证记录隔离及淘汰后重新核验。该文件 4/4 通过。[各次运行摘要与日志指纹](evidence/session402/gates.json)

最终在 c186b0d 完整重跑 pnpm check，退出码 0：309/309 文件、1594/1594 用例，Vitest 为 740.92 秒，类型检查 11/11，生产构建 2/2。

完整明色浏览器回归 846/846，耗时 53.2 分钟，退出码 0，failedTests 为空。该运行的发现清单及工作台 Web 夹具固定于 4cf727e；后加入的输入法修复另在最终 Web 产物上运行 9 项个人流程、6 项弹窗兼容和全套深色 44 项。使用 pnpm test:e2e --workers=2 --reporter=line 和独立输出目录。日志含 50 条重复任务后台扫描重试，上期完整运行亦有 41 条；原因未定位。

## 10. 交互证据

相同四页原件、第 3 页、768×900 中文视口、Chromium 153.0.8010.12，改前使用 60553a4 已记录的构建指纹，改后为 4cf727e。另留实际操作后的英文桌面和中文移动截图。

[改前](evidence/session402/before-768.png) · [改后](evidence/session402/after-768.png) · [桌面浅色](evidence/session402/light-desktop.png) · [移动深色](evidence/session402/dark-mobile.png) · [320 像素强制色](evidence/session402/forced-colors-320.png)

Windows 使用 c186b0d 的隔离工作树、新标识 app.orivane.atlas.ux402fixture、单独的 WebView2 配置和本地 Rust GNU 缓存构建测试程序。命令为 pnpm exec tauri build --no-bundle --no-sign --config <windows-fixture.json>，用 node docs/ux-upgrade/evidence/session402/windows-reader.mjs <新目录> <隔离测试程序> 复验。首次启动缺少工具链环境，随后一次离线缓存未包含 rustls；指定已安装的 RUSTUP_HOME 和正确的 cargo-home 后完成构建。WebView2 158.0.4370.33 的真实窗口成功从第 1 页直达第 4 页，核对画布、输入焦点和关闭后归还焦点。768 像素布局下发送真实组字与 Escape，面板保留并能保存中文名称。[实窗截图](evidence/session402/windows-reading.png) · [原始结果](evidence/session402/windows-reading.json)

## 11. 发布、迁移与回退

本机开发提交，未发布。回退这两项产品变更可重新使用 d52ccc0 对应的 Web 与 Host 构建；此次无 Schema、数据迁移或持久化预览缓存。旧数据库仍用相同原件分块表。本地先用 60553a4 的旧 Web 构建导入文件，在同一临时设备工作区完成升级、回退、再升级和离线下载。五个阶段的深链、主题、文件名和原件摘要均一致。[五阶段记录](evidence/session402/web-rollback.json)。系统安装包回退仍待验证。

## 12. 未完成项与风险

Android 低内存真机、系统 IME 和读屏仍待验证；浏览器移动视口属于仿真。首次取段仍需验证整件。个人长笔记在输入组合期间切换视图、保存及恢复草稿的端到端验证尚待补齐。下一步先查 DocumentWorkspace.tsx 和 LiveMarkdown.tsx 的组合事件与保存响应，再用独立工作区复核长中文笔记原文。多人政策依用户指示暂缓。

## 13. 运维影响

使用本地临时数据库、环回端口、合成账号和原件。线上服务、新发布、签名和真实用户数据均未参与。全部本轮构建、回归和测试程序已结束。额外 Windows 工作树 ../ArcLattice-ux402-native 保留在 c186b0d，构建生成的 ACL 已留档，工作树干净。复验用仓库内证据和 .artifacts/ux402 的本地日志。
