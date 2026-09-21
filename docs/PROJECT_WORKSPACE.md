# Project workspace

## Current interaction model

Project settings, lifecycle and Markdown brief use independent editing contracts. DIRECT scope includes the selected project's owned work; SUBTREE also includes descendant ownership. Task references are shown separately. Project URLs restore project, tab and scope through refresh and browser history.

Parent settings now include a searchable, expandable tree with invalid moves disabled, plus the existing path selector. Graph nodes open Inspector on click and the editor on double-click; the accessible selector offers the same inspection. Inspector supports task status, project categories, settings, workspace navigation and archive/trash actions. New dependency Activity retains endpoints after removal; old missing endpoint history cannot be reconstructed.

Task creation/editing saves prerequisites atomically with fields. Stale prerequisite sets produce a conflict. Availability previews Ready, Waiting for a date, Blocked by dependencies and manually Paused. Tasks use compact rows; Board retains cards.

Settings includes Light / Dark / Follow system and Comfortable / Compact density. Workspace timezone is persisted with optimistic versions; an empty override inherits the host. Task date eligibility, Today, Calendar and new Journal dates share the effective zone. Existing dates and recurrence zones do not change. Phones have a bottom bar for Tasks, Projects, Calendar, Notes and More; More exposes the full menu.

### 当前交互

项目设置、生命周期与 Markdown 说明独立保存。DIRECT 只统计当前项目，SUBTREE 包括后代归属；引用任务另列。URL 保存项目、标签页与范围。父级选择支持搜索、展开、非法移动禁选及路径选择。

图上单击节点或使用选择框查看详情，双击编辑。详情面板支持任务状态、项目分类、设置、工作区导航及归档/回收站操作。新增依赖活动在删除边后仍保留端点，不虚构旧历史。任务前置依赖与字段同事务保存，并发集合变化报冲突；可执行、等待日期、依赖阻塞与手动暂停为派生状态。

设置支持深浅主题、跟随系统及舒适/紧凑密度。工作区时区在服务器持久化并纳入数据库备份，留空继承宿主；不重写已有日期或周期时区。手机底栏提供任务、项目、日历、笔记与更多，更多包含完整导航。

## Workspace sections

Open **Projects**, then select a project's title to enter its workspace.

- **Overview** renders the original Markdown brief. Use **Edit project brief** to update the purpose, scope, outcomes and milestones.
- **Documents & references** links existing notes, documents and knowledge spaces. Open a linked entry to edit it in the document workspace. Removing a reference leaves the source and its history intact. Create new source material in Notes or Library first.
- **Subprojects** lists children or descendants according to scope. **New subproject** preselects this project as its parent; the parent button navigates back up. Existing hierarchy validation and the 16-level limit apply.
- **Tasks** includes owned tasks according to scope, with linked references listed separately. **New task** assigns the current project as owner.
- **Dependency graph** shows subtree tasks and connected external tasks. The accessible list supports creating and removing dependencies; normal cycle validation still applies.

The workspace separates project-owned documents/files from linked material. Owned Markdown keeps revisions and provenance; files are authenticated, soft-deletable project materials. Timeline and activity tabs combine scheduled descendant tasks with durable project/work events. Project hierarchy and task dependencies are separate relationships.

On desktop, the top toolbar button collapses navigation to labeled icons and remembers the preference. On phones, the button beside the logo or More in the bottom bar reveals the full navigation menu. These are local UI preferences, not shared project settings.

## Task activation and execution status

Tasks defaults to activated, unfinished tasks (To do / In progress). Choose All, Done or Canceled in the status filter to inspect activated history. Board shows only activated tasks across all four status columns. Inactive tasks never appear in these two execution views, even through search or archive filters.

Use **Task planning** or **Manage inactive tasks** to find and edit active/inactive tasks, including unassigned work. Activation is independent of execution status: a manual-active task may still be blocked by a prerequisite. Scheduled work becomes active on its start date in the effective workspace timezone; dependency-driven activation uses the existing prerequisite-completion rule. Inactive tasks are retained, not deleted or archived.

## 中文使用说明

在“项目”页点击项目标题，进入项目工作区：项目说明、文档与资料、子项目、任务、依赖有向图。

“新建子项目”和“新建任务”会预选当前项目。子项目可继续嵌套，上级项目按钮用于返回；现有循环校验与最多 16 层限制继续生效。任务列表递归汇总并去重，依赖图保留相连的项目外任务，显示外部阻塞。

资料可关联已有笔记、文档和知识空间，也可在项目内创建专属 Markdown 文档或上传文件。专属资料保留正文、版本、来源和软删除；解除外部关联不会删除源正文。时间线显示子项目任务日期，活动记录资料与工作项变更。

桌面顶部工具栏按钮收起/展开图标侧栏并记住偏好；手机 Logo 旁的按钮独立控制顶部导航，不受桌面折叠状态影响。

任务页默认仅显示已激活且未完成（待办/进行中）的任务；状态筛选可查看已激活的完成/取消历史。看板只显示已激活任务，保留四个执行状态列。未激活任务即使通过搜索或归档筛选，也不会进入这两个执行视图。

在“任务规划”或“管理未激活任务”中管理全部激活状态，未归属项目的任务也可找到。打开任务可编辑激活状态/策略。手动激活与依赖阻塞是不同概念；定时任务从有效工作区时区的指定日期生效，依赖策略按已有完成规则激活。未激活不会删除或归档任务。
