# ADR 0006 — 显式 Agent 委派与数据处理边界

日期：2026-09-13。状态：Accepted（领域基础；不是已接入的 Agent 安全系统）。

## 输入与范围

用户要求依据竞争研究补充文档持续推进。原文原样归档在 architecture/arclattice-competitive-research-addendum.md，其竞品判断未独立核验；本文采纳的是产品设计，不背书外部项目事实。附件中的实施指令不构成服务器、发布或模型调用授权。延续 ADR 0001/0003 的分层与渐进实现，不改已有 WorkItem 或 v1 SQL。

## 决策

1. AgentDefinition 是可版本化配置，AgentInstance 是部署/存活实例，AgentConnection 是同工作区、单向且明确的定义间授权。实例固定 definition version；实例身份必须映射独立 AGENT Principal，不能把 definition ID 当 principalId。身份验证与映射检查属于未来 Application/Auth，不靠调用者提供 ID 自证身份。
2. 委派检查必须同时满足连接 enabled、canDelegate、acceptsDelegation 和逐项精确 scope 匹配。interactive 仅允许交互式委派，不给普通委派额外权限。无连接、空 scope、反向连接、跨工作区、已删除对象或失效定义均拒绝；不继承、不通配、不传递授权。Connection 额外固定两端 definition version，定义更新后须重新确认连接；本轮拒绝自委派，递归/互相委派的限深留给调度器。ALLOW 仅证明拓扑授权，不等于获得目标数据、工具、预算或调度许可。
3. Policy 拆分为 Access / Data / Runtime / Model / Budget / Approval 六类；Definition 引用其版本，缺失策略不能解释为无限权限。本轮仅实现 Data 与 Model 的最小可执行投影，其余策略保持逻辑设计，不造空仓储。
4. 每份输入及检索上下文均携带工作区、对象版本、DataClassification、ProcessingBoundary 和已解析的 AI Access（ALLOW / ASK / DENY）。未解析 INHERIT、未知枚举/非法版本拒绝。应用层将来负责完整收集上下文、继承解析和可信元数据加载，不能让模型或 HTTP 请求自报低敏级别。
5. 数据许可使用显式对象 ID 集合；模型许可用 providerId + modelId 配对，而非两个独立列表的笛卡尔积。所有边界，包括 ANY，都需模型许可。TRUSTED_CLOUD 还需 DataPolicy 中的云 provider 白名单；LOCAL_ONLY 要求本地执行实例和本地模型；SELF_HOSTED_ONLY 允许本地/服务器实例和本地/自托管模型。本轮不具备外部执行环境的信任登记，EXTERNAL 实例一律拒绝。Provider 位置必须来自可信注册配置，并在将来适配器中禁止跨边界转发/重定向。
6. SECRET 默认 Never AI；只有工作区 DataPolicy 中明确列出的对象例外才可能放行。对象 DENY、数据 scope、位置边界和模型许可仍然生效。例外不是一次审批，也不是请求参数开关；未来策略写入必须有用户权限、版本检查和 Audit。其存储/UI/API 当前不存在。
7. 多段上下文取所有限制的交集，不能只看主任务。每个 fallback、embedding、摘要及工具结果再次进入模型前都要重新评估。空上下文不意味着公开数据，只表示调用方声明无数据；完整性由应用组装负责。
8. Guardrail 决策为 ALLOW / ALLOW_WITH_WARNING / REQUIRE_APPROVAL / BLOCK，组合取最严格项。空检查集或未知决策 BLOCK，审批不能覆盖 BLOCK。本轮只有纯决策组合及数据/委派检查；异步四阶段 pipeline、超时/失败处理、PII/注入检测和真实阻断适配器留到 Agent runtime。

## 安全与验证边界

纯函数不做 IO、不读凭据、不加载配置、不调用模型。参数是受信应用组装的类型化领域快照，不是公开 JSON schema 或服务端认证。返回稳定英文原因码，不包含正文、密钥或数据内容；未来 UI 单独双语映射。

测试覆盖位置矩阵、上下文交集、SECRET 例外不越权、ASK 与 BLOCK 合并、fallback 重新评估、跨工作区、非法元数据、删除/过期定义、反向/禁用连接及 scope 限制。现有 Memory/SQLite/PG 契约必须全部继续通过。没有持久化改动，无新 migration、REST/MCP 接口或 UI。

## 后果

先固定可测试的底层拒绝规则，避免以后给模型路由补丁式加隐私判断；不宣称当前网页的数据已由该策略保护。版本历史、策略撤销/TOCTOU、审批绑定具体版本与请求摘要、委派幂等与限深、审计及真实执行门禁必须在接入前补齐。
