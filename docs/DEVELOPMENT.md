# 开发说明

015更新：SQLite追加v7，OpenAPI0.6.0。OrganizationService提供任务归档/取消归档/软删除、笔记日记同工作区文件夹批量移动/软删除（最多100项）；元数据随snapshot/sync返回，宿主事务保护双版本预检、Activity/Outbox和幂等回执。见ADR0014。正文编辑支持行内及多行公式实时预览，保留原始Markdown；界面16px、正文18px。当前状态以PROJECT_STATUS顶部为准，下方013是基础架构说明。

013更新：展示名Orivane Atlas，SQLite追加v6，OpenAPI0.5.0。SPACE/DOCUMENT已并入snapshot.library、在线同步及知识关联；旧文档中“尚未融合”的012说明不再适用。所有正文统一由DocumentWorkspace/CodeMirror标签页编辑，停笔1秒自动保存（导入也进入此流程），冲突不覆盖。个人AI由main.ts组装独立加密vault，生产入口不读取管理员全局模型配置；测试createHost的model注入仅用于隔离测试。准确操作/限制见ACCOUNTS_LIBRARY与ADR0013，当前验证见PROJECT_STATUS。

## 模块与契约

- apps/web：React/Vite UI，仅 bootstrap.ts 组装 HTTP 客户端，不导入数据库。
- packages/host：Node 同源宿主，账号隔离workspace/管理员审核/旧密钥恢复、会话/CSRF/限权Bearer/幂等、静态产物与管理员全库备份。
- packages/application：WorkService/NotebookService/ConnectedService/LibraryService、AccountStore与事务端口；项目归属、日期、知识引用、讲义与AI审批在事务内验证。
- packages/domain：WorkItem、DAG、Agent治理纯类型/规则；无UI/数据库依赖。
- packages/storage-memory：仅测试/契约适配器，不作产品回退。
- packages/storage-sqlite：v1–v6追加迁移、任务/项目/日期/笔记/全修订/知识关系/AI运行/账号验证器/凭证哈希/空间/讲义/图片/receipt/事件及独立Audit、在线备份；v6允许新API凭证长期或永久有效，旧凭证到期时间不变。
- packages/storage-postgres：v1/v2任务适配器（含项目/日期）；尚无Notebook/HTTP接入。
- packages/i18n：en-US/zh-CN，只有语言偏好使用localStorage。
- tests/e2e：独立临时SQLite/真实宿主，Chromium桌面英文/中文、移动中文。
- src-tauri：入口/图标骨架与无远端IPC的服务器连接配置，原生未编译；pnpm desktop:doctor 检查工具链，绝不自动安装。

## 本机运行（PowerShell）

Node24 / pnpm11.19.0；数据目录位于仓库外、仅当前用户可访问，不与服务器活库混淆。

~~~powershell
pnpm install --frozen-lockfile
pnpm build
$env:ARCLATTICE_DATA = Join-Path $env:LOCALAPPDATA 'ArcLattice-local-dev'
$env:ARCLATTICE_WEB_ROOT = Join-Path (Get-Location) 'apps/web/dist'
node packages/host/dist/main.js
~~~

默认 http://127.0.0.1:4317，首次生成 data/access.key，输入密钥解锁；不要打印进日志。Linux受限权限，Windows另需保证目录ACL。端口已占用时用ARCLATTICE_PORT指定空闲端口，不结束未知进程。不要双击index.html。pnpm dev只提供Vite前端，尚无完整API代理；稳定验收先build再启动同源宿主。

部署环境应通过环境变量配置 ARCLATTICE_ORIGIN，Node 默认只监听回环。HTTPS 源使用 Secure 会话；明文源只允许 127.0.0.1。精确 Host/Origin，不信任转发头。公开服务不能通过旧 localhost 隧道登录（Host 不匹配是预期）。

## 验证命令

- pnpm format：Biome格式化；pnpm lint：格式与AST依赖边界。
- pnpm typecheck：8包及根测试/配置。
- pnpm check：lint/typecheck/全部测试/build；仅本地隔离机。test会启动真实PG临时集群。
- pnpm check:server-safe：单并发类型/测试/构建、排除PG，远端必须经wrapper。
- pnpm test:e2e：先build，临时宿主使用1420/1421并自动关闭，不杀未知监听；仅本机运行。
- pnpm exec playwright install chromium：仅本地缺浏览器时，不在共享主机装重型浏览器。

~~~sh
./scripts/check-boundaries.mjs
~~~

必须绝对pnpm路径，systemd-run不会使用子进程PATH替管理shell找可执行文件。服务器资源与原站边界见DEPLOYMENT。

## HTTP 与数据语义

OpenAPI见docs/api/openapi.json（0.5.0，/api与/api/v1别名），账号/API指南见ACCOUNTS_LIBRARY.md。Workspace/Principal来自可信宿主，不接收前端actor。浏览器POST需精确Origin、会话、CSRF，业务变更另需Idempotency-Key；原生Bearer不需Cookie/CSRF/Origin，若有Origin则精确校验。管理员备份为只读快照无幂等键。秘密不进普通数据库/源码/浏览器存储，数据库只存scrypt验证器/令牌SHA256。写事务先重新鉴权再查receipt，防撤销与排队写入竞态。

会话8小时，重启失效；数据库/密钥保留。snapshot返回任务、边、笔记、回收站与links；/api/sync按内容摘要返回变化快照，未变为null。Notebook正文不变换，kind/day不可修改，日记每日唯一；恢复修订先草稿后保存新版本。知识/AI契约和权限见 CONNECTED_OPERATIONS.md；密钥配置保持仓库外，不自动取业务数据作为模型上下文。

WorkItem新字段projectId/startDate/dueDate可空，日期YYYY-MM-DD>=0001且开始不晚于截止；不涉及UTC调度。项目只一层、类型创建后不可改；有活跃成员时不能删除项目。恢复任务时若所属项目已删则清空归属，不自动恢复父项目。月历按开始/截止日显示，没有提醒。

幂等键绑定路径与原始JSON字节，receipt与业务/Activity/Outbox同事务；网络不确定重试复用键。键仅页面内存，未确认提交时勿刷新后重新创建。已提交但刷新失败关闭编辑器并提示，手动刷新恢复列表。版本冲突/失败保留草稿。

Markdown阅读使用安全GFM/数学公式渲染，不执行原始HTML/外部图片；只允许本项目鉴权图片。统一文档标签页支持UTF-8 .md/.markdown/.txt导入，600000字节/200000字符限制，保留原始换行，导入草稿进入1秒自动保存；不转任务。SPACE/DOCUMENT已加入知识图和/api/sync，RELATED为无向可成环，REFERENCES为有向，工作依赖仍是DAG。PDF为客户端打印而非服务端API。实时编辑不是完整Obsidian兼容实现；重认证仅允许原身份，未保存草稿仍只在页面内存。

设置可下载完整SQLite快照（64MiB上限，每分钟一次，验证完整性）；全库含私有内容需安全保存。JSON仍只是内容快照，不含全部修订/receipt/事件。恢复只能管理员到新文件，无覆盖活库API。加密异机拉取/新文件恢复工具及定时模板见 OFFSITE_BACKUP.md，尚未指定接收机或启用自动任务。

## 检查点与发布验收工具

node scripts/package-source.mjs ABSOLUTE_OUTPUT_PREFIX：仓库外生成新tar.gz和逐文件sha256清单；Git可见源文件，拒绝不安全路径、秘密/数据库文件、符号链接；拒绝覆盖旧检查点。上传前校验服务器旧清单并盘点新增文件，上传后核验hash，不将归档当业务备份。

node scripts/verify-release.mjs https://your-host.example C:/path/outside-repository/access.key：仅在安全本机运行，密钥读入内存、不打印；验收可信 TLS/首页/health/匿名拒绝/登录/快照/Secure 会话/全库下载/CSRF，最后登出。无业务写入。受备份每分钟门禁约束，不要快速重复执行。

## 实际范围

会话013 Windows全量278项/15文件；最终E2E33项（桌面中英文/移动中文），含实时预览/IME/自动保存/标签、日历日记、混合知识图、个人模型/上下文审批、两会话同步/草稿/版本冲突、账号/API/图片/PDF及既有流程。模型网络使用替身，无真实供应商外发。截图在test-results，已检查桌面/移动编辑器、混合图、公网账号/AI/知识空间和PDF。服务器242项及Host构建通过，嵌套Web构建中止后经同一wrapper直接Vite补建通过，不声称整体check成功；详见PROJECT_STATUS/DEPLOYMENT。禁止在共享服务器执行PG/浏览器。

Linux PG、真实PG dump/restore、Tauri/Rust/MSVC/Android、CI发布、完整无障碍/渗透/压力、自动灾备、跨证书续期周期与整机重启演练未完成；不能从其他检查通过推出这些完成。
