# ADR 0141：工作区合并/导入回放文件夹与展示图标

日期：2026-10-26。状态：已实施（规划、物化、导入步骤与真实浏览器导入验证完成；跨账户回滚恢复沿用既有导入日志）。

## 背景

ADR0138/0139 新增 `organization.kind = "FOLDER"`、`NOTE.folderId` 和 `icon` 后，工作区合并/导入仍假定 organization 行只对应 WORK/NOTE 业务实体：FOLDER 行会因找不到实体而 fail-closed，`folderId` 与 `icon` 也不会被重映射或回放。用户要求修复 FOLDER/icon 的合并导入回放，而不是静默丢弃。

## 决策

1. **合并选择**：organization 行按 kind 分支：
   - FOLDER COPY 时把分配到的稳定 UUID 作为自身身份，mapping 目标为 `FOLDER:<uuid>`；USE_REMOTE 保持远端 `FOLDER:<id>`；
   - COPY 的 FOLDER 行把自身 `id` 与 `parentId` 作为引用重映射到目标文件夹 ID；父文件夹未选择时 fail-closed；
   - NOTE 行的 `folderId` 在 COPY 时重映射到目标文件夹 ID，未选择文件夹时 fail-closed；旧文本 `folder` 仍按原逻辑保留；
   - 图标作为 payload 字段随行复制，不产生额外引用。USE_REMOTE 行保持远端内容不变。
2. **物化**：`materializeWorkspaceMergeCopies` 的引用目标校验额外接受文件夹裸 ID（`FOLDER:<id>` 的目标身份），organization 行仍以业务 id 字段写入重映射结果。
3. **导入步骤**：`planWorkspaceImportSteps` 先按父级拓扑顺序创建活动文件夹（`/api/organize` create，稳定 id/name/parentId），再回放文件夹图标；软删除（archived）文件夹不重建；随后按既有顺序恢复 NOTE/WORK：NOTE 优先用 `folderId` 移动，旧文本 `folder` 继续兼容，最后回放 `icon`（组织版本按是否先执行移动取 0/1）。归档文件夹成员或缺失父级一律在规划阶段 fail-closed。
4. **不变式**：仍走既有 Application/HTTP 契约（`/api/organize` 的 create/icon/move），沿用服务端授权、CAS、Activity/Outbox 与导入日志/收据；不新增导入通道、不改备份容器、不静默覆盖目标内容。

## 影响

- 备份导入/账户合并现在能携带文件夹层级、成员关系与 emoji 图标；此前遇到 FOLDER 行会整体失败。
- 旧文本分组仍按文本回放，不做隐式迁移；文件夹排序字段/跨工作区移动仍不在范围内。
- 真实浏览器导入用例覆盖：本地创建文件夹+文件夹内笔记+文件夹/笔记图标 → 合并预览全选复制 → 导入新账户工作区 → 目标快照校验文件夹 `parentId`/图标、笔记 `folderId`/图标。
