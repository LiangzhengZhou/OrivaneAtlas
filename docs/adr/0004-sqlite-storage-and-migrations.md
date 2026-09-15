# ADR 0004 — SQLite 首个持久化切片

日期：2026-09-13。状态：Accepted（M1 第一切片，不代表 M1 全部完成）。

## 运行边界

本轮新增 @arclattice/storage-sqlite，采用项目现有 Node 24 的 node:sqlite，本机已验证 DatabaseSync 与 backup API 可用。不安装原生编译工具链，不引入浏览器 SQL，也不实现 HTTP API。同步 SQL 只存在于适配器内部；Application 保留异步 UnitOfWork。Node 适配器用于本地数据层与契约验证，不能直接装入 Tauri WebView 或浏览器；以后由受信任宿主执行完整应用操作，UI 不接触数据库句柄或 SQL。Node SQLite API/同步执行的运行时限制仍需后续宿主选型评估。

## 初始关系与约束

- workspace、principal、workspace_principal：显式初始化工作区与身份，再绑定成员。Principal 不等于账户，成员存在不等于 RBAC 授权。初始化是宿主管理操作，不提供远程注册入口。
- work_item：复合主键 (workspace_id,id)；创建者、修改者、受派人通过 (workspace_id,principal_id) 外键限定为同工作区成员。枚举/正整数 version 使用 CHECK；version 更新执行 compare-and-swap。Markdown TEXT 不变换。
- work_edge：端点使用同工作区复合外键；禁止自环；以表达式唯一索引对 BLOCKS/REQUIRES 归一化去重。调度 DAG 由应用层在锁内校验，数据库约束不是权限系统，也不独立实现全部调度规则。
- 边仍是显式物理移除并留下 Activity；本切片不提供边 Trash/同步 tombstone。WorkItem 保留软删除策略。
- activity 与 outbox：独立表，Outbox 的 Activity 引用携带 workspace_id；随业务事务一起提交。仅存储现有事件形态，不冒充审计、可靠消费或幂等 API。
- schema_migrations 保存版本、名称、SHA-256 校验和与应用时间；PRAGMA user_version 同步 schema version，application_id 标识本项目。拒绝未知数据库、未来版本、缺失/被修改的迁移历史。SQL 文件按 LF 归一化后计算校验和，避免 Windows 换行差异。
- PostgreSQL 后续保持同一逻辑模型与共享契约，物理类型/迁移单独实现，不宣称本 SQL 可直接跨引擎执行。

## 事务和并发

SQLite 使用外键、WAL 和 FULL synchronous。每个 UnitOfWork 在读取前获得 BEGIN IMMEDIATE 写锁，再执行完整 callback 并提交；包含只读 snapshot 的现有统一端口也串行，因此这是正确性优先的首版。实例内部排队，跨连接/进程依靠 SQLite 文件锁，而非仅 JS 锁。锁竞争使用有界异步等待，不阻塞同一事件循环中持锁 callback 的推进；只重试获取锁，不重放业务 callback。禁止同实例嵌套事务。

PostgreSQL 计划在事务开始时锁定工作区行，再读取图并变更，所有图写入路径遵循同一规则；其并发行为必须独立跑真实数据库测试。

## 迁移与恢复

迁移在应用启动前完成。空库创建 v1 不需要备份不存在的业务数据。已有 ArcLattice 库升级时先获得写锁阻止其他写者，再由单独只读连接使用 SQLite backup API 生成升级前快照；快照校验通过后才执行迁移。迁移 DDL、历史和 user_version 同事务，失败整体回滚。备份创建/校验失败则禁止升级。

备份/恢复目标必须是新的明确文件路径，拒绝覆盖任何已有文件。备份使用 SQLite backup API 包含已提交的 WAL 数据，不能直接拷贝正在使用的主文件。每份快照执行 integrity_check 与 foreign_key_check。恢复为新的数据库文件，校验项目标识、迁移历史后才能打开；不提供覆盖当前活库的恢复按钮。失败新产物会保留并报告，不能当作有效备份。

这只是数据库级备份/恢复原语及测试，不是完整导出包、附件备份、加密、自动保留策略或 UI 恢复流程。原生桥接和 PostgreSQL 仍为后续切片。

## 查证依据

- SQLite 官方 Transaction 文档：https://www.sqlite.org/lang_transaction.html ，BEGIN IMMEDIATE 与单写者语义。
- SQLite 官方 Backup API 文档：https://www.sqlite.org/backup.html 。
- PostgreSQL 官方 Explicit Locking 文档：https://www.postgresql.org/docs/current/explicit-locking.html ，行锁计划，未实施。
- 本机 Node 24.20.0 的 node:sqlite smoke check 与项目安装的 @types/node/sqlite.d.ts；不以其他 Node 主版本文档代替本机 API 验证。
