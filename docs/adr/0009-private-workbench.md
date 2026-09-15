# ADR 0009：单用户私有工作台宿主

日期：2026-09-14。状态：已接受并实现；验证和私有部署见会话 007。

- 沿用 Node SQLite，独立宿主仅监听 127.0.0.1:4317，通过 SSH 隧道访问；不更改共享入口。服务器数据属于 REMOTE，绝非设备 LOCAL_ONLY。
- 固定由宿主配置的 Workspace / USER 身份；随机访问密钥仅写受限文件，不放普通数据库、源码或浏览器存储。登录后使用 HttpOnly/SameSite=Strict 会话 Cookie、内存 CSRF token、8 小时期限。重启使会话失效。不是多用户账户/RBAC 产品。
- Host 精确白名单、同源检查、JSON 类型及长度限制、错误脱敏、登录速率限制。所有业务操作必须认证；服务器不信任客户端 actor。
- SQLite v2 增加 durable request receipt；请求键、摘要和结果与变更/Activity/Outbox 同事务，重试不重复写入。v1 SQL 不变。
- Notes/Journal 为独立应用契约、原文 Markdown、修订、软删除、版本冲突与事务事件；默认 PRIVATE/REMOTE/AI DENY/HUMAN，不发送模型、不自动转任务。PG 的知识适配器后置。
- UI 通过应用契约；bootstrap 组装 HTTP。不再静默退回内存。展示真实连接/保存失败，保存失败保留输入。
- 本轮可交付私有工作台，不代表完整 v0、原生客户端、同步、公开账户、Agent 或灾备完成。
