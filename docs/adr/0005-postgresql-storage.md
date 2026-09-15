# ADR 0005 — PostgreSQL 数据层与真实临时数据库测试

日期：2026-09-13。状态：Accepted（M1 第二切片，不包含远程产品部署）。

## 执行边界

新增 Node-only storage-postgres，使用 pg 连接池，实现既有异步 UnitOfWork。UI/Domain 不依赖驱动；不提供公开 API、Auth 或 RBAC。宿主明确传入连接配置，禁止把凭据写入仓库。数据库必须专属于本项目；使用固定 arclattice schema，拒绝未识别的已有数据。

本机无 Docker/PG；测试依赖携带便携 PostgreSQL 原生程序，只在新建 OS 临时目录初始化集群，绑定 127.0.0.1 的临时端口、不安装系统服务、不使用线上服务器。测试使用真实服务器与独立连接，不用 Memory/PGlite 模拟。仅开发验证使用这些二进制；生产数据库版本和运维方案另行决定。Windows/Linux x64 是当前测试运行时范围，其它平台明确报错，不静默跳过。

## 事务与生命周期

每次操作独占一个 PoolClient，显式 READ COMMITTED，在任何业务读取前获取事务级共享迁移 advisory lock，再 SELECT workspace FOR UPDATE。此工作区行锁是图变更与状态变更的共同互斥边界；不同工作区可并发。锁等待完成后的独立查询读取新提交状态。使用服务端 lock_timeout/statement_timeout，不重试业务 callback。所有适配器写入路径遵循锁协议；任意外部 SQL 不受应用规则保护。

迁移获取同一 advisory key 的排他事务锁，防止适配器业务写入与迁移相交。初始化 Principal 的全局唯一身份使用 INSERT ON CONFLICT + 内容检查；不是授权操作。连接池由适配器拥有；close 拒绝新操作并等待已接收操作，同实例嵌套拒绝。事务端口封闭后不能复用；排队并等待已接受的端口操作，任一端口错误导致整笔回滚，即使 callback 捕获该错误。连接故障不得导致静默提交或复用损坏连接。

## Schema 与迁移

PG 自有 v1 SQL，保持 SQLite 的工作区复合外键、成员约束、归一化依赖唯一索引、Activity/Outbox 原子性及软删除语义。version 使用 BIGINT 并限制 JS 安全整数；只在本连接将该列转为 Number，不修改 pg 全局类型解析器。日期/Markdown 使用 TEXT 保持现有契约的字符串，不改变领域格式。

迁移版本/名称/LF 归一化 SHA256 校验和与 DDL 同事务记录；检查项目标识、未知/未来/篡改历史和必要对象。仅正式 v1；测试中的 v2 只用于验证升级器。已有库升级要求宿主提供 beforeUpgrade 备份钩子，未提供或失败则拒绝执行 DDL。钩子在排他锁内执行，不能回调本适配器，宿主负责真实备份、验证与保留；事务回滚不是备份替代品。便携包仅含 initdb、pg_ctl 和 postgres，不含 pg_dump / pg_restore。本轮只验证升级钩子的调用/阻断契约和真实数据库回滚，不验证实际 PG 备份恢复；成功测试中的备份钩子明确是测试替身，不能用于生产。

## 验证目标

运行同一 Memory/SQLite/PG 仓储契约，另验证独立连接 CAS、DAG 竞态、跨工作区并发、回滚与约束、连接/集群重开、锁超时、关闭/逃逸句柄、连接故障、升级成功/失败、备份门禁及未知库拒绝。实际执行结果写入会话记录；未执行的平台不标通过。
