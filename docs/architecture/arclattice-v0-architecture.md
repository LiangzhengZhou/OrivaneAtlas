# ArcLattice — Personal OS v0 Architecture Specification

> Status: Draft / Architecture Baseline  
> Purpose: 作为项目的 v0 架构规范，供人类开发者与 AI Agent 共同推进实现。  
> Working name: **ArcLattice**  
> Naming status: provisional working name; complete trademark/domain/package-name checks before public branding.  
> Product direction: Markdown-first、Local-or-Server、AI-native、Open Source 的 Personal OS。

---

## 1. 产品定义

本项目不是单纯的 Todo、Trello、Notion 或 AI Chat 应用，而是一个统一的 **Personal OS / Human + AI Work System**。

系统需要同时覆盖：

- 个人任务与 Todo 管理
- 项目管理
- Board / Trello 风格视图
- Work Graph / 任务依赖图
- 日记
- Markdown 文档
- 笔记 / Wiki / Backlink
- 书籍、电影、论文等 Collection
- Knowledge Graph
- AI Agent 任务创建、项目规划、任务分配与执行
- Local-only 使用
- Linux Server 自托管
- Web / Windows EXE / Android APK
- 后续多人协作
- 对外 REST / MCP / Webhook 接口
- GitHub 开源与自动发布
- 中文 / English 双语 UI，并支持运行时切换

核心理念：

```text
Knowledge
   ↓
Work
   ↓
Human / Agent
   ↓
Result
   ↓
Knowledge
```

系统不把 AI 当作聊天窗口，而是把 AI Agent 当作真实的系统 Actor。

---

# 2. 核心架构原则

## 2.1 Markdown First

Markdown 是文档正文的 Source of Truth。

数据库可以保存结构化 Metadata、关系、属性、索引、版本信息，但正文必须能够稳定导入/导出为 Markdown。

禁止仅使用私有富文本 JSON 作为唯一文档格式。

目标：

```text
Runtime:
Database

Portable Format:
Markdown + Front Matter + Attachments
```

---

## 2.2 Local or Server

系统正式支持两种运行模式：

```text
LOCAL
REMOTE
```

### LOCAL

适用于：

- Desktop
- Android
- 后续 Web Local

特点：

- 不要求注册
- 数据保存在本机
- SQLite
- 本地附件目录
- AI Credential 存 Secure Storage
- 默认不依赖服务器

### REMOTE

适用于：

- Web
- Desktop
- Android

特点：

- 登录服务器
- PostgreSQL 为 Source of Truth
- 支持账户、Workspace、多人、Agent 身份
- Server Worker 运行长时间 Agent
- 支持自托管 Linux Server

V1 不实现完整 Local ↔ Server 双向同步。

后续如增加：

```text
SYNCED
```

应单独设计 Sync Engine。

---

## 2.3 UI ≠ Domain ≠ Storage ≠ Agent Runtime

强制保持以下边界：

```text
UI
 ↓
Application
 ↓
Domain
 ↓
Ports / Interfaces
 ↓
Adapters
```

禁止 UI 直接操作数据库。

禁止 Agent 直接操作数据库。

禁止 Domain 直接依赖 React、Tauri、NestJS、OpenAI、SQLite 或 PostgreSQL。

---

## 2.4 Human 与 AI 统一身份模型

所有能够产生系统操作的 Actor 统一为：

```text
Principal
```

Principal 类型：

```text
USER
AGENT
SERVICE
```

例如：

```text
You                USER
Planning Agent     AGENT
Coding Agent       AGENT
GitHub Bot         SERVICE
```

所有创建、修改、删除、Agent Run、Graph 操作必须能够追溯到 Principal。

---

# 3. 推荐技术栈

## Frontend

```text
React
TypeScript
Vite
TanStack Router
TanStack Query
Zustand
Tailwind CSS
shadcn/ui
Base UI
Lucide
```

## Cross-platform

```text
Tauri 2
```

目标：

```text
Web
Windows EXE / MSI
Android APK / AAB
```

未来可扩展：

```text
macOS
Linux Desktop
iOS
```

---

## Markdown

```text
Milkdown
CodeMirror 6
remark
rehype
micromark
KaTeX
Mermaid
```

编辑模式：

```text
Live Editing
Source Mode
Preview Mode
```

---

## Work Graph

```text
@xyflow/react
ELK.js
```

React Flow 只负责渲染，不作为数据模型。

---

## Backend

```text
NestJS
Fastify
REST
OpenAPI
SSE
WebSocket（需要时）
```

---

## Storage

Local:

```text
SQLite
```

Server:

```text
PostgreSQL
```

Search:

```text
SQLite FTS5
PostgreSQL FTS
pg_trgm
pgvector
```

Files:

```text
Local Filesystem
S3-compatible Adapter
```

---

## Async / Worker

```text
Valkey
BullMQ
```

后续复杂 Durable Workflow 可以考虑：

```text
Temporal
```

但 v0 不依赖 Temporal。

---

## Deployment

```text
Docker Compose
Caddy
PostgreSQL
Valkey
Application Server
Worker
```

镜像发布：

```text
GitHub Container Registry
```

---

## CI/CD

```text
GitHub Actions
GitHub Releases
GHCR
Tauri Updater
Android APK/AAB
```

---

# 4. Monorepo

推荐：

```text
personal-os/

apps/
  app/
  web/
  server/
  worker/

src-tauri/

packages/
  domain/
  application/

  api-schema/
  api-client/

  storage/
  storage-sqlite/
  storage-postgres/
  storage-http/
  storage-web/

  agent-protocol/
  agent-core/
  agent-sdk/
  mcp-server/

  editor/
  graph/
  ui/
  i18n/
  shared/

infra/
  docker/
  caddy/
  postgres/
  valkey/

docs/
  architecture/
  adr/
```

工具：

```text
pnpm workspace
Turborepo
```

---

# 5. 核心领域模型

## 5.1 Workspace

Workspace 是所有业务数据的顶层租户边界。

核心业务实体必须携带：

```text
workspace_id
```

Server 模式下任何查询都必须在 Workspace Context 中执行。

禁止只通过对象 ID 获取跨租户实体。

推荐逻辑：

```ts
getWorkItem(workspaceId, workItemId)
```

而不是：

```ts
getWorkItem(workItemId)
```

---

## 5.2 Object

Object 是知识系统的通用实体。

示例：

```text
Page
Book
Person
Note
Journal
Custom Object
```

Object 可拥有：

- title
- icon
- cover
- parent
- tags
- properties
- relations
- document
- attachments

---

## 5.3 Document

文档正文必须保存 Markdown。

概念模型：

```text
Document
  id
  workspace_id
  object_id
  content_md
  revision
  created_at
  updated_at
```

同时支持：

```text
DocumentRevision
```

AI 大范围修改文档前后必须保留 Revision。

---

## 5.4 Collection

Collection 用于构建用户自定义数据库。

例如：

```text
Books
Movies
Papers
Games
People
Travel
```

Collection 支持：

```text
Table View
Board View
List View
Gallery View
Calendar View
Timeline View
```

系统核心字段使用 Typed Extension。

用户自定义字段使用 Dynamic Property。

避免所有数据完全 EAV 化。

---

# 6. Work System

## 6.1 WorkItem

Task 不是唯一核心对象。

统一抽象：

```text
WorkItem
```

类型：

```text
GOAL
PROJECT
EPIC
TASK
MILESTONE
DECISION
AI_JOB
REMINDER
```

建议字段：

```text
id
workspace_id
project_id

type
title
description

status
priority

assignee_principal_id

execution_mode
automation_policy
approval_policy

start_date
start_at
due_date
due_at
timezone

version

created_by
updated_by

created_at
updated_at
completed_at
deleted_at
```

核心 ID 推荐：

```text
UUIDv7
```

---

## 6.2 Execution Mode

```text
MANUAL
AI
AUTOMATIC
HYBRID
```

语义：

```text
MANUAL
人执行

AI
Agent 执行

AUTOMATIC
系统自动化执行

HYBRID
AI 执行 + Human Review
```

---

## 6.3 Work Edge

Work Graph 使用独立关系：

```text
WorkEdge
```

类型：

```text
BLOCKS
REQUIRES
CONTAINS
RELATED
PRODUCES
DERIVED_FROM
```

其中：

```text
BLOCKS
REQUIRES
```

参与 DAG 调度。

RELATED 不参与调度。

---

## 6.4 DAG

依赖型 Work Graph 必须防止 Cycle。

新建：

```text
u → v
```

之前检查：

```text
v → ... → u
```

是否已存在路径。

存在则拒绝。

任务 Ready 条件：

\[
Ready(v)
=
Status(v)=TODO
\land
\forall u \in Pred(v), Status(u)=DONE
\]

---

## 6.5 UI View 不等于数据模型

同一批 WorkItem 可以显示为：

```text
Todo
List
Board
Calendar
Timeline
Gantt
Graph
Today
Upcoming
```

Graph 是 Model，不要求用户日常都通过 Graph 操作。

---

# 7. Knowledge Graph

Knowledge Graph 与 Work Graph 分开建模。

用途：

```text
Note → Concept
Book → Author
Journal → Project
Concept ↔ Concept
Document → Source
```

Knowledge Graph 允许 Cycle。

关系示例：

```text
MENTIONS
REFERENCES
RELATED_TO
AUTHORED_BY
DERIVED_FROM
SUPPORTS
```

Knowledge 与 Work 可以互相连接。

例如：

```text
Research Note
    ↓ supports
WorkItem
```

或者：

```text
WorkItem
    ↓ produces
Document
```

---

# 8. Markdown 功能

第一阶段至少支持：

```text
CommonMark
GFM
Task Checkbox
Table
Footnote
Wiki Link
Tag
Code Block
KaTeX
Mermaid
Callout
Front Matter Import / Export
```

---

## 8.1 Markdown Checkbox 不等于正式 Task

例如：

```md
- [ ] 牙刷
- [ ] 充电器
```

默认只是文档内容。

仅在用户明确：

```text
Convert to Task
```

或者使用指定语法后，才生成 WorkItem。

---

## 8.2 Wiki Link

支持：

```md
[[Distributed Systems]]
```

建立：

```text
document_link
```

并提供：

```text
Backlinks
```

---

# 9. Journal

Journal 本质：

```text
Document
+
journal_date
+
template
```

必须使用：

```text
journal_date
```

而不是 timestamp 表示“哪一天”。

支持：

```text
Daily
Weekly
Monthly（后续）
```

AI 可以从 Journal 提议：

```text
Extract Tasks
Extract Ideas
Create Project
Link Existing Note
```

但默认不能无审批大规模修改用户内容。

---

# 10. 时间系统

必须区分：

```text
date
timestamp
timezone
```

例如：

```text
due_date
```

表示：

```text
2026-09-20
```

而：

```text
due_at
```

表示精确时间。

Timezone 使用 IANA：

```text
Asia/Tokyo
Europe/London
America/New_York
```

禁止用固定：

```text
UTC+9
```

代替 Timezone。

---

# 11. Recurring Task

周期任务不要重复修改同一个 Task。

模型：

```text
RecurringTemplate
   ↓
Occurrence
```

推荐使用 RRULE。

例如：

```text
FREQ=WEEKLY;BYDAY=SU
```

每次实例生成独立 WorkItem，保留完整历史。

---

# 12. Notification

Notification 抽象：

```ts
interface NotificationService {}
```

实现：

```text
In-App
Tauri Native
Email
Web Push
Mobile Push
```

事件来源：

```text
Task Due
Task Ready
Agent Completed
Approval Requested
Mention
Project Blocked
Recurring Task Generated
```

---

# 13. Account / Identity

## 13.1 Local Mode

Local Workspace 不要求账户注册。

可有：

```text
Local Profile
```

用于显示名称、头像和本地 created_by。

---

## 13.2 Server Mode

Server Mode 必须支持：

```text
Registration
Login
Logout
Session
Password Reset
Email Verification
Invitation
Workspace Membership
RBAC
API Token
Agent Credential
Audit Log
```

---

## 13.3 Registration Mode

服务器支持：

```text
OPEN
INVITE_ONLY
CLOSED
```

推荐默认：

```text
INVITE_ONLY
```

首次部署通过：

```text
/setup
```

创建 Instance Admin。

初始化完成后关闭 setup。

---

## 13.4 User 与 Principal 分离

User：

```text
真实的人类账户
```

Principal：

```text
实际执行操作的身份
```

例如：

```text
User
  ↓
UserPrincipal
```

Agent：

```text
Agent
  ↓
AgentPrincipal
```

Service：

```text
ServicePrincipal
```

---

## 13.5 Workspace RBAC

Instance Role：

```text
ADMIN
USER
```

Workspace Role：

```text
OWNER
ADMIN
MEMBER
GUEST
```

实际权限使用 Permission。

例如：

```text
project:read
project:create

work:read
work:create
work:update
work:delete

document:read
document:write

graph:read
graph:write

agent:run
agent:manage

member:invite
workspace:manage
```

最终：

```text
Role → Permissions
```

---

# 14. Authentication

推荐使用成熟认证库，不从零实现所有 Auth。

Domain 仍通过：

```ts
interface IdentityService {}
interface AuthorizationService {}
```

隔离具体认证实现。

V1：

```text
Email + Password
Email Verification
Password Reset
```

后续：

```text
Passkey
TOTP 2FA
GitHub OAuth
Google OAuth
OIDC
```

Self-hosting 应优先支持 OIDC。

---

# 15. Agent Architecture

AI Agent 是一级功能，不是插件式聊天功能。

Agent 可以：

```text
读取项目
读取 Work Graph
读取允许访问的文档
创建任务
修改任务
建立依赖
提出项目计划
分配任务
启动其他 Agent
提交 Artifact
更新执行状态
```

---

## 15.1 Agent 不允许直接操作数据库

禁止：

```text
Agent → SQL
```

必须：

```text
Agent
 ↓
Tool / API
 ↓
Application Service
 ↓
Permission / Validation
 ↓
Domain
 ↓
Repository
```

---

## 15.2 Agent Run

推荐模型：

```text
Agent
AgentDefinition
AgentRun
AgentRunEvent
AgentToolCall
AgentArtifact
AgentApproval
```

AgentRun 必须保留完整执行记录。

例如：

```text
RUN_STARTED
MODEL_REQUEST
MODEL_RESPONSE
TOOL_CALL
TOOL_RESULT
ARTIFACT_CREATED
APPROVAL_REQUESTED
APPROVAL_GRANTED
RUN_COMPLETED
RUN_FAILED
```

---

## 15.3 Agent Budget

每个 Agent / Run 可以配置：

```text
max_duration
max_model_calls
max_tool_calls
max_input_tokens
max_output_tokens
max_cost
```

超过预算：

```text
WAITING_APPROVAL
```

或者：

```text
FAILED_BUDGET_EXCEEDED
```

---

## 15.4 Execution Location

```text
LOCAL
SERVER
EXTERNAL
```

语义：

```text
LOCAL
在本地 App 执行

SERVER
Linux Worker 执行

EXTERNAL
外部 Agent 系统执行
```

移动端不得承诺 App 关闭后继续长期运行复杂 Agent。

---

# 16. AI Planning / ChangeSet

AI 大规模规划时禁止连续无审查地执行几十个 Mutation。

使用：

```text
ChangeSet
```

流程：

```text
Planner
 ↓
Generate ChangeSet
 ↓
Validate
 ↓
Preview
 ↓
Human Approval
 ↓
Atomic Apply
```

ChangeSet 可以包含：

```text
create_work_item
update_work_item
delete_work_item
add_edge
remove_edge
assign
create_milestone
create_document
```

Apply 前必须检查：

```text
Permission
DAG Cycle
Duplicate
Invalid Principal
Invalid Project
Version Conflict
Policy
```

整体尽可能事务执行。

---

# 17. Agent API

系统从第一版预留三种 Agent Integration：

```text
REST API
MCP
Webhook / Event
```

---

## 17.1 REST API

公开：

```text
/api/v1
```

使用：

```text
OpenAPI
```

目标后续自动生成：

```text
TypeScript SDK
Python SDK
```

---

## 17.2 MCP

Personal OS 自身提供 MCP Server。

Remote：

```text
Streamable HTTP
```

Local：

```text
stdio
```

建议 Tools：

```text
workspace.get_context

project.list
project.get

work.search
work.get
work.create
work.update
work.complete
work.assign

graph.get
graph.add_edge
graph.remove_edge

plan.propose
plan.apply

document.search
document.read
document.create
document.append

journal.read

agent.dispatch
run.get

artifact.create
```

禁止暴露：

```text
execute_sql
raw_database_access
```

---

## 17.3 MCP Resources

例如：

```text
personal-os://workspace/current
personal-os://projects/{id}
personal-os://projects/{id}/graph
personal-os://today
personal-os://documents/{id}
personal-os://journals/{date}
```

---

# 18. Agent Permission / AI Privacy

Agent 权限必须比普通 Workspace RBAC 更细。

例如：

```text
Research Agent

project:read
work:read
document:read
document:create
artifact:create
```

但不能：

```text
workspace:delete
member:manage
secret:read
```

---

## 18.1 AI Access Policy

个人知识内容必须允许用户控制是否提供给 Agent。

例如：

```text
Projects    ALLOW
Notes       ALLOW
Journal     ASK
Secrets     DENY
```

单个 Object 可以覆盖：

```text
INHERIT
ALLOW
DENY
```

Semantic Embedding 也必须遵守该策略。

设置为 DENY 的内容不得发送给外部 Model / Embedding Provider。

---

# 19. Prompt Injection

所有外部内容均视为：

```text
UNTRUSTED CONTENT
```

例如：

```text
Web Page
PDF
GitHub Issue
Imported Markdown
Email
External API Result
```

必须坚持：

```text
Content ≠ Instruction
```

模型在内容中读取到“删除所有任务”等文本，不改变工具权限。

Tool 权限由：

```text
Principal
Permission
Policy
Approval
```

决定。

---

# 20. Agent Sandbox

未来允许：

```text
Shell
Code Execution
Git
Filesystem
Network
```

时必须在独立 Sandbox 中执行。

不可：

```text
Agent → Main Server Shell
```

至少预留：

```text
CPU Limit
Memory Limit
Timeout
Filesystem Scope
Network Policy
Tool Scope
```

v0 可以不实现完整 Sandbox，但 API 不得绑定为主服务器任意 shell 执行。

---

# 21. Approval

高风险操作需要 Human-in-the-loop。

Tool 风险级别：

```text
READ
WRITE
DESTRUCTIVE
EXTERNAL
```

建议：

```text
READ
自动允许

WRITE
根据 Agent Policy

DESTRUCTIVE
默认审批

EXTERNAL
可配置审批
```

---

# 22. Event Architecture

必须区分：

```text
ActivityEvent
AuditEvent
OutboxEvent
```

---

## 22.1 ActivityEvent

面向用户：

```text
Agent created task
User completed task
Document updated
```

---

## 22.2 AuditEvent

面向安全：

```text
LOGIN
FAILED_LOGIN
TOKEN_CREATED
TOKEN_REVOKED
PERMISSION_CHANGED
AGENT_GRANTED_ACCESS
WORKSPACE_DELETED
```

AuditEvent 不允许普通用户任意修改。

---

## 22.3 OutboxEvent

用于可靠异步执行：

```text
TASK_READY
AGENT_DISPATCH
SEND_NOTIFICATION
INDEX_DOCUMENT
CALL_WEBHOOK
```

状态变化与 OutboxEvent 必须在同一 DB Transaction 中写入。

目标避免：

```text
数据库更新成功
Queue publish 失败
```

导致状态永久不一致。

---

# 23. Idempotency

所有外部 Mutation API 必须支持：

```text
Idempotency-Key
```

重点：

```text
work.create
graph.add_edge
plan.apply
agent.dispatch
artifact.create
```

Server 保存：

```text
key
request_hash
response
created_at
```

重复请求返回第一次结果。

---

# 24. Optimistic Concurrency

所有可多人/Agent 并发修改的重要实体使用：

```text
version
```

例如：

```text
version = 7
```

更新时：

```text
WHERE id = ? AND version = 7
```

成功后：

```text
version = 8
```

冲突：

```text
409 Conflict
```

避免 Human 与 Agent 相互覆盖。

---

# 25. Soft Delete / Trash

核心业务数据禁止默认物理删除。

使用：

```text
deleted_at
```

进入 Trash。

支持：

```text
Restore
Permanent Delete
```

未来 Sync 也可以使用 Tombstone 语义。

---

# 26. Document Revision

AI 或用户大范围修改 Markdown 时保存 Revision。

建议 Snapshot 时机：

```text
AI 修改前
AI 修改后
用户主动保存版本
较长间隔自动 Snapshot
重大结构变更
```

支持：

```text
Diff
Restore
Accept AI Change
Reject AI Change
```

---

# 27. Blob / Attachment

禁止简单存：

```text
attachment.path
```

抽象：

```text
Blob

id
sha256
size
mime_type
storage_key
created_at
```

再：

```text
Attachment

id
workspace_id
object_id
blob_id
filename
created_at
```

实现：

```text
LocalFilesystemBlobStore
S3BlobStore
```

支持：

```text
Checksum
Deduplication
Backup
Orphan Cleanup
```

---

# 28. Search

统一：

```ts
interface SearchService {
  searchText(...)
  searchSemantic(...)
}
```

Local：

```text
SQLite FTS5
```

Server：

```text
PostgreSQL FTS
pg_trgm
pgvector
```

Semantic Search 必须遵守 AI Access Policy。

---

# 29. Web Local

Web Local 可以后续使用：

```text
SQLite WASM
OPFS
```

但第一阶段定位：

```text
Experimental
```

优先级：

```text
Desktop Local      High
Android Local      High
Server Web         High
Browser Local      Medium
```

不要假设 Web SQLite 与原生 SQLite 在并发/锁行为上完全相同。

---

# 30. Backup 与 Export

必须拆开。

---

## 30.1 Human-readable Export

例如：

```text
workspace/
  journal/
  notes/
  projects/
  books/
  attachments/
```

文档：

```text
Markdown
```

属性：

```text
YAML Front Matter
```

目标：

```text
即使不再使用本软件，也能阅读主要数据。
```

---

## 30.2 Full Backup

用于灾难恢复。

必须完整保存：

```text
IDs
Objects
Documents
Relations
Work Graph
Collections
Properties
Views
Agent Definitions
Settings
Attachments
```

例如：

```text
personal-os-backup.zip

manifest.json
snapshot/
documents/
attachments/
```

---

# 31. Migration

Local SQLite 与 Server PostgreSQL 都必须正式支持 Schema Migration。

记录：

```text
schema_version
```

升级流程：

```text
Check Version
 ↓
Create Backup
 ↓
Run Migration
 ↓
Validate
 ↓
Start App
```

Migration 必须自动化测试。

---

# 32. Client / Server Compatibility

Server 提供：

```text
GET /api/meta
```

返回：

```json
{
  "serverVersion": "1.5.0",
  "apiVersion": "1",
  "minClientVersion": "1.3.0",
  "features": {
    "agentPlanning": true,
    "semanticSearch": false
  }
}
```

客户端使用 Capability Negotiation。

不能假设：

```text
Client Version == Server Version
```

---

# 33. Version Types

至少区分：

```text
Application Version
Server Version
API Version
Database Schema Version
```

不要混用一个版本号表达全部兼容关系。

---

# 34. Update

## Web

显示：

```text
New version available
Refresh now
```

---

## Windows

使用：

```text
Tauri Updater
GitHub Releases
Signed Update
```

支持：

```text
Check
Download
Install
Restart
```

---

## Android

支持两类：

```text
Google Play In-App Update
GitHub APK Update
```

APK 更新最终需要系统 Package Installer 与用户确认。

---

## Release Channel

建议：

```text
Stable
Beta
Nightly
```

---

# 35. Signing / Secret Management

以下内容绝不能进入公开 GitHub：

```text
Tauri Updater Private Key
Android Keystore
Production OAuth Secret
Encryption Master Key
SMTP Password
Production AI Key
```

必须建立安全离线备份。

---

# 36. Tauri Security

使用严格：

```text
CSP
Capabilities
Permissions
```

禁止默认授予：

```text
fs:*
shell:*
```

所有 Native Permission 最小化。

Markdown 渲染必须 Sanitize。

禁止执行：

```text
script
unsafe event handler
untrusted iframe
javascript: URL
```

---

# 37. Server Registration

Server Registration Mode：

```text
OPEN
INVITE_ONLY
CLOSED
```

默认推荐：

```text
INVITE_ONLY
```

---

# 38. Instance Admin

Server 提供独立 Administration。

至少包括：

```text
Users
Workspaces
Invitations

Registration

Authentication
SMTP

AI Providers

Storage
Backup

Security

System Version
Database Status
Worker Status
```

Instance Admin 与 Workspace Owner 权限必须严格分离。

---

# 39. SMTP

支持：

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
```

用于：

```text
Email Verification
Password Reset
Invitation
Notification
```

无 SMTP 时仍允许：

```text
Admin copy invite link
Optional email verification
Admin reset flow
```

确保自托管能低门槛启动。

---

# 40. Token

区分：

```text
User Session
Personal Access Token
Agent Credential
Service Credential
```

API Token 只在创建时展示明文一次。

数据库只保存：

```text
token_hash
```

支持：

```text
Scopes
Expiry
Last Used
Revoke
```

---

# 41. Realtime

V1 优先：

```text
SSE
```

事件：

```text
Task changed
Agent run update
Notification
Project update
Approval
```

多人实时文档编辑后续：

```text
WebSocket
Yjs
```

不要第一版就将所有系统数据 CRDT 化。

---

# 42. Local Secrets

Local 模式中的：

```text
OpenAI Key
Anthropic Key
Server Token
```

不得明文存在：

```text
localStorage
SQLite
plain config file
```

使用：

```text
Tauri Stronghold / Platform Secure Storage
```

Database 中只保存 credential reference。

---

# 43. Plugin / Extension Strategy

v0 不提供任意 JS 插件执行系统。

第一阶段扩展方式：

```text
REST
MCP
Webhook
Importer
Exporter
Provider Adapter
```

内部预留：

```text
ModelProvider
StorageProvider
NotificationProvider
AuthProvider
Importer
Exporter
AgentToolProvider
```

真正 Plugin SDK 后续设计。

---

# 44. Observability

Server：

```text
Structured Logs
Metrics
Tracing
Health Checks
```

Agent：

```text
trace_id
run_id
tool_call_id
```

链路：

```text
Task
 ↓
Outbox
 ↓
Queue
 ↓
AgentRun
 ↓
Model
 ↓
Tool
```

推荐：

```text
OpenTelemetry
```

自托管版本默认不上传用户内容或个人数据。

任何产品遥测：

```text
Opt-in
```

---


# 45A. Internationalization / Localization (i18n)

中英文切换属于 v0 基础能力，不作为后期补丁。

首批正式支持：

```text
zh-CN
en-US
```

后续语言必须能够通过新增 locale resource 扩展，而不修改 Domain。

---

## 45A.1 Frontend i18n

推荐：

```text
i18next
react-i18next
i18next-icu
```

所有用户可见 UI 文案使用稳定 key：

```text
common.save
common.cancel

nav.today
nav.projects
nav.journal

work.status.ready
work.status.blocked

agent.run.status.running
```

禁止在业务组件中大量硬编码：

```ts
"保存"
"Save"
```

资源结构建议：

```text
packages/i18n/
  src/
    locales/
      en-US/
        common.json
        navigation.json
        work.json
        agent.json
        settings.json
      zh-CN/
        common.json
        navigation.json
        work.json
        agent.json
        settings.json
```

模块应按领域拆分 namespace，避免单个超大型 translation 文件。

---

## 45A.2 Locale Resolution

语言优先级建议：

```text
Explicit User Preference
        ↓
Account / Local Profile Preference
        ↓
Device / Browser Locale
        ↓
Instance Default Locale
        ↓
en-US fallback
```

Local Profile：

```text
preferred_locale
```

Server User：

```text
preferred_locale
```

Instance Settings：

```text
default_locale
```

Workspace 可额外拥有：

```text
default_content_locale
```

但 Workspace Locale 不应强制覆盖用户 UI Locale。

---

## 45A.3 Runtime Language Switching

Settings 中提供：

```text
Language / 语言

System Default
English
简体中文
```

切换后应即时更新 UI，原则上不要求重启应用。

Tauri / Web / Android 使用同一套 locale resources。

---

## 45A.4 Date / Time / Number Formatting

UI 不应手工拼接日期格式。

使用：

```text
Intl.DateTimeFormat
Intl.NumberFormat
Intl.RelativeTimeFormat
```

Locale 与 Timezone 分离：

```text
locale:
zh-CN

timezone:
Asia/Tokyo
```

同一时间数据：

```text
2026-09-13T12:30:00Z
```

可根据用户 Locale / Timezone 正确显示。

禁止把：

```text
YYYY/MM/DD
MM/DD/YYYY
```

写死在业务逻辑。

---

## 45A.5 Backend Error Contract

REST / MCP / Agent Tool 不应把翻译后的字符串作为稳定 API Contract。

错误返回：

```json
{
  "code": "WORK_GRAPH_CYCLE_DETECTED",
  "params": {
    "fromId": "...",
    "toId": "..."
  }
}
```

客户端根据：

```text
code
```

进行本地化。

Server 可以附带开发调试 message，但 Client 不应依赖该文本判断逻辑。

---

## 45A.6 Server-generated Content

以下服务端生成内容需要支持 Locale：

```text
Email Verification
Password Reset
Workspace Invitation
Notification Email
System Email
```

模板建议：

```text
templates/
  email/
    en-US/
    zh-CN/
```

Server 在发送时根据 User Locale 选择模板。

Fallback：

```text
User Locale
 ↓
Instance Default Locale
 ↓
en-US
```

---

## 45A.7 User Content Is Not UI Translation

用户 Markdown、日记、任务标题、项目名称属于 User Content。

语言切换时：

```text
不自动翻译用户内容
```

例如：

```text
UI: English
Document: 中文
```

完全合法。

未来如加入 AI Translation，必须作为显式用户操作，并生成 Revision / Preview，而不是 i18n 系统的一部分。

---

## 45A.8 Localized Built-in Templates

系统内置内容需要支持本地化：

```text
Daily Journal Template
Weekly Review Template
Default Project Status
Onboarding Content
Empty-state Examples
Built-in Agent Descriptions
```

但内部稳定枚举保持语言无关：

```text
READY
BLOCKED
DONE
```

UI 再显示：

```text
READY → Ready
READY → 可执行
```

---

## 45A.9 Agent Language

Agent Definition 可以配置：

```text
preferred_output_locale
```

例如：

```text
zh-CN
en-US
AUTO
```

但 Agent Tool Schema、REST 字段、Event Type、Permission、Enum 等机器协议全部保持稳定英文 identifier。

例如：

```text
work.create
WORK_ITEM_CREATED
project:read
```

禁止根据当前 UI 语言改变 Tool 名称或 JSON 字段。

AI 对用户产生的自然语言输出可以根据 User Locale 自动选择语言。

---

## 45A.10 Search and CJK Considerations

中英文支持不仅是翻译 UI，还涉及搜索。

英文与中文不能假设使用完全相同的 Tokenization。

Local SQLite：

```text
FTS5
```

应验证：

```text
unicode61
trigram
```

等 tokenizer 对中文内容的实际效果。

Server PostgreSQL：

```text
PostgreSQL FTS
pg_trgm
```

基础安装不应强制依赖难部署的中文专用扩展。

v0 建议：

```text
Exact / Prefix / Substring
        +
pg_trgm fuzzy matching
        +
Semantic Search (optional)
```

后续如果中文全文检索质量需要提升，再通过 Search Adapter 增加：

```text
PGroonga
zhparser
Meilisearch
Typesense
其他独立 Search Provider
```

任何增强方案都不得改变 Domain API。

---

## 45A.11 UI Layout Rules

设计系统必须兼容不同语言文字长度。

禁止依赖：

```text
固定按钮宽度
固定 label 宽度
英文字符数假设
```

组件需支持：

```text
Text wrapping
Flexible width
Tooltip
Responsive layout
```

中文和英文都必须在：

```text
Desktop
Web
Android
```

进行视觉测试。

---

## 45A.12 Accessibility

i18n 与 Accessibility 一起处理。

要求：

```text
ARIA label 可翻译
Screen Reader 文案可翻译
图标按钮不能只依赖视觉含义
快捷键说明可本地化
```

---

## 45A.13 i18n Testing

CI 至少检查：

```text
Missing Translation Key
Unused Critical Key
Invalid ICU Message
Locale Resource Parsing
```

关键 E2E 流程分别至少跑：

```text
en-US
zh-CN
```

包括：

```text
Register / Login
Create Workspace
Create Task
Edit Markdown
Create Graph Edge
Agent Plan Preview
Settings
Update Flow
```

---

## 45A.14 i18n Definition of Done

任何新用户可见 Feature 必须同时满足：

```text
不存在硬编码核心 UI 文案
具有 en-US 文案
具有 zh-CN 文案
日期/数字使用 Locale-aware formatter
API 错误使用稳定 Error Code
布局在中文/英文下均不溢出
```

否则该 Feature 不视为完成。


# 45. Testing

必须包括：

```text
Unit Tests
Domain Tests
Repository Contract Tests
Integration Tests
API Tests
Migration Tests
E2E
```

Repository Contract Test 同一套行为测试至少运行：

```text
SQLite Repository
PostgreSQL Repository
Remote Repository
```

Graph 使用 Property-based Tests。

例如验证：

\[
DAG + validEdge \Rightarrow DAG
\]

以及：

\[
cycleEdge \Rightarrow Reject
\]

---

# 46. CI/CD

PR：

```text
Lint
Typecheck
Unit Test
Integration Test
Build Web
Build Server
```

Release Tag：

```text
vX.Y.Z
```

触发：

```text
Windows Build
Android Build
Server Docker Image
Web Docker Image
Checksums
Signatures
Release Notes
Updater Metadata
```

---

# 47. 开源策略

License 应在 Public Release 前确定。

候选：

```text
Apache-2.0
AGPL-3.0
```

如果目标是最大化商业二开：

```text
Apache-2.0
```

如果希望修改后作为网络服务提供时必须开放源码：

```text
AGPL-3.0
```

---

# 48. 推荐核心数据库实体

建议至少包含：

```text
instance_settings

user
identity_account
session
passkey
credential

principal
workspace
workspace_member
principal_permission
invitation

object
object_type
document
document_revision

property_definition
property_value

relation
document_link
tag
object_tag

collection
collection_field
collection_item
view

work_item
work_edge
recurrence_template

notification

blob
attachment

agent
agent_definition
agent_run
agent_run_event
agent_tool_call
agent_artifact
agent_approval

personal_access_token
agent_credential

activity_event
audit_event
outbox_event

idempotency_record
```

---

# 49. 核心接口

Domain / Application 至少定义：

```ts
interface ObjectRepository {}
interface DocumentRepository {}
interface WorkRepository {}
interface GraphRepository {}
interface CollectionRepository {}

interface BlobStore {}

interface SearchService {}

interface IdentityService {}
interface AuthorizationService {}

interface NotificationService {}

interface ModelProvider {}
interface AgentRuntime {}
interface ToolRegistry {}

interface EventPublisher {}
```

所有具体基础设施通过 Adapter 接入。

---

# 50. 第一阶段 UI 信息架构

Desktop Sidebar：

```text
Home

Inbox
Today
Upcoming
Calendar

Tasks
Projects
Graph

Journal
Notes
Library

Agents
Automations

Workspace
Settings
```

Project：

```text
Overview
List
Board
Timeline
Graph
Documents
Files
Agent Runs
Activity
```

Task Detail：

```text
Title
Description
Status
Priority
Due
Assignee

Dependencies
Subtasks

Agent
Runs
Artifacts

Comments
Activity
```

---

# 51. Command Palette

全局：

```text
Ctrl/Cmd + K
```

支持：

```text
Search
Navigation
Create
Command
Agent
AI Search
```

例如：

```text
Create Task
Open Today
Go to Project
Ask Research Agent
Search "DAG"
```

Command Palette 是核心交互入口之一。

---

# 52. Agent Planning UX

推荐交互：

```text
User:
规划 Personal OS Markdown 模块
```

AI 返回：

```text
Plan Proposal

+ 8 tasks
+ 11 dependencies
+ 2 milestones

Human: 4
AI: 4
```

支持：

```text
Graph Preview
Edit
Reject
Apply
```

Apply 后：

```text
Work Graph
```

真正产生 Task / Edge / Assignment。

---

# 53. Roadmap

## M0 — Foundation

完成：

```text
Monorepo
CI
Design System
Domain Skeleton
Tauri
Web Build
```

---

## M1 — Storage

完成：

```text
Repository Interfaces
SQLite
PostgreSQL
Migration
UUIDv7
Version
Soft Delete
```

---

## M2 — Knowledge

完成：

```text
Object
Document
Markdown Editor
Revision
Wiki Link
Tag
Backlink
```

---

## M3 — Work

完成：

```text
WorkItem
Todo
Project
Task Detail
Priority
Date
```

---

## M4 — Views

完成：

```text
List
Board
Calendar
Today
Upcoming
```

---

## M5 — Graph

完成：

```text
WorkEdge
DAG Validation
Graph View
Ready / Blocked
```

---

## M6 — Personal Management

完成：

```text
Journal
Recurring Tasks
Reminder
Collection
Library
```

---

## M7 — Server Identity

完成：

```text
Register
Login
Workspace
Invitation
RBAC
Admin
Token
```

---

## M8 — Agent Core

完成：

```text
Agent Principal
Agent Definition
Agent Run
Tool Registry
Approval
Budget
Artifact
```

---

## M9 — Agent Interfaces

完成：

```text
REST
OpenAPI
MCP
Webhook
ChangeSet
Plan Preview
```

---

## M10 — Search

完成：

```text
FTS
Global Search
Command Palette
Semantic Search
AI Access Policy
```

---

## M11 — Deployment

完成：

```text
Docker Compose
Caddy
GHCR
Backup
Restore
Health Check
```

---

## M12 — Distribution

完成：

```text
Windows Release
Tauri Updater
Android APK
Release Channel
Signing
```

---

## M13 — Collaboration

完成：

```text
Realtime
Comments
Mentions
Multi-user
Yjs
```

---

## M14 — Sync

最后再考虑：

```text
Local ↔ Server Sync
Conflict Resolution
Tombstone
Attachment Sync
Offline Mutation
```

---

# 54. 明确禁止的早期架构行为

项目 Agent 在开发过程中应遵守：

```text
不要让 UI 直接访问数据库。

不要让 Agent 直接执行 SQL。

不要让主服务器执行任意 Agent Shell。

不要把 React Flow 数据结构直接作为数据库模型。

不要把 Markdown 转成私有 JSON 后丢弃原文。

不要把 Markdown Checkbox 默认变成 WorkItem。

不要第一版实现完整双向 Sync。

不要把 User 和 Agent 当成同一种数据库实体。

不要用 created_by_user_id 替代 Principal。

不要把 Activity Log 当成 Security Audit Log。

不要忽略 Outbox 与 Idempotency。

不要把 API 与某个 AI Provider 绑定。

不要将 OpenAI/Claude 特有数据结构扩散进 Domain。

不要假设 Client 与 Server 永远同版本。

不要物理删除核心用户数据作为默认行为。

不要明文存储 Token / AI Key。

不要默认允许 Agent 读取所有 Journal / Personal Note。

不要把插件系统作为 v0 的主要开发目标。

不要为了统一 ORM 牺牲 SQLite/PostgreSQL 各自正确性。
```

---

# 55. Architecture Priority

如果出现时间压力，优先保证：

```text
1. Domain Boundary
2. Repository Abstraction
3. Migration
4. Identity / Principal
5. Work Graph
6. Markdown Portability
7. Agent API Boundary
8. Outbox / Idempotency
9. Backup / Restore
10. Security
```

可以暂缓：

```text
复杂动画
高级 Dashboard
插件商城
CRDT
完整 Sync
Temporal
高级 Analytics
复杂主题市场
```

---

# 56. 项目最终目标

该项目最终应能够支持如下工作流：

```text
Human 创建 Goal
      ↓
Planning Agent 读取 Knowledge + 当前 Work Graph
      ↓
Agent 生成 ChangeSet
      ↓
Human Review
      ↓
生成 Tasks / Dependencies / Assignments
      ↓
Human 与 AI Agent 并行执行
      ↓
Result / Artifact 写回
      ↓
Work Graph 更新
      ↓
新 Knowledge 产生
      ↓
后续 Planning
```

也就是：

\[
\boxed{
Knowledge
+
Work Graph
+
Human
+
AI Agent
}
\]

构成一个持续闭环。

---

# 57. v0 Definition of Done

v0 架构层完成的标准不是“页面能打开”，而是以下能力已经形成稳定边界：

```text
Web 能运行
Windows 能运行
Android 能构建

中文 / English 可在设置中即时切换

Local Workspace 可创建
Remote Workspace 可连接

Markdown 可编辑、保存、导出

Task / Project 可创建
Work Graph 可建立 DAG 依赖

Server 支持注册、登录、Workspace

Agent 拥有独立 Principal
Agent 可以通过受控 API 创建任务

Plan 可以 Preview / Apply

数据有 Migration
有 Backup
有 Trash
有 Revision

Server 有 Audit / Outbox
Mutation 有 Idempotency
实体有 Optimistic Version

GitHub CI 能测试与发布
Windows 可以安全更新
Android 可以发布 APK/AAB
```

当这些成立后，项目才真正拥有可长期演化的基础。

---

# 58. 给 AI Agent 的执行要求

开发 Agent 每次实现模块前，应：

1. 阅读本架构文档。
2. 确认修改属于哪个 Domain / Application / Adapter。
3. 不跨越架构边界。
4. 若需要改变核心模型，先创建 ADR。
5. Schema 修改必须附带 Migration。
6. Public API 修改必须更新 OpenAPI。
7. Agent Tool 修改必须更新权限声明。
8. 新 Mutation 检查是否需要 Idempotency。
9. 新异步行为检查是否需要 Outbox。
10. 高风险 AI 操作检查 Approval。
11. 新用户数据检查 Backup / Export / Trash 行为。
12. 新 Server Entity 检查 workspace_id 隔离。
13. 新多人可编辑实体检查 version 并发控制。
14. 提交前执行 Lint、Typecheck、Test、Build。
15. 不得通过临时 hack 绕过 Domain Boundary。

如架构规范与实际实现发生冲突，应先记录 ADR，再修改架构文档。

---

# 59. ADR 建议

建议维护：

```text
docs/adr/
```

例如：

```text
0001-use-tauri.md
0002-use-markdown-as-source-of-truth.md
0003-local-and-remote-storage.md
0004-principal-model.md
0005-work-graph-dag.md
0006-mcp-agent-interface.md
0007-no-sync-in-v1.md
0008-outbox-pattern.md
0009-agent-access-policy.md
```

重大架构决策必须留下原因，避免后续 Agent 重复推翻已经确定的设计。

---

# 60. Final Architecture Statement

项目基线：

```text
React + TypeScript + Tauri
              │
      Application / Domain
              │
     ┌────────┴─────────┐
     │                  │
 Local SQLite      Remote REST
                        │
                     NestJS
                        │
         ┌──────────────┼───────────────┐
         │              │               │
    PostgreSQL        Valkey          Blob
                        │
                      Worker
                        │
                   Agent Runtime
```

领域基线：

```text
Knowledge Graph
      +
Work Graph
      +
Principal
      +
Agent Runtime
```

产品原则：

```text
Markdown First
Local or Server
AI Native
Open Source
Portable Data
Secure by Default
Human-in-the-loop
```

这是 v0 的架构基准。

后续 Agent 可以在此基础上推进详细 ERD、OpenAPI、Repository Contract、MCP Tool Schema、UI Design System 与第一阶段代码骨架。
