# 全产品升级检查点 · Session 398

2026-11-23。分支 codex/ux-upgrade，从 722f929 的干净工作树恢复。上一轮的 Vitest 已结束；上次浏览器全量回归使用旧资产，最终 780 通过、12 失败。历史检查点仍保留在下方。本轮结果见 CHECKPOINT-398.md。

**已实现并在候选上验证**：收藏、最近打开、批量收藏、双账号同名文件与深链隔离、目录与空间/项目引用展示、旧标记补齐、单文件上传后打开、移动抽屉和日记日期导航。表格预览可读 CSV/TSV 源文本，图片可放大，PDF 文本可分页。在真实 Windows WebView2（Edg 158.0.4370.33，1280×840）已完成双文件导入、键盘详情及打开、CSV 表格和 PNG 放大，六个交互步骤和截图见 evidence/session398。Android 的 JVM 7 项验证沿用 Session397，真机未连接。

|验证|本地日志与结果|
|---|---|
|资源、账号、集合|.artifacts/ux398/resource-r4.log 6/6；bookmarks.log 对原属账号收藏的深链、同名不同正文、登出和撤销会话复验 3/3。|
|副本、绑定、集合修复|repair.log 3 个文件 13/13；包括旧标记、快照领先和同游标补齐。旧版完成标记不会导致无条件全量回写。|
|预览和日记|tables.log 2/2；preview-journal.log 9/9，三配置的闰日日记、表格和账号场景。media-r2.log 的图片/PDF 三配置通过，2 个旧移动导航测试失败；修正真实移动入口并以实际文件选择器复验，mobile-entry-r3.log 2/2。|
|移动文件夹|journal-folders.log 的文件夹创建、重命名、移动、离线、回收站、恢复三配置均通过。当次另三项日记断言寻找错误的标题标签，已在 preview-journal.log 按真实编辑器标题重验。|
|静态、构建|gate-lint.log 架构边界通过；gate-types.log 11 个包与根 TypeScript 检查通过；full-build.log Web 构建成功，仍有大于 500 kB 的 chunk。|
|Windows|windows-optimized.log 生成 31,700,376 字节的无签名 EXE。windows-fixture.log 构建独立测试标识的新版资源。两次桌面实测使用不同 WebView2 用户目录；windows-image-webview.json 记录六步实测。|
|最新全量|check-r2.log、full-browser.log。原生传输 unit fixture 在 check 时设置 ATLAS_NATIVE_TEST_EXE。首次全量浏览器从 807 项开始；数字取自该次收集，后续修改测试断言有独立复验。全量终态见下方门禁记录。|
|性能|同机单次基线/本候选：1k 首次 400→521 ms、选择 104→85 ms；10k 首次 1745→943 ms、选择 570→49 ms。候选节点均为 60 行。|

恢复先在项目根目录执行 `git status --short --branch`、`git log -3 --oneline`，再查看 `Get-Content .artifacts/ux398/check-r2.log -Tail 24`、`Get-Content .artifacts/ux398/full-browser.log -Tail 24`、`Get-Content .artifacts/ux398/android-arm64.log -Tail 12`。本机使用 NO_PROXY=127.0.0.1,localhost,::1。独立 Playwright 复验指定 ATLAS_E2E_BASE_PORT 和 ATLAS_UI_FIXTURE_DIST，不复用运行中的宿主或输出。全量命令为 pnpm check 与构建后的 pnpm test:e2e。原生复验命令和 fixture 范围见 RELEASE-READINESS.md。

下一步先按完整日志判断是否需要重跑失败项，再推进资源预览保真、批量移动、拖放目标、笔记/文档长文与冲突、知识空间/图谱、项目/任务/日历、AI 和设置；逐条验收见 ACCEPTANCE.md。发布前仍须完成旧版本恢复、权限范围和原生设备矩阵。

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

## Session 398 门禁记录（北京时间）

23:09 源码提交 97ea5e5。Vitest PID 45344、Playwright PID 50476（222/807）运行中，本轮独占的测试宿主需保留。Android NDK 初次编译在 Tauri 构建阶段提示缺少 WRY_ANDROID_PACKAGE，随后使用 Android 工程的 app.orivane.atlas、arclattice_lib 与独立 Kotlin 输出目录重试，日志 .artifacts/ux398/android-arm64-r2.log。工作树待提交内容为本轮 docs/ux-upgrade 证据和检查点。恢复时以最新日志终态为准。

### 23:13 补充：重复文件与 Android ARM64

实现提交 97ea5e5、29bcf60。资源应用层按授权范围内的活跃原件、有效 SHA-256 与字节数识别相同内容，界面提供中英文筛选、数量和文件名。类型检查通过；duplicates-unit.log 1/1；duplicates.log 3/3（英文、中文桌面及中文移动）。样例包括同名不同内容、不同名相同内容，单元测试额外包含跨工作区、软删除、大小冲突、无有效旧摘要。

Android 使用现有 NDK 26.1.10909125、API 24 和离线锁定 Cargo 依赖，补齐 Tauri Android 包标识后 arm64 release 原生库构建成功（2m37s，5 个警告）。llvm-readelf 核对 ELF64/AArch64，llvm-nm 核对 app.orivane.atlas JNI 导出，14,872,056 字节，SHA-256 3304B4A94FDE716B5AF15452C4706E847376C3B0EE9830A99B323E231D321762。adb devices -l 设备列表为空。该结果覆盖 JNI 编译，不包括 APK 安装、系统输入、返回和生命周期。日志见 .artifacts/ux398/android-arm64-r2.log 与 android-elf.txt。

### 23:25 总览、图谱与响应式回归

实现 9cfb317。总览通过同一身份下已授权快照显示最近三项资源，空状态可进入资源中心；对已软删除原件的记录不会继续显示。#graph 原先在未指定对象时返回空白，现有可用键盘打开的知识空间与项目入口，分别说明链接和依赖。graph398.log 9/9，graph398-types.log 类型检查通过。

同一浏览器空工作区对 14 条路由、七种宽度、Light/Dark、Comfortable/Compact 共测 392 种组合。首轮暴露图谱缺少入口的 28 项，修复后 root 和 main 均无横向溢出，392 项有可见标题和预期路由。原始数据与截图在 evidence/session398/layout-matrix.json、graph-entry-mobile.png、overview-desktop.png。复跑 node scripts/measure-ux-layout.mjs <候选Web构建目录> <新的结果目录>。测试不覆盖登录后有大量数据的页面、独立画布的内部滚动、真实软键盘和读屏体验。
