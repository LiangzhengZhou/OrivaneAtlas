# Orivane Atlas v2.0.1

Interaction Consistency & Product Cleanup brings the existing 2.0 platform into
one consistent workflow.

## Changes

- Project and Document selectors share current-level drill-down, breadcrumbs,
  selected chips and current-level search across editors, filters and AI scope.
- Sidebar collapse and expand controls stay in the Sidebar. Document menus work
  on desktop and mobile; the mobile Atlas composer stays above bottom navigation.
- Atlas opens conversations with visible context, durable sessions, structured
  approvals and a sticky composer. Provider settings and Activity live in Settings.
- Notes and Journal can link to Spaces, promote to Wiki Pages and create Wiki
  references/backlinks while preserving Markdown, policy and provenance.
- Project Knowledge distinguishes owned, linked and inherited Spaces from
  references. Create Page opens DocumentWorkspace; implicit Space creation is removed.
- Entity/action pending, optimistic Task status rollback and incremental cursor
  responses avoid global editing locks and unnecessary client replacement.
- Browser authenticated SSE supports streaming with native polling fallback.
  Graphs use contextual scope, Space clusters and optional external blockers.
- Old Knowledge/dependency bookmarks redirect to the current workspace. Dead
  editors and duplicate hierarchy selectors are removed.

## Upgrade and validation

No new schema migration is introduced. Upgrade the matching self-hosted server
before updating clients: v2.0.1 adds Note promotion/linking and streaming/sync
endpoints. This GitHub release does not deploy or modify your server.

Local lint, type checks, tests, build and full check pass: 533 tests pass with
one existing fixture skipped. Full desktop English/Chinese and mobile Chinese
E2E for the interaction implementation passed 177/177 without failures, skipped
tests or flaky results before the metadata-only version bump. Cargo check
and release-profile tests pass with one strict-host fixture ignored. Native
packages use the existing Android production certificate and Windows updater key.

Windows updater signing is not Authenticode. Installed-app upgrade and physical
Android-device acceptance remain unverified. Native streaming uses polling
fallback; browser SSE events are transient, and the server still constructs an
authoritative snapshot for incremental transport.

## 中文说明

本版本统一项目/文档层级选择、Sidebar、Atlas 对话与知识入口。笔记和日记可关联
知识空间、提升为 Wiki 页面并产生引用及反向链接，原 Markdown、权限策略和来源
保持不变。任务操作按实体独立等待，支持乐观状态失败回滚、增量传输及浏览器流式响应。

没有新增数据库迁移。客户端更新前请先升级匹配的自托管服务器；本次 GitHub
发布不自动部署服务器。Windows 更新签名不等同于 Authenticode；覆盖安装与
Android 物理设备仍未验收。
