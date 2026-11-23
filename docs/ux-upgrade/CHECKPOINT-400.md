# Session 400 · 资源整理、长文阅读、图谱与日历

## 1. 执行摘要

从本地干净的 `codex/ux-upgrade` / `9929884` 恢复。混合资源可在集合间移动，阅读时可跳至同名小节并保留位置，图谱可翻页搜索并定位，日历支持月、周、日和议程，正式原件支持授权后分段下载。全产品开发部分完成，§13 仍有 P0/P1。

## 2. 目标范围

[二十项验收台账](ACCEPTANCE.md)逐项列出已实现、已有证据及待签收内容。[依赖与任务树](BASELINE.md)涵盖品牌、系统组件、Shell、全部业务模块及平台和发布。本轮深化 §5.3–5.6、§5.9、§7、§8、§10 和 §11。项目、专注、AI、通知及平台安装的剩余范围继续保留。

## 3. 品牌与设计系统

沿用现有品牌、双语词汇和主题偏好。集合按钮支持拖放、触控点击和键盘。图谱空间组之前使用缺失变量后的固定亮色，暗色截图暴露了问题。现在按语义表面、文字和边框 token 绘制。手动切换图谱范围后将可操作节点移入视野，单纯输入搜索不会重置画布。日历四种视图复用相同的日期、操作和时区。

## 4. 模块 UX

- **笔记与文档工作区。** 目录来自已经渲染的 Markdown 标题，代码块中的伪标题不计入。同名子标题保留父级路径。跳转将键盘焦点交给目标，打开的标签各自保留正文相对位置，关闭标签即释放。长文夹具实际创建了两篇笔记，经共享的 DocumentWorkspace 验证。
- **知识图谱。** 每页最多 20 个搜索结果，提供总数、分页、空状态和清除。方向键、Home/End、Enter 和 Escape 可用于选择和恢复焦点。选择后打开相应局部图。分组网格仅绘制实际位置。
- **日历。** 四个视图共享所选日期。周跨越月界，议程只列出有内容的日期。闰日创建的任务在当日详情和议程中出现一次。重复实例的状态使用既有翻译。系统后台投递仍按平台单独验证。
- **账户。** 集合列表中可能同时存在笔记、文档和文件的引用。聚合列表和移动路由核对各自所需权限；普通文件元数据和原件字节的读取授权继续分开。

## 5. 资源中心的数据与交互

在源集合选中三种资源，选择目标，再以拖放或键盘/触控按钮确认。取消保持选择与焦点。目标已有成员时保留原目标记录。其它集合、笔记主目录、原件字节、文档 Markdown、版本与 `spaceId` 通过真实浏览器流程比对。批处理中途失败显示已确认数量。60 项整页实测发现旧实现只完成 5 项，120 秒后 55 项仍在原集合。eeef72c 仅在写事务因本地工作区 revision 冲突中止时按既有策略重试。两次实测均移动 30 篇笔记和 30 篇文档，目标列表在约 2.53 秒出现 60 项，服务端在 3.47/3.50 秒内核对全部关联。刷新后数量正确，60 份正文及文档归属未变，第三个集合的关联仍为版本 1。[测量结果](evidence/session400/collection-page.json) · [目标集合](evidence/session400/collection-full-page.png)

## 6. 架构与关键提交

|本地提交|变更|
|---|---|
|92a1c0f|ADR0151、应用服务/事务、SQLite 关联、Outbox 和 Receipt、资源 UI 与原生传输路由|
|fd5e96d|服务端组合授权、历史凭据边界、授权矩阵与合同|
|9e10fd0|默认及自定义 Web 输出附带相同 OpenAPI 文件|
|26e02f1|阅读目录、焦点、标签滚动位置及打印|
|c455891|权限范围内分页搜索，移除非局部图的冗余力计算|
|75b0eea|日历共享日期与四种视图、原有实例状态|
|bdc9d1c|已验证原件的 HTTP 单段响应及恢复下载|
|57cdd9e|修复深色空间组和切换作用域后的节点定位，增加可见中心与计算样式断言|
|1ecf1d9|修复首次激活含 Wiki 关系的账户副本，兼容提示、两种数据库合同及首次同步测试，见 ADR0152|
|db711d7|将本批四个主要流程纳入长期深色浏览器回归|
|eeef72c|整页集合移动遇到与关联无关的本地工作区 revision 竞争时重启已中止的本地事务，保留源和目标版本检查|

逐文件清单见 [CHANGES-400.md](CHANGES-400.md)，可用 `git diff --name-status 9929884..eeef72c` 复核。本报告、各台账及证据另作本地检查点提交。

## 7. 数据库、API 与同步兼容性

沿用既有 schema。移动核对源 CAS 和目标关联的预期状态。SQLite 索引列与序列化记录同事务写入，每个命令产生单一可重放效果。老服务端处理不了新移动写命令。普通 GET 继续提供完整原件，单段 Range 可接收 206，越界区间返回 416，If-Range 强 ETag 不匹配回退为完整响应。历史项目原件沿用旧版本化流程。HTTP 协议依据见 [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-range)。

首次激活带 Wiki 关系的账户副本曾在 `workDelta` 校验处失败。普通图谱快照继续使用原有五个展示字段，首次同步的同工作区清单另附真实已持久化的 ID、版本、工作区和更新时间，与增量变更一致。新版客户端遇到旧式清单时保留原副本并提示更新服务端。更新后可在同一界面重试。已验证未解析链接在目标出现后保持同一记录 ID 并递增版本。

## 8. 性能与环境

Windows 10.0.26300、i5-12500H、Node 24.20.0。非局部 1000 文档、999 边的旧力布局在三次热样本中耗时 791.6–874.8 ms；候选跳过这项计算，分项小于 0.005 ms。此采样排除了 React 绘制与网格布局，不代表整页延迟。500 节点与重跑程序见[分项结果](evidence/session400/graph-measure.json)和[测量脚本](evidence/session400/graph-measure.mjs)。

在相同 Windows 主机、Chromium 153、1280×800 上，通过真实 Host API 建立 1,000 篇文档和 1,000 条环形 Wiki 关系，首次激活独立账户副本并打开完整应用。两版 Web 均配合已修复的 Host，排除旧 Host 无法激活副本对比较的干扰。从点击切换全工作区到全部 1,000 个文档节点存在且经过两次绘制帧，三次测量的中位数从 1,682 ms 降至 882 ms。输入精确标题到匹配可见的中位数从 755 ms 降至 161 ms。先测候选再测旧 Web；本机同时执行其他回归。这些是同机样本，仍需低端设备测量。[旧 Web 原始数据](evidence/session400/graph-r3-web.json) · [候选原始数据](evidence/session400/graph-wiki-web.json) · [可复现流程](evidence/session400/graph-workspace.bench.ts)。

Chromium 中，120086 字符、36 个标题，从切换到阅读直到目录可用的单次样本为英文桌面 417 ms、中文桌面 387 ms、中文移动配置 486 ms。正文目标切换前后的顶部坐标分别保持在 64.28125、64.28125、64.1875 CSS px。详见[原始结果](evidence/session400/reading-measure.json)。设备软键盘、真实低端内存及屏幕阅读器仍开放。

超出解析阈值的离线 PDF 使用有效单页、18,874,810 字节的磁盘夹具。文件选择至详情可下载耗时 1,365 ms，至原件下载并复核 SHA-256 共 2,549 ms。详情未显示原版页预览。Chromium 主渲染线程 backing storage 从 3,127,023 增至最高 72,079,183 字节，125 ms 间隔共 21 个样本；未测完整进程和 GPU 内存。预览首屏、取消和在线 Range 请求待接入后复测。[脚本](evidence/session400/large-pdf.mjs) · [采样](evidence/session400/large-pdf.json) · [详情页](evidence/session400/large-pdf.png)

## 9. 自动化测试

原始日志位于本机 `.artifacts/ux400/`。除专门说明的 Windows 原生项外，移动配置指浏览器仿真。

|运行|结果|
|---|---|
|92a1c0f · `pnpm check`|307/307 文件、1585/1585 测试，Vitest 738.18 秒，构建 2/2。|
|移动/旧账户/目录 · `r3-flows.log`|9/9。Host 与本地移动专项 10 项被执行，123 项由过滤器排除。|
|授权 · `grants.log`|5 项执行通过，120 项被过滤。|
|阅读、图谱、日历|reading-final 3/3；graph-search 9/9；calendar-period 12/12。部分运行重验了相同流程。|
|原件续传|range-host 2 项通过，range-chunks 1 项通过，range-openapi 15/15；包括五块上传、以两段 GET 恢复并比对 SHA-256。|
|57cdd9e · 真实浏览器交互|viewport 9/9，dark-57cdd9e 8/8。Biome、架构边界、11 包及根类型检查、两项默认构建通过。|
|bdc9d1c · `pnpm check`|307/307 文件、1587/1587 测试，Vitest 725.15 秒，构建 2/2。|
|57cdd9e · 原生 Windows|使用独立标识和全新 WebView2 数据目录，无签名夹具编译 11 分 9 秒。真实 Edg 158.0.4370.33，1280×840，经键盘/按钮与日期控件通过四个日历步骤。|
|57cdd9e · 响应式|392 个“入口 × 宽度 × 明暗 × 密度”组合均未观察到页面或主区域横向溢出，见 [JSON](evidence/session400/layout-matrix.json)。|
|Android JVM · 真实重跑|`:app:testArm64DebugUnitTest --rerun -x :app:rustBuildArm64Debug` 离线运行 46 秒；NotificationPolicy 4/4、UpdatePolicy 3/3，XML 的错误、失败、跳过均为 0。日志 `android-jvm.log`。|
|Android ARM64 · 原生库|NDK 26.1、API 24，离线锁定依赖构建耗时 7 分 5 秒。ELF64/AArch64 及 JNI 入口已复核，编译器 5 条警告；当前无连接设备、无本机模拟器镜像。[产物摘要与入口](evidence/session400/android-arm64.json) · [设备盘点](evidence/session400/android-inventory.json)。|
|Rust GNU 无签名 release 模式测试|32 通过、5 忽略。调试链接及缺少清单的首次尝试保留日志。|
|db711d7 · 强制配色与减少动态效果|同时开启两项系统偏好，跳至主内容、混合移动、长文跳转、图谱查找、闰日日历和账户激活六条流程在三个配置下均通过，18/18（2.1 分钟）。人工读屏和逐控件对比度待测。|
|92a1c0f · 全量浏览器|828/828，通过，56.9 分钟。|
|57cdd9e · 全量 check|307/307 文件、1587/1587，Vitest 701.10 秒，构建 2/2。|
|db711d7 · 全量 check|307/307 文件、1588/1588 测试，Vitest 793.60 秒，构建 2/2。原首次检查因证据文件格式停止，修正后完成。|
|eeef72c · 整页移动|两次独立启动的全页移动 2/2；文件事务竞争及集合服务/重放合同共 14/14。|
|db711d7 · 持续深色回归|`pnpm exec playwright test -c tests/ux-dark.playwright.ts --workers=1`，38/38 通过，3.9 分钟。|
|1ecf1d9 · Wiki 首次激活与兼容|SQLite、PostgreSQL 和 Host 合同 4 项通过（124 项被过滤），IDB 修复与 OpenAPI 共 21/21。真实浏览器中模拟旧清单、保持待连接状态、升级后重试、未解析关系后续解析，3/3 通过。|
|bdc9d1c · 无障碍树与恢复|14 个路由 × 2 配置，0 个缺少名称或主区域错误；5 阶段 Web 升级/回滚保留深链、主题与原件摘要。|

可复现命令（Windows 本地隔离工作区，输出目录每次取新名）。具体用例标题、参数与样本在各日志和 benchmark 脚本内。

```powershell
pnpm --filter @arclattice/web exec vite build --outDir ../../.artifacts/ux400/review-web
$env:NO_PROXY='localhost,127.0.0.1,::1'
$env:ATLAS_UI_FIXTURE_DIST=(Resolve-Path .artifacts/ux400/review-web).Path
$env:ATLAS_E2E_BASE_PORT='25820'
pnpm exec playwright test tests/e2e/work.spec.ts --grep 'moves a mixed collection|first activation of an indexed Wiki|long Markdown contents|graph search bounds|calendar week day and agenda' --workers=1 --output .artifacts/ux400/review-flows
pnpm exec playwright test -c tests/ux-dark.playwright.ts --workers=1 --output .artifacts/ux400/review-dark
pnpm exec vitest run packages/storage-sqlite/src/wiki-target-version.test.ts packages/storage-postgres/src/wiki-target-version.test.ts packages/storage-local/src/workspace-bootstrap-repair.test.ts packages/host/src/openapi.test.ts
pnpm exec vitest run packages/host/src/server.test.ts -t 'clean Wiki link identities|workspace bootstrap carries|verified download resumes|first-class File binary chunks resume|authenticated Host extraction uses the real'
node docs/ux-upgrade/evidence/session400/large-pdf.mjs .artifacts/ux400/review-web .artifacts/ux400/review-large-pdf
pnpm exec playwright test -c docs/ux-upgrade/evidence/session400/assistive.config.ts --workers=1 --output .artifacts/ux400/review-assistive
pnpm exec playwright test -c docs/ux-upgrade/evidence/session400/collection-page.config.ts --repeat-each 2 --workers=1 --output .artifacts/ux400/review-collection-page
$env:ATLAS_GRAPH_DIST=$env:ATLAS_UI_FIXTURE_DIST
pnpm exec playwright test -c docs/ux-upgrade/evidence/session400/graph-workspace.config.ts --output .artifacts/ux400/review-graph
node scripts/measure-ux-layout.mjs .artifacts/ux400/review-web .artifacts/ux400/review-layout
node scripts/audit-workspace-accessibility.mjs .artifacts/ux400/review-web .artifacts/ux400/review-ax
```

完整套件的终态和恢复命令见[运行台账](PROGRESS.md)。此前 1384986 前端的 825 项浏览器回归有 823 项通过和 2 项失败，测试源码在运行中更新；400 起使用独立工作树和冻结产物。旧失败及修正过程中失败的断言保留在原始日志中。

## 10. 交互截图

|实际界面|证据|
|---|---|
|桌面资源与窄屏源集合|[三种资料选中](evidence/session400/selection-desktop.png) · [手机选择目标](evidence/session400/selection-mobile.png) · [重新打开的目标集合](evidence/session400/moved-desktop.png)|
|共享 Markdown 阅读器|[桌面](evidence/session400/reading-desktop.png) · [中文窄屏](evidence/session400/reading-mobile.png) · [深色窄屏](evidence/session400/reading-dark-mobile.png)|
|知识图谱|[分页结果](evidence/session400/graph-mobile.png) · [修正前的亮色分组](evidence/session400/graph-dark-desktop.png) · [修正后的桌面](evidence/session400/graph-fit-desktop-en.png) · [修正后的手机](evidence/session400/graph-fit-mobile-zh.png)|
|Windows 原生闰日议程|[实窗](evidence/session400/windows-calendar.png) · [运行记录](evidence/session400/windows-calendar.json) · [可复现脚本](evidence/session400/windows-calendar.mjs)|
|闰日议程|[浅色](evidence/session400/calendar-mobile.png) · [深色](evidence/session400/calendar-dark-mobile.png)|

## 11. 发布、迁移、备份与回滚

[未发布变更说明](../../CHANGELOG.md)涵盖用户可见变化和先升级 Host 的兼容要求。[运行手册](RELEASE-READINESS.md)记录先升级服务端、保全待同步命令与回执、恢复隔离副本及评估回退的顺序。[本轮 Web 五阶段结果](evidence/session400/web-upgrade.json)和[无障碍检查](evidence/session400/accessibility.json)可直接读取。未部署生产、推送、迁移生产数据、签名或发布。

## 12. 未完成项和已知风险

共享委派/撤权后的界面、大于 16 MiB 的 PDF 按需预览、全组件 WCAG 状态、Android 真机、Windows 安装升级、辅助技术人工验收以及其他模块 §13 缺口见[问题台账](ISSUES.md)。HTTP 续传节省网络传输量，原件服务仍执行完整哈希校验。分页图谱的真实低端整页渲染、移动时中断或撤销会话后的重试体验亦待测。浏览器仿真不计入 Android 真机。

## 13. 运维日常影响

对新增命令采用同命令 ID 的回执恢复流程。细粒度客户端需要同时满足其聚合读取权限，出现 403 时核对授权来源。原件取回可按强 ETag 安全续传，普通客户端无需新增请求头。2026-11-24 02:30 +08:00，GitHub 远端 HEAD 和 main 同为 `0f0595a`；线上运行版本及运维备份恢复效果本轮未核实。
