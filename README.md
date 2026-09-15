# Orivane Atlas

Markdown-first、Local-or-Server、AI-native Personal OS。原项目名ArcLattice，内部包名/路径/服务保持兼容。当前实现账号隔离工作台，任务与知识数据保存在服务器 SQLite；不是完整 v0 或自治 Agent 产品。部署状态以 docs/PROJECT_STATUS.md 为准。

## 现在使用

生产部署地址、管理员登录方式和服务器运维信息不属于公开仓库开发说明，请勿将真实部署凭据或生产地址提交到 Git。公开贡献者应使用本地开发宿主和示例配置；部署细节见私有运维文档，不应直接发布。

密钥位置和安全复制方式见 docs/DEPLOYMENT.md，密钥不在仓库。不要双击 apps/web/index.html，它是构建入口，不是独立网页。

已可用：总览、专注、任务、拖拽看板、单层项目/任务归属/完成比例、开始与截止日期/月历/逾期、DAG依赖、笔记/日记/修订/回收站、Markdown文件导入草稿与导出、完整SQLite备份下载、中文/英文与移动布局。展示真实数据，不预灌假任务。

独立 HTTPS 与宿主均已开机启用，不改变原网站；尚未整机重启演练。数据库和密钥持久保存，宿主重启后重新登录。只有 UI 语言偏好使用 localStorage；业务数据属于服务器 REMOTE，不是设备 LOCAL_ONLY。

## 开发与验证

本仓库源码可在本地开发；生产源码副本、数据库、凭据库和服务器配置必须与公开 GitHub 仓库分离。先阅读 `docs/DEVELOPMENT.md`，不要把真实 `access.key`、`master.key`、`providers.enc`、数据库或签名材料放入仓库。

需要 Node24、pnpm11.19.0。以下完整检查仅用于本地隔离机：

~~~sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
~~~

check 包含真实临时 PG 集群；E2E 使用本机 Chromium 与独立 SQLite 宿主，不连接用户数据。共享服务器仅经限资源 wrapper 跑 check:server-safe，详见 DEPLOYMENT。完整本地启动见 DEVELOPMENT；pnpm dev 只是前端，不能代替同源宿主。

013增加主区域实时Markdown标签编辑、自动保存/冲突对照/同身份重认证、日历日记、知识与任务图谱、SPACE/DOCUMENT关联及同步、个人与项目AI配置/显式上下文审批/审核应用文本建议，以及可撤销长期API凭证。实际测试和部署结果以 docs/PROJECT_STATUS.md 为准；操作和Node客户端示例见 docs/ACCOUNTS_LIBRARY.md。不会预置真实供应商凭据或自动外发私人正文。

## 跨对话接力

- docs/HANDOFF.md：当前状态、工作认领、准确继续命令与剩余问题。
- docs/PROJECT_STATUS.md：区分已实现、已验证、仅设计和未开始。
- docs/DEPLOYMENT.md：IP HTTPS、服务限制、备份与新文件恢复、原站保护。
- docs/DEVELOPMENT.md / docs/api/openapi.json：开发说明与应用合同。
- docs/architecture/AMENDMENTS.md：用户补充需求采纳索引；附件不是额外执行授权。
- docs/CONNECTED_OPERATIONS.md / docs/OFFSITE_BACKUP.md：知识/AI/同步、原生连接与加密异机备份操作边界。
- docs/adr/0011-connected-workbench.md 及 ADR0012：知识/账号/集成架构决策；docs/sessions/ 保存不可变会话记录。

继续提示：先读 AGENTS/HANDOFF/STATUS 与相关 ADR；服务器操作另需阅读私有部署文档并确认授权，不要把公开仓库当作生产部署副本。

未完成：完整Book/任意附件、Timeline/提醒、细粒度共享RBAC、自治Agent/工具调用、离线双向同步、服务器PDF生成、完整Obsidian插件/语法兼容、持久化草稿/图布局、正式原生发布签名、一键更新生产链路。AI真实模型需用户配置并批准；异机备份接收机/定时任务尚未配置。GitHub 发布前必须完成敏感信息扫描、许可证选择、CI 和发布流程审核。
