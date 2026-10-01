# Project workspace — Orivane Atlas 2.0

## Navigation and knowledge

Open Projects and select a project. Navigation is **Overview / Tasks / Knowledge**.
Overview renders the original Markdown brief and project/subproject summary.
Tasks lists scoped task memberships; direct/subtree scope and task dependencies
remain separate from project hierarchy. Knowledge creates or links spaces explicitly.

Owned spaces belong to the project; linked spaces refer to existing knowledge.
An owned space can be Primary. Inherited spaces come from project ancestors under
binding policy. Unlinking a space does not delete its documents or revisions.
Create a document in a selected project space; its Markdown, aliases, revisions
and same-Space hierarchy belong to that knowledge boundary.

Search, Wiki autocomplete, Knowledge Graph and Assistant retrieval share scope
ordering: current Space → Primary Owned → other Owned → Linked → Inherited →
workspace fallback. Wiki links support persistent aliases and backlinks; unresolved
targets can resolve when a matching live document appears. Rename preserves the
old title as an alias subject to collision rules.

## Graphs and editing

Project Dependency Graph defaults to Task → Task within the selected scope.
Knowledge Graph is separate and supports local, space and workspace scopes.
The old standalone graph/document/timeline/activity tabs are consolidated; no
legacy GraphCanvas or graph inspector dropdown is maintained.

Project parent selection uses the searchable hierarchical picker and rejects
invalid moves. DocumentWorkspace supports source/preview/reading, revisions,
diff/merge and Wiki navigation. Document parents must be live DOCUMENTs in the
same Space; self/cycles are rejected. Move changes the parent, rename preserves
hierarchy, and a parent with live children cannot be deleted.

Task fields and prerequisites save atomically; stale versions report conflicts.
Task execution status and activation remain distinct. Tasks/Board execution views
show activated work; planning/manage-inactive views retain inactive tasks.
Workspace timezone controls date eligibility without rewriting existing dates.

## Shell and Assistant

Light / Dark / Follow system and density preferences are retained. Sidebar collapse,
mobile navigation, Command Palette and Undo use the unified Shell. Atlas Assistant
uses the actual active document tab and project scope, then displays server-loaded
version-bound context for approval. Streaming and conversation continuation use
the real Gateway/AgentSession APIs; proposed edits require explicit application.

## 中文使用说明

项目导航统一为“概览 / 任务 / 知识”。知识页显式创建专属空间或链接已有空间；
专属空间可设为主要空间，祖先绑定按策略继承。解除链接不删除文档或历史版本。
搜索、Wiki 补全、知识图谱与 Assistant 检索共用相同范围优先级。

项目依赖图默认仅显示范围内任务之间的关系，知识图谱独立显示文档/Wiki 关系。
父项目使用层级选择器；文档父级必须为同一空间的有效文档，拒绝循环，移动可以
修改父级，重命名保留层级和旧标题别名。存在有效子文档时不允许删除父文档。

任务激活与执行状态保持独立，未激活任务在规划/管理视图保留。Assistant 按当前
活动文档和项目范围检索，审批后发送；结果不会自动改写正文。UI 语言不改变用户内容。
