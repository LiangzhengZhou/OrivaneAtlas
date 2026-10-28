# ADR 0138：真实笔记文件夹（稳定 ID、parentId、成员关系）

日期：2026-10-26。状态：已实施（模型/持久化/同步/API/UI 已落地；工作区导入合并、文件夹删除恢复与完整验收未完成）。

## 背景

ADR 0014 用 `organization.folder` 自由文本表示笔记/日记的分组。文本没有稳定身份，无法表达空文件夹、重命名和层级，也无法安全地在设备之间同步目录结构。用户要求把文档/文件中心建立在真实文件夹上，而不是伪 Note 或仅加一个 UI 下拉框。

## 决策

1. 文件夹是 `organization` 集合中的一等实体：`kind = "FOLDER"`，行主键仍是 `(workspaceId, kind, id)`、`id` 为调用方生成的稳定 UUID、载荷带 `version`、`archived`、`updatedAt`、`updatedBy`。不新增表、不新增 collection、不引入伪 Note；SQLite/PostgreSQL 的 `organization.kind` CHECK 增加 `FOLDER`（SQLite v43、PostgreSQL 0038），IndexedDB 走既有通用组织记录。
2. 字段语义：
   - `FOLDER.name`：显示名，1..80 字符、trim 后非空、禁止控制字符；
   - `FOLDER.parentId`：父文件夹稳定 ID，`""` 表示顶层；
   - `NOTE.folderId`：笔记成员关系，`""` 表示未分类；
   - `NOTE.folder`：仅保留给旧版文本分组，新写入的移动操作写 `folderId` 并清空 `folder`；读路径对旧行按原文本展示。
   - `WORK` 行不带上述新字段。
3. 全部目录变更走现有 `OrganizationService.apply` 与 `/api/organize`：同一事务、同一 `work:update` / `work:delete` 授权、实体版本（笔记/任务）与组织版本双重 CAS、批量上限 100、Activity/Outbox 同事务、幂等回执与 guarded replay 全部沿用。新增动作：
   - `FOLDER create`（`id`+`name`+`parentId`，version 从 1 开始）；
   - `FOLDER rename`（entries 携带文件夹组织版本 + `name`）；
   - `FOLDER move`（entries + `parentId`，拒绝移入自身或后代，深度上限 8）；
   - `FOLDER delete`（entries；软删除 `archived = true`，仅允许空文件夹，含已删除笔记的引用也视为非空，避免恢复后悬空）；
   - `NOTE move` 增加 `folderId`（保留旧 `folder` 文本形式兼容旧客户端）。
4. 旧文本分组不做静默数据改写：UI 将 `folder` 文本显示为旧版分组节点，并提供显式“转换为文件夹”操作（逐组创建 FOLDER 再按 `folderId` 移动笔记，每条仍走应用服务与同步回执）。转换不是全库迁移，可中断、可重跑。
5. 读模型：`/api/snapshot` 与本地快照的 `organization` 数组直接包含 FOLDER 行；同步变化仍以 `organization` collection、`kind:id` 复合键上传/拉取（`workspace_change`、Outbox、ACK、receipt 不变）。`requireCanonicalOrganization` 增加 FOLDER 形状校验，replay effect id 接受 `FOLDER:<uuid>`；客户端不得绕过应用服务直接写行。
6. 删除笔记仍触发既有组织关系清理（`purgeRelations`），只按 `kind:id` 删除对应组织行，不级联删除文件夹。工作区隔离、principal、CAS、Workspace Revision 与备份容器语义不变。
7. 不在本轮引入文件夹排序字段、跨工作区移动、文件夹级权限或文件夹级 AI 上下文。文件夹名允许重名；创建时若同父同名活动文件夹存在则复用，避免重复目录。

## 影响

- 需要 schema migration（SQLite/PostgreSQL CHECK），迁移会自动创建旧库快照备份；有迁移测试验证 42→43 保留 WORK/NOTE 行并允许 FOLDER。
- API 契约扩展 `/api/organize`（文档 + OpenAPI 双别名同步），旧请求保持可用。
- 工作区导入/合并路径对 FOLDER 行尚未完整回放，遇到时 fail-closed 并记录为未完成项；不得声称目录可跨账户合并。
- 旧文本分组在转换前继续可见、可移动出组，不能声称已自动迁移。
