# 2026-11-23 源码与体验基线

起点 main / 0f0595ae276874e8f02f7cadf5fcff97f738e858，单工作树，git status --short 为空。六个 node 进程命令行均未命中仓库或测试工具。最近接力 Session396 已释放认领。分支 codex/ux-upgrade。HTML 从用户附件逐字节导入，SHA256 5C6FBAC291B686B965A0FD87AD689D789C5EAC9B9DAB5115C9FD4AB562E3FC05。工作依据为第 0–14 节全文。

|核对项|当前依据|
|---|---|
|发布与部署|package.json 3.1.14，GitHub Latest v3.1.14 / 0f0595a。部署文档最近明确运行记录为 3.1.6 / SQLite 51，当前线上版本未知。git ls-remote 遇本机代理拒连。|
|迁移与写入|SQLite 51 / PostgreSQL 46，源码 migrations.ts。文件上传使用 runtime.uploadFile，传入 File 原件。文档属于 spaceId，文件还有 parentDocumentId，笔记 primaryFolderId 对旧行有回退。|
|关系|ADR 0147 修订后的 FolderLink 写入目标为 NOTE、DOCUMENT、FILE。项目或 Space 使用独立关系。ADR 0148 仅归档 OWNED 资源，恢复走版本与批次校验。|
|路由|app/navigation.ts 中 overview、focus、tasks、projects、calendar、notes、journal、files、library、graph、ai、account、admin、trash、settings。Document 和 File 有工作区标签。knowledge、dependencies、planning、board 是兼容深链。|
|样式|main.tsx 顺序为 tokens、themes、palettes、reset、controls、styles、workspace、product、shell、components、glass、utilities。业务页面还有独立 CSS。旧 workspace.css 与 shell.css 均声明 logo 样式。|
|偏好|theme.ts 读取 orivane-atlas.theme 和 orivane-atlas.palette。默认 warm-green，已有五个调色板。orange-white 的浅色规则也会覆盖 dark 的语义色。|
|资源浏览|FilesWorkspace 每次渲染创建映射、排序整个结果并渲染所有行。projectByTarget 仅以 ID 为键并覆盖其他项目关系。选中后详情在 body 网格外，三栏选择器无法命中。上传只取 files[0]。|
|基线门禁|pnpm build 成功，Turbo 2/2，3.566s，存在大于 500 kB 的 chunk。其他运行结果见 PROGRESS。旧版 Release 测试数只作历史记录。|

## 依赖与任务树

|顺序|工作范围|退出证据|
|---|---|---|
|1|核对实际构建、版本、路由、CSS、领域关系、生命周期、测试隔离|本文件与独立日志、桌面/窄屏/移动明暗截图|
|2|方向 C 的两个真实应用方案、图形与字标、全尺寸 Web/Windows/Android/通知资产|组件截图、所有帧/蒙版、品牌规范|
|3|收敛语义/组件/密度 token、输入选择、浮层、空/加载/错误、焦点和减少动效|组件状态、五套偏好、两种密度、对比度与键盘矩阵|
|4|Shell、Dashboard、搜索/命令/通知/同步、移动导航和排序|新用户首次进入、键盘查找和恢复、桌面和触控|
|5|统一已授权资源投影、目录/列表/网格/Inspector、筛选、收藏、最近访问、批处理、预览、上传失败恢复、回收站|总纲 5.3 P0/P1/P2 与 10.2，共享 ID、多项目、权限与重放测试|
|6|笔记/日记与 Markdown 文档、知识空间/图谱|创建与归档、保存/历史/冲突、附件、Wiki、键盘和长文|
|7|项目、任务/专注、日历与提醒|项目资源增删恢复、完成撤销、依赖、重复提醒跳过|
|8|AI 对话、模型与审批、账户/设置/通知与同步|上下文披露、取消、未知结果、账户隔离、断网恢复|
|9|Web/Tauri/Android、键盘与软键盘、布局、对比度、资源性能|1920/1440/1280/1024/768/390/360，Light/Dark × Compact/Comfortable，1k/10k 资源|
|10|全量 lint/types/unit/contract/PG/E2E/narrow/perf/native/设备，迁移与恢复|独立 fixture、命令/耗时/失败/跳过与人工结果|
|11|运维、版本/兼容性、发布准备、回滚与 §14 报告|§13 逐项证据，所有 P0/P1 关闭后方可签收|
