# ADR 0142：任务单计时器（时间戳转换，不按秒写库）

日期：2026-10-26。状态：已实施（Schema、Application、Host、Web 与真实浏览器验证完成；真机与生产未验证，未部署）。

## 背景

用户要求“单个任务计时器支持开始/暂停/继续/结束，基于时间戳计算，避免每秒写数据库”。在此之前 Work Item 没有计时字段；若按秒保存，会产生持续写库、Activity/Outbox 噪音与同步放大。

## 决策

1. 数据模型：WorkItem 增加两个可选字段
   - `timerStartedAt: string | null`：运行中计时段的开始时刻（服务端 UTC ISO 时间戳）；暂停/结束为 null。
   - `timerAccumulatedMs: number`：已完成计时段累计毫秒（安全整数、≥0）。运行中显示值 = accumulated + (now - startedAt)。
   可选是为兼容既有测试/内存调用；Application 创建时写入 `null`/`0`，数据库列有默认值。
2. 转换只接受离散动作，时间由服务端时钟计算：`UpdateWorkInput.timer = "START" | "PAUSE" | "STOP"`。
   - START：未运行才允许，记录 now；
   - PAUSE/STOP：必须运行中，累计加上 `now - startedAt` 后清空 startedAt；
   - 非法状态、非 TASK、类型错误均返回 VALIDATION_ERROR；动作与普通编辑共享既有 version CAS 与错误路径。
   - 不提供按秒心跳或自动写入；显示端每秒本地重渲染，不触达数据库。
3. 存储：SQLite migration 44 与 PostgreSQL migration 39 为 `work_item` 增加 `timer_started_at TEXT`、`timer_accumulated_ms`（默认 0，PG CHECK ≥0）；两个适配器字段映射与插入默认值同步，schema 检查增加列存在断言。旧库升级自动补列，不改写已有行。
4. API：`/api/work/update`（含 v1 别名）input 允许 `timer` 枚举；`WorkItem` 响应包含 timer 字段；OpenAPI 同步。创建时 timer 恒为空，不接受客户端伪造时间戳。
5. Web：任务列表卡片显示计时 chip 与开始/暂停/继续/结束按钮；仅运行中的卡片以 1 秒本地 tick 更新显示；操作经 Runtime 调 WorkService 后刷新快照，不引入新的全局状态存储。
6. 兼容性/本地优先：本地 canonical WorkItem 校验允许并校验这两个字段；Outbox 回放仍通过既有 `work.update` 命令与幂等收据，不新增命令类型或事件。

## 影响

- 每次开始/暂停/继续/结束各产生一次正常 Work 更新（版本+1、Activity/Outbox/Workspace Revision 与同步按既有规则），之后无论运行多久都不再写库。
- 跨设备显示由同步的 startedAt 推导；浏览器/宿主时钟偏差会影响展示，但持久状态一致（暂停时按服务端时钟结算）。
- 未实现：计时与日历/提醒联动、按任务汇总报表、后台跨应用计时、强行结算；这些留待需求确认。
- 生产部署/真机触控与系统休眠边界未验证；不能宣称生产已上线。
