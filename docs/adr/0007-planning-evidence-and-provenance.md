# ADR 0007 — 草稿发布、证据与来源的增量架构

日期：2026-09-13。状态：Accepted（设计约束；本轮不实现规划运行时或物理表）。

## 决策

- PlanProposal 是一次复杂计划提议；WorkGraphVersion 是项目图版本；ChangeSet 保留为提议的可审查变更载荷，不建立第二套执行入口。Draft Graph 与 Active Graph 隔离，草稿不影响现有 Ready/Blocked 或普通任务。
- 流程为 Draft → Validate / Dry Run → Diff → Human Review → Publish。提议状态采用补充文档的 DRAFT / VALIDATING / PROPOSED / APPROVED / REJECTED / PUBLISHED；图另有 PAUSED / RETIRED。状态枚举不是任意转换许可，完整状态机在规划切片实现。
- 发布必须绑定 base graph revision、draft revision、验证结果、政策版本和审核摘要。审批后编辑使审批失效；活动图变化或政策变更必须重新校验，不覆盖人类期间的修改。Publish 在工作区事务内比较版本、检查 DAG/身份/连接/日期/依赖/重复/预算/AI 与数据政策，原子写图、状态与 Activity/Outbox，并使用幂等键。仅改 status=PUBLISHED 不是发布实现。
- 简单创建任务/完成任务不强制走草稿审批。未来普通图变更也必须推进项目活动图 revision，才能使基于旧图的提议失效。复杂批量改动通过应用入口分类约束，不让模型自行声称是简单改动而绕过审核。
- AgentRun 固定 definition、prompt、toolset、六类 policy 和 model route 的不可变版本引用；AgentRunEvidence 提供输入/上下文引用、实际模型路线、工具调用、审批、Artifact、输出摘要。每次 fallback 单独留证。日志、Activity、Audit、Evidence 职责不同，不能互相冒充。
- Evidence 必须有 workspaceId、创建 Principal、版本和来源引用；默认仅记录对象/修订 ID 与脱敏摘要，不复制 Secret 或私人全文。查看、检索、导出 Evidence 同样受数据许可/边界约束；引用删除后的保留与脱敏需专门策略，不得借证据存储规避删除。
- PropertyProvenance 附着于实体的具体字段修订，而非笼统给整个任务贴 AI 标签。来源 HUMAN / AI / IMPORTED / COMPUTED / SYSTEM，confidence 可空或有限数值 [0,1]，空不等于 0，也不默认 1。人类确认保留原 AI 来源链并新增确认记录，不能悄悄改 source=HUMAN 丢失历史。跨对象计算的未确认假设传播留到后续规划切片。
- RecurringTask / Automation / Workflow 也采用 Definition / Occurrence 或 Run 模式，但不为形式统一提前建立未使用表。
- A2A 进入后续路线，REST / MCP / Webhook 保留。未来所有协议都调用 Application 并重新验证身份/工作区/权限/审批；A2A 不属于 v0 必做项，不在本轮固定某个协议版本或引入 SDK。

## 实施顺序与验收

本轮归档、逻辑实体关系和 ADR，先做 ADR 0006 的可运行安全规则。接着恢复 M1 本地宿主/UI 持久化；M2 Knowledge 设计时纳入来源/分类/边界；M8 Agent 接入时补策略/版本/证据/Guardrail；M9 实现草稿发布及 REST/MCP 契约。Simulation、A2A、复杂 sandbox、假设传播和高级成本预测后置。个人知识与任务能力不能被 Agent 基建挤走。

新领域首次持久化前再提交 ERD、查询场景和迁移 ADR；现有 SQLite/PG v1 不修改。Domain 概念不要求一概映射独立表。发布原子性、失效审批、双发布竞争、草稿不污染活动图、证据权限与 AI 来源保留均需真实契约测试后才可标记完成。
