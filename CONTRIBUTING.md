# Contributing to Orivane Atlas

感谢参与 Orivane Atlas。提交代码前请阅读 `AGENTS.md`、`docs/HANDOFF.md`、`docs/PROJECT_STATUS.md` 和相关 ADR。

## 开发原则

- 遵循 `UI → Application → Domain / Ports → Adapters` 分层。
- 所有业务访问携带 `workspaceId`，变更携带 `principalId`。
- 不提交凭据、数据库、用户数据、生产配置、签名私钥或构建产物。
- 用户可见文案同时维护 en-US 和 zh-CN。
- 新 Schema、公共 API、权限或 Agent Tool 变更必须同步迁移、回滚验证、OpenAPI、ADR 或权限声明。

## 本地验证

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
```

原生构建需要额外的 Rust、Android SDK/NDK/JDK；请使用项目文档说明的本地工具链，不要把工具链目录提交到仓库。

## Pull Request

说明变更范围、架构层、测试命令和未运行的验证。涉及安全、权限、数据迁移、部署或更新机制的改动必须明确风险和回滚方案。
