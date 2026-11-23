# Session 398 · 资源、日记和本地副本

2026-11-23。起点 722f929，codex/ux-upgrade，本地工作树起初干净。实现提交 97ea5e5、29bcf60、9cfb317。本轮是总纲 §14 的阶段交接，全产品 §13 门禁仍开放。

1. **摘要。** 实现本机收藏、最近打开、批量收藏、集合关系、文件预览和日记日期导航。修复旧副本缺少文件夹关联、上传后预览和移动文件夹抽屉阻挡编辑器的问题。
2. **模块范围。** 本轮证据集中于 §5.3、§5.4、§7 和 §10。完整二十项状态以 ACCEPTANCE.md 为准；业务模块测试通过与完整 UX 验收分别记录。
3. **品牌与设计。** 沿用 397 的品牌和主题。集合路径、批选状态、图片与表格预览使用共享样式。检查了中英文桌面、手机与真实 WebView2 截图。
4. **业务体验。** 可按工作区日期打开日记；使用闰日夹具核对没有重复创建和覆盖。笔记/日记搜索为空时可以清除搜索。总览可继续打开最近资源，移入回收站后不再显示。裸图谱路由提供知识空间与项目两个入口。窄屏从文件夹创建笔记后抽屉会关闭，文件夹可以归档和恢复。
5. **资源交互。** 最近打开按访问顺序列出上限 40 个类型化引用；收藏、列表与网格按本机账号隔离。批选限于当前页。CSV/TSV 显示有界的字面值表格，支持切换源文本。PNG/JPEG/WebP 使用既有授权读取和 ImageViewer。PDF 可切换提取文本页；排版还原及按需读取 PDF 字节仍待实现。重复文件筛选仅以可见原件的摘要与字节数归组，三配置验证。上传单个文件后等当前快照确认再打开，批量上传继续显示队列。
6. **架构。** Application 只读投影组合 FolderLink、ProjectFolderLink、SpaceFolderLink。数据访问、原件、版本、Outbox 及同步仍走现有入口。相关代码位于 resource-folder-index.ts、resource-catalog.ts、local-work-pull.ts、local-work-sync.ts 及 FilesWorkspace、FilePreview、NoteBrowser。详见 ADR 0150。
7. **数据兼容。** 修复全量水合与增量副本白名单遗漏三类既有关联。旧本地标记的修复以同一游标为条件。无远端 schema、公共 API 或 Agent Tool 变更。解除文件夹引用后文档仍在原 Space，id 与 Markdown 均保留。
8. **性能。** 同前轮机器、同 Chromium、1440×900。1000 条首次显示 521 ms，选择 85 ms；10000 条首次显示 943 ms，选择 49 ms，均挂载 60 行。基线分别为 400/104 ms、1745/570 ms。14 路由、七种宽度与四种主题/密度组合共 392 项在隔离空工作区的页面及主区域没有横向溢出。这是并行编译与测试时的单次观测，不能作为分位数。详见 evidence/session398/performance.json。
9. **质量门禁。** 旧 397 全量 check 为 1573 通过、1 失败、1 跳过；旧浏览器为 780 通过、12 失败。新候选专项见 PROGRESS.md，下次恢复应首先读取 .artifacts/ux398/check-r2.log 与 full-browser.log 的末尾，避免把中间失败统计当成最终结果。
10. **截图。** [批量收藏](evidence/session398/desktop-batch-favorites.png)、[移动端集合详情](evidence/session398/mobile-collection-relations.png)、[日记日期](evidence/session398/journal-mobile.png)、[图片](evidence/session398/image-mobile.png)、[PDF 文本分页](evidence/session398/pdf-desktop.png)、[Windows WebView2 表格](evidence/session398/windows-table.png)。
11. **发布、备份与回退。** 开发用未签名 EXE 与模拟工作区仅保存在本机。副本更新和回滚影响见 RELEASE-READINESS.md，真实旧客户端回退、升级包和备份恢复签收仍待验证。
12. **风险。** 临时账号的搜索和预览覆盖不代表共享工作区的所有委派授权已经验收。跨设备收藏、完整预览、跨文件夹拖放、批量移动、其他产品模块、Android 真机等仍开放。
13. **运维影响。** 无生产操作。老副本首次补齐可能引起一次额外的元数据读取及既有保护性备份，完成标记避免重复执行。Android ARM64 JNI 已成功编译并检查 ELF64 和应用 JNI 命名。adb 当前没有设备。设备本地收藏不保存标题、正文或原件。
