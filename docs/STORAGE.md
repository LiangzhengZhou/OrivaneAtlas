# 存储开发与验证

当前阶段：SQLite 已通过私有 Node 宿主接入 React 工作台并部署，包含 v2 Notebook/Journal/Revision 和幂等请求回执；Tauri/PG 尚未接入 UI。私有 API 见 docs/api/openapi.json / ADR 0009，尚无完整备份产品。本文专述 SQLite（ADR 0004）；PG 的事务、迁移和备份缺口见 STORAGE_POSTGRES.md / ADR 0005。

## 入口与文件

- packages/storage-sqlite/src/index.ts：SqliteUnitOfWork、restoreDatabase、StorageError。
- packages/storage-sqlite/src/migrations/0001-work.sql：首个关系 Schema；后续更改追加 migration，不改已应用 SQL。
- packages/storage-sqlite/src/migrations/0002-workbench.sql：幂等回执、Notebook/Revision、笔记 Activity/Outbox；原 v1 SQL 不变。
- packages/storage-sqlite/src/notebook.ts：工作区绑定的笔记仓储，CAS、修订、软删除和日记唯一性。
- packages/storage-sqlite/src/migrations.ts：项目标识、版本/历史/必要对象检查、升级前备份、事务迁移。
- packages/storage-sqlite/src/database.ts：锁获取、SQLite backup、独立文件快照及完整性校验。
- tests/contracts/work-repository.ts：Memory/SQLite/PostgreSQL 共用契约；工厂可返回 Promise，测试者负责连接与临时数据清理。

依赖现有 Node 24 的 node:sqlite，不安装额外 SQLite 驱动或全局服务。本机验证 Node 24.20.0 / SQLite 3.53.4。公开包仍导出 TypeScript 源码，宿主构建必须处理 TS 并保留 SQL migration 资源；这不是可直接运行的浏览器包或已发布 Node 分发包。

## 生命周期与宿主职责

1. 宿主选择明确文件路径和数据目录；确保父目录存在，并管理 OS 访问权限。open 不自行创建任意目录，不把凭据写进数据库。真实数据应在应用数据目录，不在仓库内。
2. 调用 SqliteUnitOfWork.open(filename)，等待迁移和完整性验证完成。拒绝空路径、:memory:、未知数据库、未来版本、不匹配历史及缺失必要对象。
3. 通过 provisionWorkspace(workspace, principals) 显式建立工作区和 Principal/成员关系。重复相同初始化无副作用；不覆盖同 ID 的不同名称或身份类型。此管理接口不是登录/注册，也不是授权策略。
4. 将实例注入 WorkService，并注入独立授权策略、时钟和 UUIDv7 生成器；packages/host 负责单 owner 会话身份，不接受前端 actor。测试用随机 UUID 只用于测试，不改变产品 UUIDv7 约定。
5. 执行应用操作；不能把事务 callback 暴露给 UI、Agent 或 REST。callback 要短，不在事务中等网络/用户输入，不跨实例构造嵌套事务。
6. 关闭时 await close()：拒绝新操作、等待已接收操作完成再关闭连接；可重复调用。run/backup/provision/close 同实例嵌套会明确失败，避免排队死锁。

当前每个事务，包括 snapshot，先 BEGIN IMMEDIATE，再读取/校验/写入。实例队列只负责本连接，SQLite 锁负责跨连接/进程；锁获取有界异步等待，默认 2000ms，可在 open 的 lockTimeoutMs 中配置 0–60000ms。不重试 callback，避免副作用重复。同步 SQL 仍可能阻塞 Node 事件循环，此版适合数据层验证，未做吞吐承诺。

## 数据语义

- 工作区过滤出现在所有业务查询；任务/边/事件均带 workspace_id。
- 任务创建者、更新者和可选受派人必须属于工作区；实际权限仍由 AuthorizationService 决定。
- version 使用 SQL 条件更新，stale 写入无事件。任务软删除；边显式移除并留 Activity，暂无边版本/软删除/同步墓碑。
- Markdown 原文直接存 TEXT，包含中文、换行、引号和 emoji 的往返已有测试。
- work_edge 端点和 outbox.activity_id 通过复合外键保持工作区隔离；依赖归一化唯一索引防止重复。完整 DAG/状态规则在 WorkService 的锁内执行，绕过服务任意直接 SQL 不受完整业务规则保护。
- Activity/Outbox 与业务同事务持久记录，没有消费状态/Worker/重试，不能宣称可靠消息或 Security Audit。
- work_item 与 notebook 均有版本/软删除；Workspace/Principal 管理及完整 Object/Document 模型仍需扩展。Notebook 默认 PRIVATE/REMOTE/AI DENY/HUMAN。
- 宿主调用 request(context, receipt, callback)，回执按 Workspace/Principal/key 绑定摘要，重试同请求返回已提交结果，摘要不符拒绝。回执与任务/笔记/修订/Activity/Outbox 同事务；只供受信宿主调用，callback 不暴露给 HTTP。

## 备份与迁移

普通备份：await db.backup(newFilePath)。使用 SQLite backup API 包含已提交 WAL 数据；转换新快照为 DELETE journal，形成无 WAL/SHM 依赖的独立文件。检查 integrity_check 与 foreign_key_check 后才返回成功。

已有库升级：先锁写者 → 只读连接创建升级前快照 → 校验 → 同事务执行 migration、历史和 user_version → 再校验 → 提交。备份在同目录生成类似 work.sqlite.pre-v2-UUID.sqlite 的新文件。失败迁移回滚 DDL、数据、版本和历史，保留升级前快照。首次空库建 v1 无业务数据可备份；初始 migration 失败则连项目标识和历史表一起回滚。

数据库级恢复：await restoreDatabase(backupPath, newDatabasePath)，校验来源后恢复到新文件，再通过 open 验证并测试应用数据。必须停止/协调旧宿主后才考虑切换路径；本轮没有自动切换或覆盖活库功能。

所有目标路径以排他创建预留；已存在的文件（含源库自身）会失败，绝不截断覆盖。父目录错误、无权限等问题应修正路径后使用新的目标重试。若备份阶段失败，可能留下无效或不完整的新产物；不能因文件存在就认为备份成功，只有成功返回的结果可用。当前不自动删除这类文件。

数据库不是加密存储，备份同样可能包含用户内容。尚未实现自动保留、加密、附件/文档导出包、远程备份、恢复 UI 或断电故障注入验证。

## 验证命令

- pnpm install --frozen-lockfile：安装工作区链接。
- pnpm exec vitest run packages/storage-sqlite：只运行 SQLite 测试。
- pnpm check：格式/分层、类型、全部测试和 Web 构建。

SQLite 测试使用 OS 临时目录下新建的 arclattice-sqlite-* 专属目录；关闭所有连接后仅清理已确认的测试目录，不触碰用户数据库。跨进程测试只启动一个隐藏的临时 Node 子进程并在结束时退出。

覆盖重开数据保留、事务回滚、同工作区身份外键、跨租户边/事件引用、共享仓储契约、两个连接 CAS/DAG 竞争、独立进程持锁与版本观察、锁超时、关闭/嵌套保护、迁移成功/失败/历史/未知库保护、WAL 快照、恢复和覆盖保护。

2026-09-14 会话 007：SQLite 33 项和宿主 13 项在 Windows 与 Ubuntu 的 server-safe 集合中通过；包含真实 v1→v2 升级、v2 备份/新文件恢复、重开回执/笔记保留。UI 的真实 SQLite E2E 15 项在本机通过。Linux CI、原生宿主、长期故障恢复和规模压力尚未验证。PG 结果单独记录，不与 Linux SQLite 证据混同。
