## Session 403 · 中断检查点

个人笔记修复 d1e998f 已验证 56,066 字符正文在组字期间刷新后可恢复已确认内容，桌面中英文与移动中文 3/3，深色专项 2/2。早期候选的完整浏览器回归 852/852，第一次 CI 调度全检 1594/1594。68a7c01、5651181 修正宿主关闭和测试夹具，关闭后扫描探针 3/3，Host 专项 4/4。

中断后核对：最终 browser-final.log 最后启动第 771/852 项，退出码 1073807364，已记录的扫描重试为零。check-verified.log 显示 11/11 包类型检查通过，PostgreSQL connected.test.ts 两项失败，缺少整套测试终态。未发现仍在运行的 Vitest 或 Playwright 测试进程。两个最终全量门禁均待重新验收。

恢复时先核对分支 codex/ux-upgrade、HEAD 和 git status --short。优先单独运行 pnpm exec vitest run packages/storage-postgres/src/connected.test.ts 并保留临时数据库日志；定位失败后重跑本地 pnpm check 和 pnpm test:e2e。日志位于 .artifacts/ux403，前后截图见 docs/ux-upgrade/evidence/session403。Android 真机和系统输入法待验，多人开发继续暂缓。

# Session 403 · 长中文笔记恢复

从 7b7d262 继续。d1e998f 修复原生组合输入期间的草稿快照，68a7c01 修复升级测试关闭数据库后遗留的重复任务扫描。详见 [复现、交互与检查点](CHECKPOINT-403.md)。

# Session 402 · 个人阅读

从 d52ccc0 恢复，产品提交 4cf727e。桌面与移动浏览器完成页码直达、错误页码、出错重试、原件绘制、取消和撤权回归。SQL 读取与完整性验证收录于 [本轮检查点](CHECKPOINT-402.md)。独立人类账号的多人功能已暂缓。8256fa7 修复笔记文件夹命名时的组合输入，原版本上已复现，修复后三种配置均保留输入并在显式提交后持久化。进一步用 Chromium IME 复现了窄屏原生 cancel 关闭整个面板的问题，bba4419 修复并通过三配置联合 9/9。

补充兼容用例后，最终 c186b0d 的 pnpm check 以 0 退出，309 个文件、1594 项测试、2 项构建通过。Windows WebView2 真实窗口验证第 4 页直达、焦点及中文版文件夹命名的原生组合事件。弹窗兼容专项 6/6；五阶段 Web 升降级核对同一合成原件。

4cf727e 读者候选的完整浏览器 846/846，53.2 分钟；最后的输入法与弹窗修复有独立联合、深色和 Windows 真实交互证据。全部进程已收尾。

# Session 401 · 从完整回归继续

`codex/ux-upgrade` 从 4595838 恢复，产品提交 54a6f07。已核对两个旧浏览器运行的终态，57cdd9e 为 837/837，3b84038 为 840/840。含原生测试程序的完整检查在 3b84038 通过 1588/1588、构建 2/2。下方历史记录中的在途进程均已结束。

18 MiB 两页原件已在三种浏览器配置读取并绘制；每个配置实际传输 525,049 字节。已验证中止在途下载、撤销后锁定、阻止其他账号解锁、原所有者恢复和保留未提交草稿。原生分段请求和 Android 编译修复随 54a6f07 提交。报告、截图和详细命令见 [CHECKPOINT-401.md](CHECKPOINT-401.md)。

54a6f07 的完整检查在 6 个 PostgreSQL 套件的 initdb 阶段失败，302 个文件通过，1515 项通过、75 项未执行。该次运行与 Windows 的全新 release 构建重叠；使用仓库现有 CI 调度串行验证 PostgreSQL，保留原有断言与时限。54a6f07 全量浏览器另发现单张图片 401 会误锁文档。24f1df3 修正会话判断；4d4ecfc 修复设置面板重复退出并返回独立设备工作区。

修复已合入主开发分支的 60553a4。三个独立隔离账户均在首条移动响应被暂扣、撤权、原所有者重登与重开后完成整页 60 项。实测三次从首次确认到服务端最终一致为 7.346、6.988、6.931 秒，含中断与重认证。账号退出、文档内错误、选择器与大 PDF 组合 12/12。真实 Windows 和 Android 构建证据见本轮报告。

60553a4 完整 Playwright 843/843 通过（45.7 分钟），完整深色套件 40/40 通过。768 像素窄屏同时验证减少动态效果和强制色。Web 回滚及离线复开五步均保留测试原件、深链与主题。54a6f07 与 4d4ecfc 的旧浏览器运行曾因候选替换分别提前结束于第 208、79 项，保留失败 trace。24f1df3 的全量 pnpm check 使用 CI 串行数据库，308 个文件、1590/1590、构建 2/2。60553a4 的最终 pnpm check 已在独立工作树 ux-recovery 结束，退出码 0。11 个包类型检查、308/308 测试文件、1590/1590 用例及 2/2 构建通过，Vitest 耗时 2131.75 秒。主树连同可复验材料的 Biome 与架构边界检查通过（1076 文件）。原始日志为 .artifacts/ux401/check-60553a4.log，全部本轮测试进程均已结束。其余 §13 项见 [验收表](ACCEPTANCE.md)。

# 全产品升级接力 · Session 400

2026-11-24，本机 Windows 隔离测试。主分支 codex/ux-upgrade，从 9929884 恢复。代码依次为 92a1c0f（集合移动）、fd5e96d（组合读取授权）、9e10fd0（OpenAPI 随构建输出）、26e02f1（阅读目录与位置）、c455891（图谱搜索）、75b0eea（日历）、bdc9d1c（原件 HTTP Range）、57cdd9e（深色图谱和节点定位）、1ecf1d9（首次同步保留 Wiki 索引身份）、db711d7（纳入长期暗色套件）和 eeef72c（修复整页集合移动被同步竞争打断）。下方先前检查点各自保留其当时状态。报告见 [CHECKPOINT-400.md](CHECKPOINT-400.md)。

|范围|本轮实测|未签收|
|---|---|---|
|集合与权限|三个客户端配置实际移动笔记、文档与原件，核对第三个集合、下载字节与 Markdown 所有权。授权检查覆盖两个路由别名、旧凭据、缺少读取权限及外部工作区。|共享委派和撤权后已开界面。|
|文档与图谱|120086 字符、36 标题在 3 个配置均能准确回到原位置。图谱键盘分页、空结果、局部作用域共 9/9。500/1000 节点不再计算随后丢弃的力布局。|低端机、编辑输入法、密集图的整页延迟。|
|日历|月/周/日/议程共享所选日期和工作区时区。3 配置核对闰日、跨月、从议程创建任务及离开后回到所选周。|系统提醒、原生触控、夏令时切换时的调度体验。|
|原件|基础及可续传单段 HTTP 读取、旧客户端普通 200、416 和缺授权不暴露范围均实测；1048593 字节夹具跨五块上传，再分两段取回，SHA-256 与源相等。|存储层仍在读取前验证完整原件；大 PDF 的端到端按需解析与低端内存预算。|

**首次同步缺陷与性能。** 已用正式 HTTP 接口在隔离账号创建 1,000 篇文档和 1,000 条 Wiki 关系。旧 Host 的展示投影缺少记录身份，开户副本激活在 workDelta 校验处失败。1ecf1d9 的 SQLite/PG 读取使用现有 ID、版本、工作区及时间。三种配置验证旧 Host 阻塞时能看到可执行的提示，更新后同页重试、随后创建缺失目标时原关联版本递增。真实整页三样本中位数：切换/绘制 1682→882 ms，输入/匹配可见 755→161 ms。两版前端使用同一修复后的 Host。

**门禁与恢复。** 92a1c0f 的 `pnpm check` 307/307 文件、1585/1585 测试通过，Vitest 738.18 秒，构建 2/2。原始运行输出在 `.artifacts/ux400`。早一轮 `.artifacts/ux398/browser-825.log` 为 823 通过、2 失败；检查表中保留了测试源码与构建不一致的原因。独立工作树 D:/Lib/Codex_workplace/ArcLattice-ux401 使用自己的依赖与构建，避免修改进行中浏览器的源码。bdc9d1c 的完整 `pnpm check` 已结束，307 个文件、1587 个用例及 2 项构建通过。57cdd9e 的完整门禁分别记录于 `check-57cdd9e.log` 与 `browser-57cdd9e.log`。92a1c0f 的完整浏览器运行 828/828 通过（56.9 分钟），记录在 `full-browser.log`。本机接力含最终 HEAD 和进程。57cdd9e 的 392 个布局组合、图谱 9 项专项与 8 项深色流程均已通过。Windows 使用独立标识、独立数据目录、无签名 Tauri 夹具实际运行了闰日的四个日历步骤，见 evidence/session400/windows-calendar.json。

### 本轮检查点与恢复顺序

产品提交 `eeef72c` 已快进合入主工作树，随后 `3b84038` 收紧了 E2E 等待源集合确认的条件，最新检查点提交用 `git log -1 -- docs/ux-upgrade/PROGRESS.md` 获取。2026-11-24 03:24（+08:00）在本机核对如下。各后台任务使用隔离夹具和独立输出目录。

|任务|现场状态与保护范围|
|---|---|
|db711d7 全量检查|已结束，307 个测试文件、1588 个测试、两项构建全部通过。793.60 秒是 Vitest 时长，日志 `.artifacts/ux400/check-db711d7-r2.log`。|
|eeef72c 整页集合移动|此前 5 项成功、55 项未移动；修复后的真实浏览器两次均完成 60/60，核对 60 份原始正文、30 个文档的 spaceId 和一条第三集合关联。专项合同 14/14。日志 `collection-page.log`、`collection-retry.log`、`collection-retry-contract.log`。|
|eeef72c 完整检查|类型检查、构建通过，Vitest 306 个文件/1587 项通过，1 个文件/1 项因未指定原生测试程序跳过。指定本轮测试 EXE 后对原生传输单独重跑 1/1。记录在 `check-eeef72c.log`、`native-check-eeef72c.log`。|
|3b84038 含原生传输的完整检查|主工作树 PID 46816，`.artifacts/ux400/check-3b84038-native.log`；使用 ATLAS_NATIVE_TEST_EXE 指定已验证的本地 Rust 测试程序。|
|57cdd9e 完整浏览器|独立工作树 `../ArcLattice-ux-graph`，PID 31128 / 53312，`.artifacts/ux400/browser-57cdd9e.log`，已启动第 699/837 项。保持该工作树、构建目录、宿主及输出。|
|eeef72c 完整浏览器|独立工作树 `../ArcLattice-ux401`，分支 `codex/ux-collection-contention`，其产品代码为 eeef72c，测试已在运行前更新到 3b84038。PID 41420 正等待上行全量结束以复用旧测试的固定端口。构建通过，清单 15 文件、840 项。原排队 db711d7 的浏览器任务在尚未启动前由本修复版本替代。新日志 `.artifacts/ux400/browser-eeef72c.log` 会在实际开始后出现。|
|平台与可访问性|真实 Windows Tauri 四步、Android ARM64/JNI 构建、11 月 24 日 03:11 离线重跑 JVM 7/7（通知 4、更新 3）、eeef72c 的强制色与减少动态效果 18/18、3b84038 更新等待条件后完整深色 38/38（4.1 分钟）。392 组布局、28 组页面无障碍树与回退五阶段在该产品代码上已复测。无 Android 真机/模拟器镜像，真人读屏与系统安装升级未验证。|

恢复先读 `docs/HANDOFF.md`，核对 `git status --short --branch`、`git rev-parse HEAD`、`git worktree list`，用 `Get-Process -Id 31128,53312,41420,46816 -ErrorAction SilentlyContinue` 和上述日志判断各任务终态。若测试失败，按确切标题、提交、trace 在新的输出目录重跑。测试运行期间保留相应工作树及 dist。

接下来在 `tests/e2e/work.spec.ts` 的账户/资源流程覆盖持有已开详情时撤销会话、再次打开搜索与下载，以及中断整页移动后重新打开。依 ADR0108/0124 区分已登录所有者、细粒度凭据和设备上保存的离线副本。用 2 个合成主体逐项核对原件和元数据。大文件在 `apps/web/src/features/files/PdfOriginalPreview.tsx`、`packages/file-parsers/src/pdf-page-view.ts` 和应用层取件契约接入可取消的受权分段源；以 evidence/session400/large-pdf.mjs 的 18 MiB 夹具比对首屏、在途请求、内存及下载摘要。其他模块继续按 [§13 验收台账](ACCEPTANCE.md) 和 [问题列表](ISSUES.md) 执行。

# 全产品升级接力 · 当前候选 da0105e

本机记录时间 2026-11-24 00:10 +08:00。项目根目录 D:/Lib/Codex_workplace/ArcLattice，分支 codex/ux-upgrade，生产版本未核证。最新产品代码 da0105e，报告与证据提交可用 `git log -1 -- docs/ux-upgrade/PROGRESS.md` 定位。当前实现、验收缺口和文件清单见 CHECKPOINT-398.md、ACCEPTANCE.md、CHANGES-398.md。以下旧记录按各自时点解读。

|对象|已完成的实测|
|---|---|
|资源、回退与 PDF|批量软删除/恢复、父子顺序与部分失败 6/6，冲突专项 13/13。Web 同一隔离工作区历经 5 阶段恢复；原件摘要、主题与深链保留。真实 PDF 两页颜色核验浏览器 3/3、Windows WebView2 七步。|
|账户（da0105e）|工作区名称、服务器常显，标识及译文可用键盘展开。设置入口和独立工作区切换共 6/6（49.6 秒），记录 account399.log。Web 构建、11 包 typecheck 和本次 lint/边界通过。390 像素深色改前/改后实页图在 evidence/session398/account-*-mobile.png。|
|布局与无障碍（da0105e）|layout-account399.log 在 392 个组合中外层及 main 均无横向溢出，原始结果字节与 evidence/session398/layout-matrix.json 相同。ax-hydrated.log 的 14 个入口 × 两个配置、770 次可操作角色的计算名称检查无缺漏，每页一个 main；明细在 evidence/session398/accessibility.json。|
|完整门禁|较早的完整 pnpm check 为 305/305 文件、1577/1577 测试通过，构建 2/2。较早的全量 Playwright 为 807/807。深色有内容关键任务 30/30。完整范围与各提交的专项分见 KEY-FLOWS-398.md。|

**暂停时还在运行。** 00:10 复核 PID 28360 为 c23c2d3 启动的完整 pnpm check，Vitest 未出最终统计。PID 47288 为 1384986 冻结构建的 pnpm test:e2e，已启动第 262/825 条。请保留这两个进程、宿主及临时输出。它们与 da0105e 的账户专项使用不同的构建目录。应用的其他既有进程也应保留。

**恢复命令与下一步。** 在上述项目根先执行 `git status --short --branch`、`git log -4 --oneline`、`Get-Process -Id 28360,47288 -ErrorAction SilentlyContinue`，读取 `Get-Content .artifacts/ux398/check-c23c2d3.log -Tail 40` 和 `Get-Content .artifacts/ux398/browser-825.log -Tail 40`，记录完成/失败总数。若存在失败，先使用该冻结 dist 和失败的 Playwright 标题定位，保留原 trace。证据目录为 .artifacts/ux398，用户可查阅的材料在 docs/ux-upgrade/evidence。工作树状态以提交后的本机 HANDOFF.md 和现场 Git 为准。

随后核对 packages/application/src/folder-links.ts 的 create/remove、packages/application/src/local-folder-links.ts 的 Outbox 与现有 Receipt，按 ADR0147 确认一个资源可属于多个集合。在 apps/web/src/features/files/FilesWorkspace.tsx 增加明确源/目标的批量整理及对应键盘与指针交互，先为目标失败、源版本已变化、已存在目标关联及中途换账号编写验收；读取原始字节及 Document.spaceId 比对。P0 共享权限以及其他模块的逐项验收继续见 ISSUES.md 与 ACCEPTANCE.md。Android 设备、系统镜像及 emulator 未就绪，发布、签名与生产迁移均未执行。

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

### 批量回收、恢复与 Web 回退

c23c2d3 接入所选笔记、文档、文件的批量软删除和按筛选恢复。先确认确切数量，逐条沿用版本、权限、事务和 Outbox。删除先子后父、恢复先父后子。遇到拒绝或冲突则停止后续操作并显示已确认数量；用户核对刷新内容后重新选择。测试实际让一个独立笔记先成功、含未选子文档的父文档随后被拒绝，再选择整个层级，核对恢复后的 spaceId、parentDocumentId、版本与原文。

混合恢复首次在三种浏览器配置全部失败。追踪发现旧恢复流程为检查所属空间而读取其未加载的 Markdown，另有跨连接后台提交争用工作区 revision。修复用既有元数据读取契约验证归属与删除状态；本机真正中止的工作区级 CAS 按 ADR 0135 限量重启。实体版本冲突继续报告。hierarchy-r3.log 6/6；contend-final.log 13/13，含一次性/持续争用、过期实体版本和 Outbox 效果。batch398.log 原有回收站与实际批操作共 9/9。

浏览器回退演练在全新目录和同一回环地址使用真实基线构建和候选构建。旧版写入包含中文与 CRLF 的原件，复制正式文件引用，依次基线、升级、回退、再次升级、断网重载。5 次下载的文件名、SHA-256、深链和深色主题一致；实际加载的 JS 文件分别核对。结果 evidence/session398/web-upgrade.json。复跑 node scripts/rehearse-ux-web-upgrade.mjs <旧Web目录> <候选Web目录> <新结果目录>。此实验不覆盖数据库主机降级、服务器回退或已签名设备安装包。

本轮较早启动的 pnpm check 已成功完成，305/305 个测试文件，1577/1577 个测试，Vitest 2657.11 秒，构建 2/2。源代码在运行期间有增量，最新各项专项按单独日志签收。c23c2d3 完整 pnpm check 在 .artifacts/ux398/check-c23c2d3.log 复跑。多个版本的独立输出均保留。

### 键盘、目录、性能和原版 PDF

实现 fdc46d3、1384986。键盘首个 Tab 可跳过整个 Shell 导航并保留深链；资源集合路径按真实目录 ID 向上导航并恢复焦点。详情显示创建日期和直接项目。知识空间首页去掉无目标的返回操作，图谱开关暴露展开状态。skip.log 9/9，spaces398.log 9/9，trail.log 6/6。KEY-FLOWS-398.md 逐项列出 §10.2 的 14 项证据。dark-flows.log 的 15 个有内容任务 × 两种配置共 30/30 通过（3.4 分钟）。

PDF 的文本分页之外，现在可以按需打开原版预览。原件走授权读取，只挂载当前页的有界 canvas，关闭时取消并销毁工作线程；16 MiB 输入、1000 页及 15 秒工作预算沿用现有解析限制。两页真实夹具按像素验证了红色首页与蓝色次页，键盘焦点在关闭后回到触发按钮（pdf398.log 3/3）。Windows 独立 Tauri 测试构建 2m54s，实际 WebView2 绘制第二页蓝色图形、PNG 放大与 CSV 预览均成功；1280×840，无横向溢出。截图和记录见 evidence/session398/windows-pdf.png、windows-pdf-webview.json、pdf-original-mobile.png。PDF 大于上限的分段流式原件读取仍开放。

同机 6 对交错 AB/BA 复跑：1000 项首次可见中位数 411.5→396.5 ms，选择 124.5→78 ms；10000 项首次可见 1571.5→1094.5 ms，选择 583→63.5 ms。基线挂载 1000/10000 行，候选两者都为 60 行。每轮使用全新 Chromium 153 配置，1440×900、i5-12500H、Windows 10.0.26300；同期有其他门禁，原始范围及每个样本在 evidence/session398/performance-paired.json。

较早完整 Playwright 807/807，56.6 分钟。当前包含新增用例的全量收集为 825。23:56 最新浏览器 PID 47288，文件 .artifacts/ux398/browser-825.log；以 c23c2d3 开始的完整 pnpm check PID 28360，文件 check-c23c2d3.log。原始浏览器工件及原生隔离 profile 均须保留。1384986 源码另有 pnpm lint、pnpm typecheck、pnpm build、PDF 浏览器与原生专项通过。生产运行版本未重新核证。源码修改均在本地分支。
