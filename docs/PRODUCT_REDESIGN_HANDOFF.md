# Orivane Atlas 产品与 UI 改造：多 Agent 当前执行基线

更新：2026-10-28（Session318 发布 3.0.3）。适用范围：Session299–318 后续改造。最新用户请求优先；本文负责组织已授权工作，不新增发布或生产操作授权。

最新状态优先于下方历史检查点：阶段A/B及Session314/317体验收尾已有实现；当前源码完整check 1527 passed/1 skipped、三配置浏览器738/738通过；Native Windows/Android 3.0.3已构建并发布到 GitHub Release v3.0.3。阶段C性能仍无14/14：controlled-r1仅13/14（Atlas列表+10.24%），当前源码低负载重跑仍7/14失败且批次不稳定；已在3.0.3发布说明标注，不能宣称性能通过。人工设备门槛与用户视觉签收未完成。具体见PROJECT_STATUS顶部、HANDOFF Session318/317。

## 1. 接手顺序与事实来源

1. 读仓库 AGENTS.md、HANDOFF.md 顶部、PROJECT_STATUS.md 顶部，再读本文。
2. 核对 git status、git diff 和正在运行的本项目进程。未提交文件是共同成果，不是可丢弃文件。
3. 读本轮相关 ADR0138–0146、ARCHITECTURE.md 和所涉及应用契约。
4. 在 HANDOFF 工作认领区记录 agent、模块/文件、阶段和验证计划。有同文件重叠先协调；没有冲突就直接推进。
5. 完成一个可复核检查点后更新本文状态、HANDOFF、PROJECT_STATUS，新增不可变 Session Record，并释放认领。

当前主线 HEAD 为 `2fcf9a5fd087ffbeed1e946c3b2a1b5290cda9a8`；Session299–314 的新成果尚未提交。Session315接手核对有122项dirty/untracked，数量只是检查点，接手必须实查。

唯一仓库：`D:\Lib\Codex_workplace\ArcLattice`。v3.0.2 是此前已发布版本；当前新构建仍使用该版本号，属于本地候选，不代表 GitHub Release 已更新。

事实优先级：用户最新要求 > 实际源码与可复核工件 > 当前状态摘要 > 历史会话结论。本文之后发生的新修改需更新记录；旧 PASS 不覆盖后续变化。

## 1.5 阶段A检查点（2026-10-27，DSH-Lead）

状态：阶段A视觉基准与共享组件已完成可复核检查点，阶段B待继续；当前树完整验收仍属阶段C。

- 共享基准：tokens/themes 统一中性冷灰/柔白、克制蓝紫、浅暗色板、圆角/阴影/字体；Dialog/Popover/Atlas Float/Sheet 统一玻璃组合与透明度/强制色/移动端回退；Sidebar 磨砂、上下文带、导航与控件密度收敛。
- 四屏基准：文件页 `FilesWorkspace` 统一 NOTE/DOCUMENT/FILE 浏览（类型页签/排序/上传，文件夹仅组织笔记，移动端资源优先）；文档页内容卡+稳定阅读列+选区定位自动工具栏；Atlas 主卡/标题/composer；设置/账户 API 收紧分组、字段与按钮。
- 证据：`.artifacts/session312-visual/{desktop-zh,desktop-en,mobile-zh}`；定向 Playwright：notification-center 6/6、file-atlas 1/1、设置账户层级 3/3、files/folder 三配置、Atlas 主界面/分页历史、文档富内容三配置；`pnpm lint` 971 文件 + boundaries、typecheck、build、diff-check 通过。
- 未完成：阶段B继续收敛文件页与既有入口、Atlas/设置细节、共享组件推广；当前树完整 check/全量浏览器、受影响 Native/性能、真机与最终视觉签收未做。不可变记录：`docs/sessions/2026-10-27-312-visual-baseline-and-components.md`。

## 1.6 阶段B检查点（2026-10-27，DSH-Lead）

状态：阶段B主工作流收敛已落地，全量 Playwright 738/738 与当前树 check 已通过；Session314 继续设置/Atlas 体验收尾、Markdown reconnect 根因核查、当前前端 Native/性能与最终验收。

- 笔记/日记：NoteBrowser 外层统一资源卡；笔记列表和日记年/月/周/日分组保持可折叠；移动端列表优先、文件夹栏下置、工具条换行。
- 项目移动页：概览 section 统一卡片，tab 改为下划线页签，标题/状态/生命周期胶囊与工具栏排布紧凑；空“现在”section 隐藏，brief 编辑器移动端高度收紧，时间线/最近活动保持可折叠。
- Atlas：composer 模型/上下文/发送次级控件密度收敛；文件页页头不再重复计数。
- 验证：当前树 `pnpm check` 通过（293 passed/1 skipped 文件；1527 passed/1 skipped 测试；lint 971 文件 + boundaries/typecheck/build/diff-check；首次 PG 连接超时后重跑通过）；notes/journal/project 桌面+移动定向、file-atlas 工具栏、v2.3 light/dark 视觉矩阵通过；首次全量 738 Playwright 724 passed/14 failed，14 个已修复且受影响 6 测试×3 配置重跑 18/18；**修复后全量 738/738 passed（56.3m）**。
- 未完成：全量浏览器最终结果/失败修复、设置移动长页与 Atlas 次级层级、Native/性能与真机签收。不可变记录：`docs/sessions/2026-10-27-313-phase-b-workflow-and-current-tree-check.md`。

## 1.7 Session314 体验收尾与最终门槛（2026-10-27，DSH-Lead）

状态：阶段 A/B 及体验收尾完成；阶段 C 功能/Native 通过，性能未通过，Session316 继续诊断。

- 设置移动端高级分组（仅自定义导航/高级关系）+ 常用项保持可达；英文导航换行修复了布局视口溢出导致的底部导航不可点；主题/语言去重、通知两列。
- Atlas 上下文前置、模型/发送同排，浮窗 composer 与主界面统一；项目空 brief/空活动清理。
- Markdown reconnect：测试输入 `fill()` 重复（Session304 同类）改为 click→Ctrl+A→insertText，repeat 3/3；trace 已被清理，保留不确定性，不改产品合并路径。
- 验证：app 源码 check 1527/1skip、三配置浏览器 738/738、Native Rust 30/5 ignored、真实 Transport 1/1、Windows NSIS exit0、Android arm64/JVM/v2-v3 签名/原证书/图标 exit0。
- 未通过：正式性能 r6 完整 20 样本仅 6/14，8 项超 10% 预算；失败/污染批次全部保留。Session316 继续虚拟列表性能诊断；不能宣称阶段 C 完成。真机与视觉签收 MANUAL OUTSTANDING。不可变记录：`docs/sessions/2026-10-27-314-ux-closeout-native-performance.md`。

## 1.8 Session317 接手收口（2026-10-28，DSH-Lead）

- 回退 Session316 未通过正式性能的 `AssistantPane` 空查询/Atlas overscan 与 `VirtualTaskCollection` overscan 试验，保留稳定虚拟列表行为。
- 修复移动端 close-flush 测试的 CodeMirror `fill()` 追加：click→Ctrl+A→insertText，repeat 3/3；未改产品合并路径。
- 当前源码：`pnpm check` 1527 passed/1 skipped、三配置浏览器 738/738（53.8m）。
- 性能：controlled-r1 13/14（仅 Atlas list +10.24%）；当前源码 Node24.20 低负载重跑仍 7/14 且批次不稳定，未通过；失败/污染批次全部保留。
- Native：Session314 的 Rust/Transport/Windows/Android 证据通过；本轮无 Rust/Tauri 改动，若需字节一致当前 dist 需重打包。
- 真机与视觉签收仍 MANUAL OUTSTANDING；未提交/发布/部署。不可变记录：`docs/sessions/2026-10-28-317-final-current-source-acceptance.md`。

## 2. 用户目标与实现状态

“已实现”指有代码；“已验证”必须说明范围；“体验待完成”不能用功能存在或测试成功代替。

| 原始项 | 目标 | 当前状态与剩余工作 |
|---|---|---|
| 1 | 笔记文件夹、新建和分类展示 | 稳定 ID、层级、创建、重命名、移动、图标、旧分组转换、导入回放已实现；Session310 补删除恢复并验证。Document/File 仍用各自父级关系，尚未统一目录体验。 |
| 2 | 自动工具栏美观、有图标 | 阶段A：选区定位浮层（AUTO）、PINNED 内联、HIDDEN 保留，命令图标与玻璃一致；待用户审美签收。 |
| 3 | 毛玻璃、现代配色、减少卡片堆叠 | 阶段A已统一 tokens、玻璃材质、Shell/Sidebar/上下文带与四屏；后续页面推广和最终视觉签收未完成。 |
| 4 | 图片缩放拖拽及加载提速 | ImageViewer 与缓存授权复核已实现，浏览器解码/重开/缩放通过；真实远端大图速度、Android 双指需另验。 |
| 5 | 锁定工作区语义明确 | 已核对原行为为 logout，改为退出登录和真实说明；未引入数据加密锁。 |
| 6 | Atlas 主界面和浮窗美观 | Session312–314已统一主界面/浮窗材质和composer，上下文在输入区上方、模型与发送在底部；定向及完整浏览器验证通过，用户视觉签收待完成。 |
| 7 | 专门文件管理，围绕文档/文件夹/项目/任务 | 阶段A：`FilesWorkspace` 已统一真实 NOTE/DOCUMENT/FILE 浏览、类型/排序/上传与移动端优先；Document/File 成员关系仍保留各自模型，不强制迁移。 |
| 8 | 设置、账户、API 排版 | 设置分组、账户/API页签和控件密度已收敛；Session314补移动高级设置折叠及长标签换行，修复导航溢出；完整浏览器验证通过，真实设备待验。 |
| 9 | 未命名笔记正文自动保存 | Note 首次从正文首行生成初始标题，保存/重开验证通过；Document 原有可空标题语义保留。真实手机 IME 待验。 |
| 10 | 整体 UI 接近现代 Web/Claude/Codex 工作区 | 阶段A四屏及阶段B主工作流收敛已落地，亮暗/中英/大小屏已有浏览器证据；最终用户视觉未签收。 |
| 11 | 主动保存/Ctrl+S | 保存按钮、Ctrl/Cmd+S 已实现并验证，复用同一保存流程。 |
| 12 | 目标服务器连通性测试 | 已实现只读 health/session 探测、耗时和失败类别；浏览器通过。 |
| 13 | 单个任务计时器 | 起停/暂停/继续、时间戳持久化与重开通过；休眠、跨设备实际体验未验，不称分布式计时器完成。 |
| 14 | Task 截止到分钟 | TaskEditor、持久化、工作区时区、通知和日历已实现并验证；旧 date-only 语义保留。扩展到 Project/Milestone 不是本轮硬性完成条件。 |
| 15 | 手机项目栏过高 | 已压缩并有浏览器截图证据；最终移动视觉回归仍需覆盖。 |
| 16 | 全站 UI 与交互提升 | 阶段A/B及Session314收尾已有源码和738/738浏览器证据；性能验收状态见顶部，真机及用户视觉签收未完成。 |

之前要求的笔记列表/小中大图标、日记年/月/周/日分组已有实现，接手保留并在新布局中核对，不重复造一套视图系统。

文件夹拖拽排序、跨工作区移动、自定义图片图标等扩展不自动升级为发布阻断项。统一资源体验也不等于必须把所有实体迁移成一个新模型：先确定可用的信息架构，确有数据模型需求才写 ADR/迁移。

## 3. 已明确的视觉方向

目标：现代 Web 应用与桌面工作区质感，Quiet / Clear / Dense / Direct / Distinct。用户明确希望毛玻璃，不能只交付平面灰底或改几个圆角。

### 材质和色彩

- Shell：侧栏、顶部导航、Atlas 浮窗、菜单、Sheet、Dialog 使用统一半透明材质、背景模糊、细边缘与轻阴影，体现层级。
- 内容：正文、公式、图片和密集列表采用稳定清晰的底色。避免透明叠透明、卡片套卡片及长文档大面积玻璃。
- 色板：中性冷灰/柔白基底，克制蓝紫强调；深色使用有层次的中性暗色。状态色只表达状态。
- 统一正文/标题/元数据层级、行高、间距、圆角、边框、图标和焦点样式；优先复用/整理 tokens 和组件，避免继续追加互相覆盖的 CSS。
- Windows 品牌 PNG 保持原比例；手机不照搬桌面侧栏和操作密度。
- 透明度降低、强制色、减少动态效果采用可读回退；不要为这些添加不必要的通用防御框架。

### 四个可运行视觉基准

| 页面 | 用真实内容证明什么 |
|---|---|
| 文件 | 多层文件夹、长中英文标题、Note/Document/图片/PDF等资源；紧凑对齐、搜索筛选清晰、单击打开；不靠空白页面证明布局好看。 |
| 文档 | 长 Markdown、数学公式、图文混排、空文档和局部图片错误；正文为主体，保存状态和工具栏不挤占内容。 |
| Atlas | 有历史会话和长回复的主视图、编辑上下文浮窗；输入区/上下文/模型设置层级清楚，不堆叠无关卡片。 |
| 设置/账户/API | 分组能直接找到选项；字段对齐、说明简洁、主次按钮一致；避免整页巨大按钮和重复标题。 |

先在应用中实现这四屏并实看中英文、浅暗色、桌面及手机截图，再推广 Tasks、Projects、Journal、Calendar、Graph/Gantt、Overview、Inspector 和通用浮层。无需每一屏再次向用户询问是否继续。用户审美意见可以继续调整，不能伪称已获视觉签收。

## 4. 剩余执行阶段与完成标准

### A. 视觉基准及组件收敛（Session312 检查点完成）

整理共享色彩、材质、排版和控件；实现上述四屏。保留既有功能，完成真实内容下的视觉检查和关键键盘/触控操作。交付实际源码和截图，不只交付设计说明。

当前状态：tokens/controls/glass/shell 与四屏已实现并留下中英/浅暗/桌面移动截图；选区自动工具栏改为浮层。Session313/314已继续修正四屏细节，最终用户视觉签收仍未完成。

### B. 信息架构与主工作流收敛

文件页统一浏览和操作层级；消除 WorkspaceResources 与笔记区域的重复控制及不必要留白。完善 Atlas/工具栏、设置与账户、移动项目页；推广共享组件。涉及成员关系/API 的变更再按仓库要求补 ADR、OpenAPI、事务及迁移验证。

当前状态：文件页已改为单一 `FilesWorkspace` 资源浏览器（文件夹仅组织笔记，Document/File 保持现有成员关系）；Session313/314已完成笔记/日记、移动项目、Atlas上下文/模型/浮窗和移动设置分组收尾，有实际浏览器证据。不要重新从四屏设计起步；后续只针对明确问题调整。

### C. 修改稳定后的自动化验收

开发中使用针对真实行为的定向测试；可逆样式调整以截图和实际交互验证为主。阶段稳定后运行当前树完整 check 与三配置浏览器、受影响 Native 和性能验收。不要在马上继续改视觉时反复全量重跑，也不要修改重试/超时来掩盖失败。

当前树Session314完整check为1527 passed/1 skipped，完整浏览器738/738，独立Native Transport 1/1，Windows/Android构建与签名验证通过，Session315已复核包哈希。正式性能仍未通过（r6为6/14）；Session316在相同代码上做受控环境验证，原样/containment交替比较未显示稳定收益，未采用该CSS。后续源码变化再按影响验证，不能重复引用旧PASS覆盖新代码，也不用重复未受影响的全量检查。

### D. 真机与交付边界

Windows Cold-start Toast Click；原设备升级项目/图片；Android Physical Notification、系统栏/cutout/IME/横竖屏/底部手势/双指继续标记 MANUAL OUTSTANDING。没有设备就完成其余可自动化工作并如实记录，浏览器模拟不能替代真机。

本轮不自动 push/tag/发布或部署。此前 v3.0.2 发布授权已用于旧发布，不将其套用于新生产迁移。生产操作前读 DEPLOYMENT.md，按最终明确授权执行。

## 5. 可复核证据及覆盖边界

路径均相对仓库，旧失败工件不得覆盖。

| 范围 | 实际结果 | 证据 |
|---|---|---|
| Session312 共享视觉/四屏 | 定向用例通过；亮暗/中英/移动截图 | `.artifacts/session312-visual/`、`.artifacts/session312-*.log` |
| Session309 完整质量 | 1526 passed / 1 skipped；当时 Native Transport 被跳过 | `.artifacts/session309-check-final.log` |
| Session309 完整浏览器 | 735/735，47.4m；只覆盖当时源码 | `.artifacts/session309-e2e-full-r2.log` |
| Session310 Folder 应用/回放 | 13/13 | `.artifacts/session310-folders.log` |
| Session310 恢复、资源上传打开 | 三配置 6/6，36.7s | `.artifacts/session310-final-browser.log`、同名目录截图 |
| Session310 Typecheck/Lint/Build | 通过 | `session310-full-typecheck.log`、`session310-lint.log`、`session310-build-r3.log`（均在.artifacts） |
| Rust | 30 passed / 5 ignored；不等同全部原生人工项通过 | `.artifacts/session310-rust-r2.log` |
| 真实宿主 Native Transport | 1/1，不再 skip | `.artifacts/session310-native-transport.log` |
| Windows NSIS | exit 0 | `.artifacts/session310-windows-build.log`、`session310-windows-build-exit.txt` |
| Android arm64/JVM/签名/图标 | exit 0，沿用原证书 | `.artifacts/session310-android-build.log` 及 `session310-release-*` |
| 正式性能 | 20样本、14/14；704文件无漂移 | `.artifacts/session290-session310-formal-r1-comparison.json`、`-integrity.json` |

原始失败：`session310-rust.log`（缺测试manifest启动失败）；`session310-resources-browser*`首轮（测试文档缺Space，400）；旧R9/R10及其余失败工件保持。修复后的成功不能删除这些证据。

Native 环境不是缺失：现有工具在 F 盘。准确环境配置见 `.artifacts/session310-native-performance.ps1`、`session310-android-validation.ps1`。GNU Windows lib测试需 `ATLAS_NATIVE_TEST_MANIFEST=1`；Native Transport需正确设置 `ATLAS_NATIVE_TEST_EXE`。不得输出签名凭据。旧脚本含历史输出路径，禁止原样重跑覆盖工件；复制为新的会话前缀后检查再执行。

Session310 runner状态为 AUTOMATION_PASSED；旧“WINDOWS_BUILD进行中”、PID和工具session不是当前活动声明。接手检查实际进程再决定是否启动。正式性能期间禁止改源码、重建dist或并行重型测试。

## 6. 多 Agent 续接规则

- 当前文档整理结束后无代码模块由本次文档会话继续占用。下一位 agent 可认领阶段A；其他正在执行的 agent 以 HANDOFF 最新认领为准。
- 不自行创建新任务/子代理或第二工作树。用户可能交替使用 Codex/dsh；同一工作树串行修改优先。
- 认领格式：`agent / 时间 / 模块与具体文件 / 当前阶段 / 验证范围 / 运行进程与日志 / 下一步`。
- 修改共享文件（尤其App.tsx、bootstrap.ts、tokens及全局CSS）前核对新diff；不重写他人未提交成果。
- 保持 UI→Application→Domain/Ports→Adapters；不以绕过权限、CAS、Revision、事务、Outbox/ACK、私有内容隔离解决UI问题。
- 所有数据安全边界保持：不清库、不清用户缓存、不删未跟踪文件、不reset/clean，不把fixture写到真实用户库。
- 每次交接写清“源码已实现 / 自动化通过 / 真机未验 / 未开始”，附命令、工件、失败及下一步。测试数量不得相加制造新全量结论。
- 交接不以“继续吗”结束。已授权的非破坏性实现继续推进；真正依赖设备或不可逆生产操作的事项单列。

## 7. 可复制的下一位 Agent 入口

> 在唯一工作树 D:\Lib\Codex_workplace\ArcLattice 接续。先读 AGENTS、HANDOFF/PROJECT_STATUS 顶部和本文，核对dirty diff与进程，保留Session299以来全部成果。当前A/B已落地、完整功能与Native验证已有证据，主要剩阶段C性能收口和阶段D真实设备验收。先读取Session316最新受控比较及正式结果，不能重做四屏设计，也不能重复跑同一源码取绿。明确采样环境与并发进程，凭热点和受控比较决定最小改动，不添加过度防御代码或纯样式保护测试。保留全部失败证据，不操作生产，不擅自发布；更新交接和不可变会话记录。
