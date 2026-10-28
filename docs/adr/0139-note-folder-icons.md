# ADR 0139：笔记与文件夹的展示图标（emoji）

日期：2026-10-26。状态：已实施（仅展示元数据；不改变正文、同步协议、权限或文件字节）。

## 背景

文档列表与文件夹树当前统一使用内置书本/文件夹图标，用户无法为文档选择更直观的个性化标识。用户要求“文档前面的表示能自定义选择 emoji”。需求属于展示元数据，不应进入 Markdown 正文，也不应引入任意 HTML/SVG/脚本或新的文件系统路径。

## 决策

1. `organization` 行新增可选 `icon` 字段（载荷 JSON，无 SQL 迁移）：`NOTE` 与 `FOLDER` 可使用，值为 0–16 个 Unicode 码点的可见字符（emoji），空字符串表示恢复默认图标；拒绝控制字符与纯空白。`WORK` 行不接受图标。
2. 修改仍走现有 `organization.apply` 命令与 `/api/organize` 事务：新增 `action = "icon"`，沿用 `work:update` 授权、实体版本 + 组织版本双 CAS、批量 100、Activity/Outbox、幂等回执与 guarded replay。首次为尚无组织行的笔记设置图标时使用 `organizationVersion = 0`（与既有 move 创建行一致）。文件夹图标沿用 FOLDER 行的组织版本。
3. 快照/同步不回退：`organization` 仍以 `kind:id` 复合键增量同步；`requireCanonicalOrganization` 校验 `icon` 形状，回放 effect 仍为 `FOLDER:<uuid>` / `NOTE:<id>`。旧客户端数据没有 `icon` 字段时按默认图标显示。
4. UI 只提供受控 emoji 选择器（预置常用图标 + 自定义输入 + 恢复默认），不执行用户输入的任何代码，不写入文件名或路径。图标展示复用列表、图标视图、文件夹树的现有尺寸样式；不改变行高逻辑。
5. 图标属于展示元数据，不进入 Markdown 正文、搜索正文、导出 Markdown 或文件哈希；内容快照/备份容器按现有组织集合自然包含 `icon`。工作区导入/合并对 `icon` 的重放暂未覆盖，与 FOLDER 行一起记录为未完成。

## 影响

- `/api/organize` 的 action 枚举与请求体新增 `icon`，OpenAPI 双别名同步；旧请求保持可用。
- 无 schema/IndexedDB 版本变化；迁移行为不变。
- 批量/选择模式仍由 UI 本地状态控制，与图标无关。
