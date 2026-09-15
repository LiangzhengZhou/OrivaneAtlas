# PostgreSQL 存储开发与验证

当前为 M1 第二个数据层切片。Node-only 适配器已在本机真实 PostgreSQL 上运行，尚无 Web/Remote 接入、账户系统、正式备份恢复或线上部署。决策见 ADR 0005；SQLite 的文件备份能力不能算作 PG 备份能力。

## 宿主接口

- packages/storage-postgres/src/index.ts 导出 PostgresUnitOfWork、PostgresStorageError、PostgresOptions 和 BeforeUpgrade 类型。
- PostgresUnitOfWork.open({ connection, lockTimeoutMs?, beforeUpgrade?, onPoolError? })：明确传入 pg PoolConfig 的 database 或带数据库路径的 connectionString。默认连接池最大 4、连接等待 5 秒；这些连接参数可由受信任宿主配置。不能把终端用户提交的连接配置直接使用。
- 仅对本项目专用数据库启动；不会创建数据库或数据库角色。迁移在固定 arclattice schema 中执行，拒绝未识别的已有用户表/Schema/函数，不接管共享 Web 服务的数据库。
- provisionWorkspace(workspace, principals)：显式建立工作区与成员引用；重复相同配置幂等，不覆盖同 ID 的不同元数据。这是管理入口而非注册/登录/RBAC。
- 注入 WorkService 后使用 run(workspaceId, callback)；UI 只调用应用操作，不能通过 HTTP 传 callback、SQL、PoolClient 或身份声明来获得数据库权限。
- inspectEvents(workspaceId) 供宿主诊断；Activity/Outbox 随业务同事务记录，没有投递、重试或消费保证。
- await close()：拒绝新操作，等待已接受的操作和连接池请求结束，再关闭所有连接。重复关闭允许；同实例事务内 run/provision/inspect/close 拒绝嵌套。

connection 中可能包含口令、证书等敏感数据，只能由宿主受控配置/秘密存储注入，不写入源码、交接、日志或普通业务库。未来远程连接应验证 TLS 和数据库身份，不能直接沿用测试集群配置。数据库原始错误可能包含内容，宿主对外响应需映射稳定错误码并脱敏。

## 事务与并发

1. 获取独占 PoolClient，BEGIN ISOLATION LEVEL READ COMMITTED。
2. 设置事务级 lock_timeout，默认 2000ms、允许整数 1–60000；0 在 PG 表示禁用，因此拒绝。statement_timeout 固定 30000ms，不等于整个 callback 的执行期限。
3. 获取共享迁移 advisory lock，并检查当前版本是否仍与本适配器一致；若其他宿主已升级 Schema，旧实例报 SCHEMA_CHANGED_REOPEN_REQUIRED。
4. SELECT workspace FOR UPDATE，然后才读取任务、依赖、版本；同工作区串行，不同工作区可用其他池连接并行。
5. 参数化读写、领域策略、Activity/Outbox 同事务执行，成功提交，失败回滚。

迁移取同一数据库内的排他 advisory lock。锁协议只约束本适配器，不禁止管理员直接写 SQL；宿主升级仍应进入维护状态，停止旧版本服务后再迁移。应用锁等待不重放 callback。提交时连接断开可能让提交结果不确定，不能自动重试；公开 API 的幂等机制和故障恢复仍待实现。

同一事务的端口调用内部排队，callback 返回后封闭句柄并等待已接受的调用。任一端口失败都回滚，即使 callback 捕获了错误；不提供事务内 savepoint 后继续写入的语义。规范用法仍要求 await 每个端口调用。输入对象在接受时复制，已关闭句柄不能再次读写，避免异步调用在连接释放后泄漏到下一笔事务。

连接池空闲 error 事件有监听器，可用 onPoolError 交给宿主脱敏监控。正在使用的客户端也监听连接错误；失效连接弃用，不因未处理事件崩溃。callback 不应等待用户输入或其他网络，不跨实例嵌套事务；全工作区读取和长事务尚未做规模优化。

## Schema 与迁移

PG 独有的 migrations/0001-work.sql 与 SQLite v1 逻辑对齐，但不是同一份 SQL 文件。工作区复合主键/外键、成员约束、枚举 CHECK、任务软删除及归一化依赖唯一索引均存在。DAG/状态策略仍在锁内的 WorkService，不由数据库独立实现。

version 使用带 JS 安全整数范围 CHECK 的 BIGINT，投影时转为 float8 返回 Number，避免 pg 默认 BIGINT 字符串与领域契约不一致；不改全局 pg parser。Markdown 和既有 ISO 时间字段为 TEXT，保持原始字符串，不引入隐式时区转换。

schema_migrations 记录 application、version、name、checksum、applied_at。checksum 采用 SQL 按 LF 归一化后的 SHA256。DDL、数据和历史同事务；拒绝未来版本、篡改历史、缺失必要表/索引。此启动校验不是数据库管理员篡改防护或全量 Schema diff。

正式迁移目前仅 v1。新增版本应追加 SQL，不修改已使用的 v1；TypeScript 源码包尚未独立打包，未来宿主构建须保留 SQL 资源。

## 升级备份的明确缺口

已有数据库升级时，beforeUpgrade({ fromVersion, toVersion }) 在排他迁移锁内执行，成功返回表示宿主已创建并验证可恢复的真实备份。未提供钩子报 UPGRADE_BACKUP_REQUIRED；钩子失败则禁止后续 DDL。钩子不得回调本适配器、永久等待或修改活库；其自身超时、离线维护、备份路径、权限、保留策略都由宿主负责。

便携测试包只有 initdb、pg_ctl、postgres，不含 pg_dump/pg_restore；本轮没有安装全局客户端工具。升级测试中的成功钩子是显式测试替身，用来验证调用次序、门禁和数据库事务回滚，绝不是实际备份。禁止把空钩子放进生产宿主来绕过门禁。

还须补齐：版本兼容的真实 pg_dump、验证备份、恢复到全新数据库、恢复后仓储读取、备份失败/恢复失败与维护锁演练。未完成前不宣称 PG 升级或灾备生产就绪。SQLite 已验证的备份原语继续独立存在。

## 本机测试设施

本机 PATH、Windows 服务和常见安装目录未发现 Docker/PG。根工作区 optionalDependencies 锁定 @embedded-postgres/windows-x64 与 linux-x64 18.4.0-beta.17；本机仅安装 Windows x64 包，postgres --version 实际为 PostgreSQL 18.4。它们是开发测试二进制，不是部署依赖或系统服务；生产构建不应携带测试运行时。第三方许可证随依赖保留。

测试 beforeAll 新建 OS 临时 arclattice-pg-* 目录，随机口令初始化 SCRAM 身份，只绑定 127.0.0.1 的临时端口，禁用 Unix socket，不读取 DATABASE_URL。每个测试独立创建带随机 ID 的数据库；afterEach 只删除本集群中登记的测试库，afterAll 停止本数据目录对应的集群并清理目录。所有子进程在 Windows 隐藏启动，不修改用户现有进程或服务。

启动失败时保留专属目录和 server.log 便于诊断，不能仅凭端口号终止某个进程。测试中断后若需手动清理，必须先核对完整数据目录、进程归属，使用对应 pg_ctl 停止该集群后再清理它自己的目录。

执行 pnpm exec vitest run packages/storage-postgres 或完整 pnpm check。本机全量数据库测试约一分钟，不是挂起。没有外部数据库连接参数，也不会因为未找到数据库而静默跳过。便携运行时目标为 Windows/Linux x64；其它平台明确失败，Linux 需非 root 用户。当前只实际验证 Windows x64；Linux CI、其它 CPU/PG 版本仍未执行。

依赖包的 symlink postinstall 脚本当前禁用；Windows manifest 为空，已验证原生程序可直接使用。Linux 依赖安装、库链接与集群运行尚需在实际 CI 核验，不应写成 Linux 已通过。
