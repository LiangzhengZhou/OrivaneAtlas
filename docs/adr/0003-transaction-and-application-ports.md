# ADR 0003 — 异步事务端口与远程边界

日期：2026-09-13。状态：Accepted（M0 最小契约，M1 可增量细化）。

## 决策

- Domain 是无外部运行时依赖的同步纯逻辑。
- Application 注入 AuthorizationService、Clock、IdGenerator、UnitOfWork；不创建数据库或读取浏览器全局变量。
- `UnitOfWork.run(workspaceId, callback)` 创建已绑定 Workspace 的异步事务。事务内读取、修改、Activity 与 Outbox 均通过 Promise 方法，并显式 await。
- WorkItem compare-and-swap：expectedVersion 与当前版本相同才更新，新版本必须 +1。
- ActivityEvent 与 OutboxEvent 类型分开；Outbox 关联 Activity，但没有实现 Worker、可靠投递或 Security Audit。
- 当前 Web 由唯一 composition root 组装本地应用服务，React 组件不导入存储包。
- 后续 REMOTE 使用应用操作对应的 HTTP 客户端，不将事务 callback 或数据库访问传到浏览器。服务端重新验证身份、权限、schema 并执行原子事务。

## 限制

当前快照/全图校验适用于小型演示，不能据此保证大数据性能。现有事务端口只覆盖 Work，不提前填充几十个空 Repository。增加 Object/Document/Agent 时再按真实用例扩展。

原型中的 ID 类型暂为 string，浏览器组装点注入 UUIDv7。公开边界必须增加严格运行时 UUID/schema 校验。安全审计、幂等存储、重试、迁移和备份不在 Memory 实现中伪装完成。
