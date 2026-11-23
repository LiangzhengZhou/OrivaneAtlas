# 全产品升级检查点 · Session 397

2026-11-23，codex/ux-upgrade，起点 0f0595ae276874e8f02f7cadf5fcff97f738e858，工作树当时干净。实现提交 9ef26d29847b836a9fbeb29cbc988843244b2da1。此实现之上的本地检查点提交仅收录规范、证据和台账，可通过 git log -1 -- docs/ux-upgrade/PROGRESS.md 识别。完整总纲已从附件逐字节导入。全量升级仍在实施，未达到 §13。任务树见 BASELINE.md，风险与二十组验收分别见 ISSUES.md、ACCEPTANCE.md。

## 当前成果

- 品牌母版、Web 字标、Windows 多分辨率和 Android 自适应、通知资源；两种实页方案及选型见 BRAND.md。
- 原有五个主题偏好继续使用。重新配色、持久壳层、移动导航和首页最近项目已实现。设置、搜索、图谱和编辑器的完整体验矩阵仍待验证。
- Application 授权输入的资源投影、按类型和 ID 关联多项目、响应式列表与网格、分页、键盘打开与详情焦点返回、分账号保存视图、多选文件顺序上传与单项重试已实现。收藏、最近资源、批处理、文件夹关系投影、预览和细粒度权限回归仍待完成。
- 文档保存状态、日历日期间键盘移动、图谱控件名称与状态、通知已读筛选与按钮可发现性已改。未变更数据库、公共 API 或 Agent Tool。

## 证据与限制

所有日志在 .artifacts/ux397/。before-desktop.log 为 8/8（136 张实际页面图），before-mobile.log 为 1/1（50 张）。docs/ux-upgrade/evidence/before 与 after 为相同 1440/768/360 视口的浅/深色文件库；after 是中间候选。verified 目录另存真实操作截图。所有数据为本机隔离测试夹具。

|验证|结果|
|---|---|
|pnpm typecheck / pnpm build|types-r4.log、build-r3.log；类型检查与构建成功。构建仍报告超过 500 kB 的 chunk。|
|资源投影及图标专项|catalog-icons-r2.log，6/6。Android 图标安全区检查 10/10。|
|五套调色板 × 明暗 × 五组对比度|实际浏览器 50 组满足各自阈值；contrast-r2.log。尚缺组件全部状态与辅助技术实测。|
|资源上传与失败重试、键盘日历、通知与主题专项|独立候选产物 .artifacts/ux397/candidate-web；final-flows.log，三个配置 12/12，通过用时 25.5 秒。|
|Android JVM|android-jvm.log，7 项通过。未连接真机，安装/外部文件/软键盘/真机 WebView 未验证。|
|Rust 当前机器目标|rust-test.log，31 通过、5 忽略。离线 GNU debug 无签名 Tauri 打包另遇链接导出序号 120828 超限；windows-build-r2.log。|
|本机性能|evidence/resource-before.json 与 resource-after.json。相同设备和浏览器，1k 首次列表 400→417 ms，选择 104→87 ms；10k 首次列表 1745→1161 ms，选择 570→65 ms。10k 行节点 10000→60。单次样本，机器并行运行其他检查。|
|全量 pnpm check / pnpm test:e2e|首轮运行针对中间构建，已有失败。check.log、full-browser.log 保存进度，专项复验不能替代最新源码全量结果。|

## 恢复入口

1. 在 D:/Lib/Codex_workplace/ArcLattice 执行 `git status --short --branch` 和 `git rev-parse HEAD`。先看 `Get-Content -Tail 30 .artifacts/ux397/check.log`、`Get-Content -Tail 30 .artifacts/ux397/full-browser.log` 与 `Get-CimInstance Win32_Process`，确认已有测试主进程/句柄是否结束。保留这些测试与隔离宿主。避免改写其运行中的 apps/web/dist；可以独立构建至新目录。
2. 全量首次运行已暴露图标帧、通知操作、旧计时按钮、旧调色板/字标断言和触摸排序。先汇总全部失败，复查 tests/e2e/work.spec.ts 和可排序行交互。只针对有产品规格或可重现缺陷的项改动。以单 worker 新输出目录复验，然后再次走全量。
3. 最新候选需本地运行 `pnpm check`、构建后 `pnpm test:e2e --output .artifacts/ux397/recheck-browser --reporter=line`。本机使用 `$env:NO_PROXY='127.0.0.1,localhost,::1'`；Rust 测试 DLL 搜索路径 F:/Software/ArcLattice-native-toolchain/msys2/ucrt64/bin，可将 ATLAS_NATIVE_TEST_EXE 指向本地已编译的 src-tauri/target/debug/deps/arclattice_lib-ce5f90ddf5bceceb.exe。每次复跑指定新日志目录。
4. 优先补齐 P0 两个独立 principal 的搜索、计数、详情、预览、撤权与账号切换测试，再补应用层 FolderLink/SpaceFolderLink/ProjectFolderLink 展示、收藏和最近访问。开发前核实存储与迁移契约。沿 BASELINE.md 阶段 6–11 和 ACCEPTANCE.md 推进笔记至发布准备。
5. Windows 重试优化的本机无签名构建，保留隔离配置；待有设备后执行 Android 与 Windows 真实交互。版本兼容、备份恢复演练和重大问题清零后再按 §14 编写最终报告。生产、发布、签名和真实数据未操作。

## 22:09 本地门禁交接

- 两个全量进程仍在执行。Playwright 主 PID 50768 已开始第 228/792 条；Vitest 主 PID 3304 继续运行。前者使用 1420/1421 两个临时宿主，后者仍有 worker。保持两者运行，不要覆盖它们的 dist 或结果目录。adb 本地 daemon 由设备盘点启动，未发现设备。后续以实际 PID、日志和结束状态为准。
- 最新源码 pnpm lint 通过（1008 个文件及架构边界），pnpm typecheck 通过（11 个任务及根工程）；日志 lint-r4.log、typecheck-r5.log。实际操作专项 12/12 见 final-flows.log。打印改为白色表面；产品基线自 3.1.8 仅保留暂停，计时测试仍验证实际四次写入、累计时长和刷新恢复。截图定位到触摸模式启用后行高发生变化，修正测试坐标后长按与松手提交三个配置均通过（touch-r3.log，19.4 秒）。
- interaction-recheck.log 的首次增量测试遇到占用的默认 1420 端口，结果作废。后续以 ATLAS_E2E_BASE_PORT=21540/22540、ATLAS_UI_FIXTURE_DIST 指向独立 candidate-print 的测试为准。interaction-r2.log 为 10 通过、2 桌面取点失败。最新完整四个交互用例 × 三配置全部通过（interaction-r4.log，12/12，1.3 分钟）。交接写盘前全量浏览器最新已开始第 261/792 条。
- 文件布局截图可复现：node scripts/capture-resource-layout.mjs layout .artifacts/ux397/candidate-print .artifacts/ux397/new-layout。指定的新输出目录必须尚未存在。evidence/candidate 包含 6 张截图，宽度 1440/768/360，各含明暗，scrollWidth 与 viewport 无差值。完整性能命令：node scripts/measure-resource-browser.mjs .artifacts/ux397/candidate-print .artifacts/ux397/new-perf.json。
- 分支只含本地提交。git show --stat 9ef26d2 列出实现范围；当前阶段报告为 CHECKPOINT-397.md。仓库忽略 HANDOFF、PROJECT_STATUS 和 sessions，它们已在本地接力区更新。
