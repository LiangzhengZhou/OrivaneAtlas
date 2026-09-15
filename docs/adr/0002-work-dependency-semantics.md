# ADR 0002 — 调度依赖方向与状态规则

日期：2026-09-13。状态：Accepted。

## 方向

- `A BLOCKS B`：A 是前置，B 是后续。
- `B REQUIRES A`：表达相同依赖。
- 计算时统一为“前置 → 后续”；两种写法间也去重。
- BLOCKS/REQUIRES 参与 DAG；RELATED/CONTAINS/PRODUCES/DERIVED_FROM 不参与本阶段调度。非调度关系可以形成多节点循环；任何关系的自环暂拒绝。Knowledge Graph 尚未实现，不复用这里的自环策略。

## 状态

持久状态：TODO、IN_PROGRESS、DONE、CANCELED。Ready/Blocked 为派生结果，不作为独立持久状态。

TODO 且所有前置都为 DONE 才 Ready。CANCELED、缺失、已删除的前置均不视为完成。UI 可直接把无阻塞的 TODO 设为 DONE。

依赖不满足时，拒绝进入 IN_PROGRESS/DONE；禁止给已经开始或完成的任务新增未完成的前置；前置 DONE 要重开时，若有 IN_PROGRESS/DONE 的直接后续则拒绝，须先按依赖逆序重置后续。此保守策略避免隐式修改其他任务。

删除任何有关联的任务前先显式断开关系；不会静默丢弃依赖。移除边目前物理移除关系并保留 Activity 记录，不等于核心 WorkItem 永久删除；边的 Trash/Tombstone/版本策略留给持久 Schema ADR。

## 并发

校验与写入必须位于同一隔离事务。Memory 串行锁仅保证单实例内一致；SQL 适配器需要 Workspace/Graph 范围锁或等价可证明隔离，避免两个并发 addEdge 各自通过校验却共同形成循环。
