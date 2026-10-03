# Orivane Atlas v2.0.2

Product Hardening & UX Upgrade.

## Changes

- Root-only lazy Project tree, indexed progress, collapsed Sidebar floating menus and dirty-safe outside dismissal.
- Permanent Trash deletion for Work, Notes and Library with authorization/version/workspace guards; soft deletion uses Undo. Spaces with remaining documents must be emptied explicitly.
- Recurring Tasks entry in Tasks, ACTIVE/PAUSED/ENDED states, immutable occurrence expiry, end-of-day/next-occurrence/duration close policies and automatic missed-task closure.
- Today, last seven calendar days and current natural month statistics use occurrences; streak and backfill remain available.
- Expanded graphs retain selection and viewport; Settings dividers and Navigation reorder simplify interaction.
- Snapshot-based Library, bounded AI Activity reads, derived Task/Project/Library indexes and identity-isolated persistent picker Recent.
- App concerns extracted into workspace sync, Settings, Trash and Tasks routes.
- Platform-neutral notification planner with opt-in Windows scheduled toast and Android WorkManager adapters. Generic notification labels exclude task bodies and titles.

## Upgrade and validation

Upgrade the matching self-hosted server before clients. SQLite upgrades to schema26 and PostgreSQL to schema19 with verified backup/restore gates. Legacy recurrence defaults are ACTIVE / END_OF_DAY / closeIncomplete=true; legacy paused definitions are migrated to PAUSED. This release does not deploy your server.

Product validation: lint/typecheck/test/build/check passed, 555 tests passed and one fixture skipped. Full desktop English/Chinese and mobile Chinese E2E passed 198/198, with no failures, skips or flaky results. Rust tests passed18 with3 opt-in/fixture ignores; the real Windows scheduling test separately verified queue retention after the scheduling process exited and cancellation. Android JVM6/6 and arm64 Rust builds passed.

Windows updater signatures are not Authenticode. Visual toast, installed-app upgrade/uninstall and Android physical-device notification/permission/reboot/timezone acceptance remain unverified. WorkManager reminders are subject to Doze, and Windows delivery is subject to platform power-off limits. Scheduling is limited to the earliest256 intents within the planner horizon; remote changes while the app is closed may leave an existing generic reminder until reconciliation.

## 中文说明

本版本完成项目懒渲染、折叠Sidebar浮层、dirty编辑器保护、回收站永久删除、周期任务状态与到期关闭、三窗口统计、图谱展开、Settings排序、轮询清理和Recent隔离持久化。

SQLite迁移至26、PostgreSQL至19；更新客户端前请先升级匹配服务器并保留备份。本次GitHub发布不会部署服务器。Windows和Android通知适配器已实现，但实体设备送达、覆盖安装等验收边界如上，不将编译或mock测试视为设备验收。
