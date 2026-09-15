# ArcLattice — Competitive Research Addendum & Architecture Amendments

> Document Type: Architecture Addendum  
> Purpose: 补充 `v0-architecture.md`，用于指导后续 AI Agent 更新核心架构。  
> Scope: 基于 TaskLattice、NodeLoom、Workloom、Mindora、Planifold 等项目的调研结果，提炼可借鉴的设计模式，并明确 ArcLattice 应吸收与避免的部分。  
> Status: Proposed Amendments

---

# 1. Executive Summary

经过对多个相关项目的调研，ArcLattice 当前总体方向无需推翻。

现有核心仍然成立：

```text
Personal Knowledge
+
Work Graph
+
Human
+
AI Agents
+
Local / Server
```

但 Agent Layer、Planning Layer、Data Policy、Trace / Evidence、Provenance 等领域需要进一步增强。

建议正式吸收以下八项改动：

1. 新增 `AgentDefinition / AgentInstance / AgentConnection` 三层模型。
2. 将 A2A 纳入未来 Agent-to-Agent 协议层，与 MCP 并列。
3. 将 Agent Policy 拆分为 Access / Data / Runtime / Model / Budget / Approval。
4. 将原有 ChangeSet 升级为版本化的 Draft → Validate → Review → Publish 流程。
5. 新增 Evidence 模型，记录 Agent Run 的输入、模型、工具、审批、输出与 Artifact。
6. 新增 Provenance + Confidence，区分 Human / AI / Computed / Imported 数据来源。
7. 新增 DataClassification + ProcessingBoundary，控制私人数据可被哪些 Agent / Model Provider 处理。
8. 将 Guardrail 设计成独立 Policy Pipeline，而不是散落在 Agent Runtime 内。

---

# 2. Benchmark Overview

本轮重点调研对象：

```text
TaskLattice
NodeLoom
Workloom
Mindora
Planifold
```

它们并非完全同类产品，而是分别覆盖：

```text
Agent Runtime
Agent Governance
AI Workflow
Personal Memory / Local-first
Planning System
```

ArcLattice 的目标不是复制其中任意一个，而是吸收各自在其领域中最成熟的模式。

---

# 3. TaskLattice — Agent Control Plane

## 3.1 最值得借鉴的核心

推荐吸收：

```text
AgentDefinition
AgentInstance
AgentConnection
```

三层模型。

## 3.2 AgentDefinition

描述一个 Agent 的稳定定义，例如：

```text
Planning Agent
Research Agent
Coding Agent
Review Agent
```

建议模型：

```ts
interface AgentDefinition {
  id: string
  workspaceId: string

  name: string
  description?: string

  runtimeType: string

  modelPolicyId?: string
  accessPolicyId?: string
  dataPolicyId?: string
  runtimePolicyId?: string
  budgetPolicyId?: string
  approvalPolicyId?: string

  capabilities: string[]
  version: number

  createdAt: string
  updatedAt: string
}
```

## 3.3 AgentInstance

AgentDefinition 不应等价于运行中的 Agent。

```text
Research Agent
  ├── Instance A
  ├── Instance B
  └── Instance C
```

建议：

```ts
interface AgentInstance {
  id: string
  workspaceId: string

  agentDefinitionId: string

  status: "IDLE" | "BUSY" | "OFFLINE" | "FAILED"

  executionLocation:
    | "LOCAL"
    | "SERVER"
    | "EXTERNAL"

  runtimeRef?: string

  createdAt: string
  lastSeenAt?: string
}
```

---

# 4. AgentConnection

Agent 与 Agent 之间不应默认拥有无限调用能力。

增加：

```text
AgentConnection
```

用于描述：

```text
PlanningAgent
   ↓ authorized
ResearchAgent
```

推荐字段：

```ts
interface AgentConnection {
  id: string

  workspaceId: string

  sourceAgentDefinitionId: string
  targetAgentDefinitionId: string

  canDelegate: boolean
  acceptsDelegation: boolean
  interactive: boolean

  scopes: string[]

  enabled: boolean
}
```

核心原则：

```text
Agent A 能否调用 Agent B
```

必须是显式授权关系。

---

# 5. A2A Support

ArcLattice 之前已有：

```text
REST
MCP
Webhook
```

现在建议未来增加：

```text
A2A
```

协议职责：

```text
REST
Program → ArcLattice

MCP
Agent → Tools / Context

A2A
Agent ↔ Agent
```

推荐架构：

```text
               ArcLattice

        ┌────────┼────────┐
        │        │        │
       REST     MCP      A2A
        │        │        │
     Program   Tools   Agent-to-Agent
```

A2A 不需要进入 v0 必做项，但必须进入 Agent Architecture Roadmap。

---

# 6. Agent Policy Model

推荐：

```text
AgentPolicy
├── AccessPolicy
├── DataPolicy
├── RuntimePolicy
├── ModelPolicy
├── BudgetPolicy
└── ApprovalPolicy
```

## 6.1 AccessPolicy

控制 Agent 能做什么。

```text
project:read
work:create
work:update
graph:write
document:read
artifact:create
```

## 6.2 DataPolicy

控制 Agent 能读取什么数据。

例如允许：

```text
Projects/*
Notes/Technical/*
```

但禁止：

```text
Journal/*
Secrets/*
```

## 6.3 RuntimePolicy

```text
maxMemory
maxCpu
timeout
networkPolicy
filesystemScope
shellAllowed
```

## 6.4 ModelPolicy

```text
primaryProvider
primaryModel
fallbackProvider
fallbackModel
allowedProviders
allowedModels
```

## 6.5 BudgetPolicy

```text
maxCost
maxModelCalls
maxToolCalls
maxInputTokens
maxOutputTokens
maxDuration
```

## 6.6 ApprovalPolicy

推荐决策：

```text
ALLOW
ALLOW_WITH_WARNING
REQUIRE_APPROVAL
BLOCK
```

---

# 7. Guardrail Pipeline

Guardrail 应独立为 Pipeline。

```text
BeforeModel
  ↓
Data Access Check
Prompt Injection Check
PII Check
Budget Check
  ↓
Model
  ↓
AfterModel
  ↓
Schema Validation
Sensitive Output Check
Tool Policy Check
  ↓
Tool / User
```

定义：

```ts
interface Guardrail {
  id: string

  stage:
    | "BEFORE_MODEL"
    | "AFTER_MODEL"
    | "BEFORE_TOOL"
    | "AFTER_TOOL"

  evaluate(input: unknown): Promise<GuardrailDecision>
}
```

---

# 8. Trace 与 Version Pinning

每次 Agent Run 建议固定记录：

```text
agent_definition_version
prompt_version
toolset_version
policy_version
model_route_version
```

目标是能够还原：

```text
哪个 Agent
哪个 Prompt
哪个 Model
哪些 Tools
哪套 Policy
哪些输入 Context
哪些审批
```

---

# 9. Evidence Model

日志用于调试，Evidence 用于用户解释。

建议新增：

```text
AgentRunEvidence
```

示例：

```text
Agent Run #142

Input
Task #438

Context
3 documents
2 project notes

Model
GPT-X

Tools
Search
Read Document
Create Artifact

Human Decisions
Approved tool call #7

Artifacts
research.md

Result
Completed
```

建议：

```ts
interface AgentRunEvidence {
  id: string
  runId: string

  inputRefs: string[]
  contextRefs: string[]

  modelInfo: object
  toolCalls: string[]

  approvals: string[]
  artifacts: string[]

  outputSummary?: string
}
```

---

# 10. Workloom — Draft / Validate / Publish

最重要的产品启发：

```text
Draft Graph
!=
Active Graph
```

原有：

```text
Plan
 ↓
Preview
 ↓
Apply
```

建议升级：

```text
PlanProposal
      ↓
Draft WorkGraph
      ↓
Validation
      ↓
Simulation / Dry Run
      ↓
Graph Diff
      ↓
Human Review
      ↓
Publish
      ↓
Active WorkGraph
```

---

# 11. WorkGraphVersion

建议新增：

```text
WorkGraphVersion
```

状态：

```text
DRAFT
VALIDATING
PROPOSED
APPROVED
PUBLISHED
PAUSED
RETIRED
```

Agent 不应直接大规模修改已发布复杂计划。

复杂规划默认进入 Draft Version。

---

# 12. PlanProposal

```ts
interface PlanProposal {
  id: string

  workspaceId: string
  projectId: string

  createdByPrincipalId: string

  baseGraphVersionId: string
  draftGraphVersionId: string

  status:
    | "DRAFT"
    | "VALIDATING"
    | "PROPOSED"
    | "APPROVED"
    | "REJECTED"
    | "PUBLISHED"

  summary?: string

  createdAt: string
  updatedAt: string
}
```

---

# 13. Validation

PlanProposal 发布前至少检查：

```text
DAG Cycle
Permission
Invalid Assignee
Invalid Agent Connection
Deadline Conflict
Impossible Dependency
Duplicate Task
Budget Estimate
AI Policy
Data Policy
Version Conflict
```

---

# 14. Simulation / Dry Run

复杂 AI 规划可以支持 Simulation，不修改 Active Graph，只计算：

```text
哪些 Task Ready
哪些 Task Blocked
预计 AI Cost
预计 Agent Load
Human vs AI Assignment
潜在 Deadline Conflict
```

之后展示 Graph Diff，再批准。

---

# 15. Definition / Instance Pattern

建议多个领域统一采用：

```text
Definition
   ↓
Instance
```

例如：

```text
AgentDefinition
→ AgentInstance / AgentRun

RecurringTaskDefinition
→ TaskOccurrence

AutomationDefinition
→ AutomationRun

WorkflowDefinition
→ WorkflowRun
```

---

# 16. Mindora — Data Boundary

Personal OS 最大风险之一：

```text
私人数据被外部 AI Provider 读取
```

因此需要：

```text
DataClassification
ProcessingBoundary
```

---

# 17. DataClassification

建议：

```text
PUBLIC
WORKSPACE
PRIVATE
SENSITIVE
SECRET
```

示例：

```text
公开技术笔记
PUBLIC

项目内部文档
WORKSPACE

私人日记
PRIVATE

身份证件
SENSITIVE

API Secret
SECRET
```

---

# 18. ProcessingBoundary

建议：

```text
LOCAL_ONLY
SELF_HOSTED_ONLY
TRUSTED_CLOUD
ANY
```

意义：

```text
LOCAL_ONLY
只允许本地模型 / 本地 Agent 处理

SELF_HOSTED_ONLY
允许本地或自托管服务器处理

TRUSTED_CLOUD
允许配置白名单的云 Provider

ANY
允许任何已授权 Provider
```

---

# 19. Data Policy + Model Routing

Model Router 不应只考虑：

```text
价格
速度
能力
```

还必须考虑：

```text
DataClassification
ProcessingBoundary
```

流程：

```text
Task
 ↓
Context
 ↓
Data Classification
 ↓
Processing Boundary
 ↓
Allowed Providers
 ↓
Model Routing
```

例如：

```text
Journal Entry
classification = PRIVATE
processing = LOCAL_ONLY
```

则：

```text
OpenAI
BLOCK

Claude
BLOCK

Local Ollama
ALLOW
```

---

# 20. Secret Data

推荐：

```text
SECRET
```

默认：

```text
Never AI
```

必须由用户显式修改 Policy 才允许例外。

---

# 21. Provenance

AI 生成或推测的数据不应伪装成事实。

新增：

```text
Provenance
```

推荐来源：

```text
HUMAN
AI
IMPORTED
COMPUTED
SYSTEM
```

---

# 22. Confidence

AI 推断属性可以携带：

```text
confidence
```

例如：

```text
Estimated Effort
18h

Source:
AI

Confidence:
0.72
```

而人类确认的数据可以是：

```text
Due Date
2026-10-20

Source:
HUMAN
```

---

# 23. Property Provenance

```ts
interface PropertyProvenance {
  source:
    | "HUMAN"
    | "AI"
    | "IMPORTED"
    | "COMPUTED"
    | "SYSTEM"

  sourceId?: string

  confidence?: number

  createdByPrincipalId: string

  createdAt: string
}
```

---

# 24. Derived Assumption Propagation

未来高级规划中，如果某个结果依赖 AI 未确认估算，UI 应显示：

```text
⚠ Contains unconfirmed assumptions
```

例如：

```text
Task A effort:
5 days
AI estimate

Project deadline:
derived from AI estimate
```

---

# 25. AI Budget UX

Budget 不应只存在数据库。

建议 UI：

```text
Agent Budget

Monthly
$12.43 / $30

Research Agent
$5.80

Coding Agent
$4.20

Planning Agent
$2.43
```

Task 可以显示：

```text
Estimated AI Cost
$0.18 – $0.35
```

PlanProposal 也可以显示预计执行成本。

---

# 26. Updated Agent Architecture

```text
                   AgentDefinition
                         │
                         ▼
                   AgentInstance
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
        ModelRoute   AgentPolicy   ToolSet
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
            Access      Data      Runtime
            Policy     Policy     Policy
                         │
                 ┌───────┼───────┐
                 ▼       ▼       ▼
               Budget   Approval Guardrail
                         │
                         ▼
                     AgentRun
                         │
             ┌───────────┼─────────────┐
             ▼           ▼             ▼
           Trace       Artifact      Evidence
```

---

# 27. Updated Protocol Architecture

```text
                     ArcLattice

                Application Layer
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
      REST            MCP             A2A
       │               │               │
 Programs / SDK    Tools/Context    Agent↔Agent
```

另外：

```text
Webhook
SSE
```

继续用于事件通知。

---

# 28. Updated Planning Architecture

```text
                    Human Goal
                        │
                        ▼
                  Planning Agent
                        │
                        ▼
                   PlanProposal
                        │
                        ▼
                 Draft WorkGraph
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
         Validation             Simulation
             │                     │
             └──────────┬──────────┘
                        ▼
                    Graph Diff
                        │
                        ▼
                   Human Review
                        │
               ┌────────┴────────┐
               ▼                 ▼
             Reject            Approve
                                  │
                                  ▼
                               Publish
                                  │
                                  ▼
                          Active WorkGraph
```

---

# 29. Updated Data Flow

```text
Knowledge
   │
   ▼
Planning Agent
   │
   ▼
Draft Plan
   │
   ▼
Human Approval
   │
   ▼
Active WorkGraph
   │
   ├──── Human Execution
   │
   └──── Agent Execution
             │
             ▼
          Evidence
             │
             ▼
          Artifact
             │
             ▼
          Knowledge
```

---

# 30. Recommendations by Benchmark

| Project | 借鉴价值 | 推荐吸收 |
|---|---:|---|
| TaskLattice | ★★★★★ | Agent Definition / Instance / Connection / Policy |
| Workloom | ★★★★★ | Draft → Validate → Approve → Publish / Evidence |
| NodeLoom | ★★★★☆ | Guardrail / Trace / Audit / Observability |
| Mindora | ★★★★☆ | Local-first / Data Boundary / Processing Boundary |
| Planifold | ★★★★☆ | Provenance / Confidence / Budget UX |

---

# 31. What NOT to Copy

## 31.1 不复制重部署依赖

ArcLattice 个人自托管场景优先：

```text
Docker Compose
NestJS
PostgreSQL
Valkey
Worker
```

不要在 v0 强制：

```text
Kubernetes
复杂 Sandbox Cluster
Agent Operator
```

## 31.2 不把 ArcLattice 变成纯 Agent 平台

ArcLattice 的核心差异仍然是：

```text
Personal Knowledge
+
Personal Work
+
AI Agent
```

不能因为 Agent Runtime 增强而牺牲：

```text
Journal
Notes
Books
Documents
Personal Tasks
```

## 31.3 不复制过度企业化 Workflow UX

复杂：

```text
Draft
Validate
Simulation
Publish
```

主要用于：

```text
大型项目规划
复杂 Agent Workflow
批量结构修改
```

简单操作仍保持：

```text
Create Task
Done
```

---

# 32. Architecture Amendments to Apply Now

## Required Now

```text
AgentDefinition
AgentInstance
AgentConnection

AgentPolicy split

DataClassification
ProcessingBoundary

Provenance
Confidence

PlanProposal
WorkGraphVersion
Evidence
```

## Architecture Now, Implementation Later

```text
A2A

Advanced Guardrail Runtime

Full Sandbox

Simulation Engine

Assumption Propagation

Advanced Agent Cost Forecast
```

---

# 33. Suggested New Database Entities

建议补充：

```text
agent_definition
agent_instance
agent_connection

agent_access_policy
agent_data_policy
agent_runtime_policy
agent_model_policy
agent_budget_policy
agent_approval_policy

guardrail_definition

agent_run_evidence

plan_proposal
work_graph_version

data_classification_policy
processing_policy

property_provenance
```

Domain 概念必须存在，但物理表不需要机械一一对应；ERD 阶段根据查询需求决定拆表或 JSONB。

---

# 34. Suggested ADRs

建议新增：

```text
0010-agent-definition-instance-connection.md
0011-agent-policy-model.md
0012-a2a-roadmap.md
0013-work-graph-versioning.md
0014-plan-proposal-publish-flow.md
0015-evidence-model.md
0016-data-classification-processing-boundary.md
0017-provenance-confidence.md
0018-guardrail-pipeline.md
```

---

# 35. Agent Implementation Instructions

开发 Agent 应基于本 Addendum：

1. 阅读原 `v0-architecture.md`。
2. 将本 Addendum 视为对原架构的增量修订。
3. 对冲突部分，以最新 ADR 决策为准。
4. 不直接开始大规模实现。
5. 先更新 Domain Model。
6. 再更新 ERD。
7. 再更新 REST / MCP Schema。
8. 再更新 Agent Runtime Interfaces。
9. 新增架构 ADR。
10. 更新 Roadmap 与 Milestone。

优先完成：

```text
AgentDefinition / Instance / Connection
AgentPolicy
DataClassification
ProcessingBoundary
Provenance
PlanProposal
WorkGraphVersion
Evidence
```

A2A 与完整 Sandbox 可仅做接口和 Roadmap 预留。

---

# 36. Final Positioning

ArcLattice 不应变成：

```text
AI Task Manager
```

也不应只是：

```text
Personal Notes App + AI Chat
```

长期定位仍然是：

```text
                 ArcLattice

        ┌──────── Knowledge ────────┐
        │                           │
        ▼                           │
      Work Graph                    │
        │                           │
  ┌─────┴─────┐                     │
  ▼           ▼                     │
Human       AI Agents               │
  │           │                     │
  └─────┬─────┘                     │
        ▼                           │
      Result ───────────────────────┘
```

并且核心数据原则：

```text
Markdown First
Portable Data
Local or Server
Human-in-the-loop
Explicit Agent Identity
Explicit Data Boundary
Evidence-based AI Execution
```

这份 Addendum 应作为下一轮架构更新依据。
