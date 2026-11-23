# 总纲 §10.2 真实任务复验 · Session 398

本轮第一个全量 Playwright 运行收集 807 个用例，全部通过，耗时 56.6 分钟。它早于本轮最后几次实现提交。表内的专项结果来自各自冻结的构建。英文桌面 1280×800 与中文手机 390×844 的深色专项由 tests/ux-dark.playwright.ts 运行 30 项，全部通过。普通浏览器配置另含中文桌面。截图路径在 docs/ux-upgrade/evidence/session398，本地全量原始报告在 .artifacts/ux398。所有工作区均为测试夹具。

|§10.2|执行动作与证据|本轮可确认的范围|
|---|---|---|
|1 新用户与导航|空工作区总览 → 浏览资源 → 导入 → 再次进入总览 → 键盘打开原件。overview.log 3/3。skip.log 9/9 包含强制色、减少动效下首次 Tab 跳到主内容，保留当前深链。|初次进入的可操作路径已验证。尚无外部用户的理解度研究。|
|2 项目与资源|全量用例 project linked folders can be created and persist after reload、project settings preserve brief and task fields；后者在深色专项亦通过。|持久化项目和材料关联；项目批量生命周期尚未完整签收。|
|3 多级文件夹|note folders keep stable identity through nesting, rename, offline replay and reload；trail.log 验证可从下级集合向上导航，焦点返回目录选择器。|笔记文件夹生命周期与通用集合路径。跨目标混合资源批量移动待实现。|
|4 上传及失败处理|397 已测多文件队列失败重试。398 以独立原件上传图片、PDF、CSV 并核对视图，pdf398.log 3/3，Windows 实机另见原生证据。|多选上传、原件、指定格式和失败重试均有分项证据。|
|5 搜索和预览|同名异内容文件、跨账号深链和不同正文；PDF 用两个色块核对分页，CSV 源文本/表格、PNG 放大、重复文件。bookmarks.log、pdf398.log、duplicates.log 各 3/3。|原件读取经过授权入口。目前 PDF 图形预览上限 16 MiB，读取完整本地 Blob 后按页绘制。|
|6 关联项目与空间|resource collections show scoped paths and preserve the document when its link is removed；核对解除集合关联后原 id、spaceId、Markdown 与存活状态。|通用关联不改正式归属；直接项目与集合传递的项目在详情中分开展示。|
|7 批处理|批量回收 → 取消 → 确认 → 在回收站筛选并恢复；故意留下未选子文档，验证部分成功计数，然后恢复父子关系与正确版本。hierarchy-r3.log 6/6。|覆盖软删除、恢复、收藏；跨集合批量移动仍开放。|
|8 Markdown 历史|全量与深色均通过 notes, safe reading, revision restore, journal and export。全量亦覆盖离线草稿、跨标签更新、冲突合并与保留两个原件的选择。|创建、编辑、保存、历史和恢复路径。超长文档的低端设备预算仍待签收。|
|9 任务、日期与撤销|quick completion and restore arm without mutation and support cancellation and version-safe Undo；task due minute keeps date-only work unchanged and clears with the date。|桌面、手机均有实际回归；完成和撤销另有深色结果。|
|10 提醒与跳过|重复跳过与错过的差异、实例/系列、提醒完成和解除。全量执行 v2.2 recurrence skip、formal reminders create edit complete dismiss；前者在深色复验。|应用内提醒语义；真实 Android 通知许可、锁屏与后台恢复未验证。|
|11 离线、重连|two independent sessions sync updates without replacing an open draft；全量另测断网重新启动、分块原件重传和版本化 Outbox。Web 回退演练含再次升级后断网重开。|临时账号、离线工作区和分开运行的主机；生产文件及真实数据未参与。|
|12 账户与工作区|两独立账号、同名异字节文件、登出/撤销、深链和本机收藏，另有独立所有者工作区及 API grant 回归。|现行账号与工作区所有权合同。共享工作区逐对象委派与撤权仍须依据适用模型核对。|
|13 窄屏与手机|392 个空工作区布局组合；有内容的资源详情、图谱入口、文件夹、表格与日记在移动 Chromium 实际操作。|仿真窄屏、触摸和桌面均有证据；Android 实机尚缺。|
|14 深色工作流|dark-flows.log 完整 30/30，含项目、文件、账号、Markdown、图谱、任务、日记、提醒、AI 审批和恢复。|指定 15 个场景×两种配置；尚未覆盖所有可能的组件状态及真人读屏。|

## 复跑

在仓库根目录，先构建 Web 并为测试保留独立 dist。用 ATLAS_UI_FIXTURE_DIST 指向构建目录，用 ATLAS_E2E_BASE_PORT 指定空闲起始端口。pnpm exec playwright test --config tests/ux-dark.playwright.ts --workers=1 复跑深色组合；pnpm test:e2e 运行仓库全量。Playwright 的 --output 选择新的本地输出目录。详细门禁与已有进程见 PROGRESS.md。

无障碍名称复验命令为 `node scripts/audit-workspace-accessibility.mjs .artifacts/ux398/account399-web .artifacts/ux398/ax-next`。脚本要求新的输出目录，逐路由读取 Chromium 无障碍树；已完成的数据见 evidence/session398/accessibility.json。
