# 补充架构落地索引

更新：2026-09-14（本轮跨午夜）。用户输入为 arclattice-competitive-research-addendum.md；原始 v0 文档不覆盖，两份归档共同保留设计来源。补充文档仍保留 Proposed Amendments 原始状态；本项目采纳与细化由 ADR 0006/0007 表达。不是重新进行的竞品调研，不把文档中的外部项目描述当作核验结论。

## 采纳与实际交付

| 补充项 | 项目决策 | 本轮实际实现 | 后续落点 |
| --- | --- | --- | --- |
| Definition / Instance / Connection | ADR 0006，定义不是执行身份；连接有方向和版本 | 三种 TypeScript 契约；纯函数 evaluateDelegation | M8 管理/身份映射/调度/持久化 |
| 六类 Policy | 分开职责，组合取交集，不相互扩大权限 | 六类引用；Data / Model 最小投影及检查 | M8 另外四类执行检查与策略写入审核 |
| Classification / Boundary | 权限、对象 AI Access、位置边界同时满足；SECRET 默认拒绝 | evaluateModelProcessing；provider/model 配对、整段上下文、执行位置、fallback 逐次评估 | M2 Knowledge 元数据；M8 模型与 embedding 实际门禁 |
| Guardrail | 四阶段，最严格决策胜出 | stage 类型与 combineGuardrailDecisions；空集合/未知决策拒绝 | M8 异步 pipeline、失败/超时关闭、检测器及真实门禁 |
| Draft / Proposal / Version | ADR 0007，ChangeSet 为 payload，Draft 不污染 Active | 逻辑模型/发布约束；没有实体代码或运行时 | M9 验证/差异/审核/原子发布 |
| Evidence / Version Pinning | 与日志、Activity、Audit 区分；证据也受权限约束 | 逻辑模型与版本引用设计 | M8 Run 证据；M9 UI 与导出 |
| Provenance / Confidence | 保留字段修订来源；确认不抹除 AI 历史 | 逻辑模型/校验约束；没有存储或 UI | M2 数据模型，M8/M9 来源展示，后续假设传播 |
| A2A | 与 REST/MCP 并列的未来适配器，不替代 Webhook | 路线预留，无 SDK、端点或协议兼容声明 | v0 之后按真实互操作场景选版本 |

## 逻辑实体关系（设计，不是已部署数据库 ERD）

所有下述关系均限制在同 workspaceId；重要实体有 id、version、创建/修改 Principal 和时间，核心配置软删除。实际实现字段以 TypeScript 为准，逻辑规划不声称所有 metadata 已具备。未来迁移再确认表/JSON/索引与外键，不新增一批空表。

| 实体 | 核心内容与关系 | 关键约束 |
| --- | --- | --- |
| AgentDefinition | runtimeType、capabilities、六类 PolicyRef；1:N Instance | 缺配置不可启动；版本历史不可由原地覆盖冒充 |
| AgentInstance | 固定 DefinitionRef、独立 AGENT Principal、location、status、runtimeRef | Instance 不等于 Run；principalId 由认证系统映射，不能由调用请求自证 |
| AgentConnection | source/target Definition + version、enabled、canDelegate、acceptsDelegation、interactive、scopes | 单向精确授权；不能按 A→B→C 推导 A→C |
| AccessPolicy | 动作与目标范围 | RBAC 与 Agent 权限取交集 |
| DataPolicy | 允许数据 scope、Secret 例外、可信云清单 | 本轮代码仅精确 ID 投影；不提供路径通配解析 |
| RuntimePolicy | CPU/内存/时长、网络、文件系统、shellAllowed | 实际隔离由 Worker/adapter 保证，类型不是 sandbox |
| ModelPolicy / ModelRoute | 主/备用模型与 provider-model 配对许可；可信位置 | 本轮不选择路线，只评估传入路线；每次 fallback 重评 |
| BudgetPolicy | cost/calls/tokens/duration 上限 | 后续计费必须处理并发预留/结算；估算不能当真实花费 |
| ApprovalPolicy | 风险到四类 decision 的规则 | 批准绑定请求摘要及版本；不能覆盖硬拒绝 |
| AgentRun | InstanceRef、DefinitionRef、prompt/toolset/六类 policy/model route 固定版本 | 每次调用记实际 route；不可只记最新 ID |
| AgentRunEvidence | RunRef、input/context 修订引用、modelInfo、toolCalls、approvals、artifacts、summary | 同工作区、脱敏、受策略保护；不是含明文上下文的 debug log |
| PlanProposal | projectId、base/draft GraphVersionRef、ChangeSet、creator、status | 审核绑定 draft 与验证版本；编辑/基线变化使批准失效 |
| WorkGraphVersion | projectId、baseRevision、nodes/edges 快照或差异、status | 项目活动版本指针唯一；草稿不参与普通任务调度 |
| PropertyProvenance | entityType/id/version + propertyPath、source、sourceId、confidence、creator/time | confidence 缺失或有限 [0,1]；AI sourceId 指向 Run/Evidence；原字段值不在 provenance 中复制 |
| PropertyConfirmation（待细化） | 被确认的来源修订、确认者与时间 | 保留 AI 原始来源，不覆盖为 HUMAN |
| RecurringTask / Automation / Workflow Definition | 1:N Occurrence/Run | 在各自模块首次用到时实现，不提前复用 Agent 调度 |

### 发布时序约束

Draft → Validate / Dry Run → Diff → Review → Publish，只有最后一步改变活动图。Publish 与普通图修改使用统一 project revision；发布前重校验权限、定义连接、DAG、assignee、日期冲突、不可能依赖、重复、预算、AI/Data policy 和版本。未来事务同时提交活动图切换、提议状态、Activity/Outbox、幂等结果；审计独立。两个批准同一基线的提议不能都覆盖成功。Dry Run 不执行 Agent、工具、模型或写活动图。

当前 WorkService 没有 project graph revision、PlanProposal 或批量 AI 入口，不能把现有单任务事务误当成上述发布实现。简单创建/完成任务保持直达，复杂结构改动才进入提议。

## 领域规则的调用边界

`evaluateModelProcessing` 接收可信应用组装的元数据，不接收正文。`ALLOW` 只通过数据处理门，不替代 Access/Runtime/Budget/Approval；`evaluateDelegation` 的 ALLOW 只通过拓扑门。`combineGuardrailDecisions` 不负责找齐检查，也不是异步 pipeline。没有 Agent/provider runtime 调用这些函数。会话 007 已将 Web 接入私有 Node/SQLite 宿主，Notebook 固定 PRIVATE/REMOTE/AI DENY/HUMAN，不调用模型；这不等于完整模型策略管道已经上线。

将来接入时必须按以下顺序实施并验证：

1. 由认证结果获得 Principal/Workspace，加载未删除的实例、定义及六类策略当前版本；不要接受模型自报的白名单或低敏级别。
2. 在读取/传输正文前，根据元数据评估目标执行位置的数据许可。检索、摘要、工具结果、embedding 和 Evidence 都不能漏出上下文集合。LOCAL 指用户本地受信环境，不是“URL 为 localhost”；服务器的 localhost 不能据此读取 LOCAL_ONLY 数据。
3. 把待发送的全部数据与路线交给数据门，再组合所有 mandatory checks。ASK 返回等待审批，BLOCK 停止；未配置、抛错或超时也应停止，不能 catch 后继续执行。
4. 审批绑定请求内容摘要、数据修订和策略版本；发送/委派前再次确认未撤销或变更。备用路线必须重新检查。适配器防止重定向、代理转发或 telemetry 跨越注册边界。
5. 保存脱敏证据及固定版本，测试审批/策略变化与执行竞争。Secret policy 例外只能由授权用户修改并审计，不开放普通请求的 bypass 开关。

## 路线与验收门

- 治理基础（会话 005）：本索引、ADR 0006/0007、领域数据/委派/决策规则与单测；该治理轮未改 Schema/API/i18n。
- 私有工作台（会话 007）：ADR 0009、Node/SQLite 宿主、会话/CSRF/校验/幂等/OpenAPI、真实持久化 UI、SQLite v2、Notes/Journal 修订及双语界面已落地并验证。仅服务器回环 + SSH 隧道，不能跳到公网部署，也不能把服务器 localhost 当设备 LOCAL。PG 真实 dump/restore 仍待隔离环境验证。
- M2：已有独立 Notebook/Journal 及原文修订，不再只是 descriptionMd；完整 Object/Document/Revision、Books、导入/附件、字段级来源与 Policy 管理尚待扩展。固定 PRIVATE/REMOTE/AI DENY/HUMAN 不是完整策略管理，未解析数据不能自动变成 PUBLIC/ANY/ALLOW。
- M8：身份、六类完整策略、run/evidence/version pinning、四阶段 guardrail 和预算可见性；真实模型连接前，验证整个上下文与 fallback/embedding 门禁，不只纯函数。
- M9：Draft/Validate/Diff/Review/Publish，REST/OpenAPI/MCP 同应用入口；包含并发发布、失效审批、草稿隔离、权限测试。
- 后续：A2A、模拟引擎、假设传播、高级成本预测与 sandbox。不得为这些引入强制 Kubernetes 或挤掉 Journal/Notes/Books/个人任务。

各里程碑仍以实际功能与验收为准，提前实现两个领域门不等于 M8 完成。
