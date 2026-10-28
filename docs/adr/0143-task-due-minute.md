# ADR 0143：任务截止精确到分钟且保留仅日期语义

日期：2026-10-26。状态：已实施（Schema、Application、通知/日历、Web 与真实浏览器验证完成；生产与真机未验证，未部署）。

## 背景

任务截止日期此前只有日历日 `dueDate`。用户要求截止时间可精确到分钟，同时不破坏既有“仅日期”语义，并与工作区时区、提醒及日历一致。直接改 `dueDate` 为时间戳会破坏日期比较、排序、日历分组与旧数据兼容。

## 决策

1. WorkItem 增加可选 `dueTime: string | null`（`HH:mm`），与 `dueDate` 组合：
   - `dueTime = null` 时完全保持原有仅日期语义（显示、排序、日历分组、提醒 9:00 行为不变）；
   - `dueTime` 必须伴随 `dueDate`，无日期的孤立时间拒绝；清除 `dueDate` 时同步清空 `dueTime`。
2. 时刻解释统一使用工作区时区（`calendarSettings.timezone`）：新增 `taskDueInstant(item, timezone)` 返回该日期+分钟在工作区时区的绝对毫秒；`taskDueOccasion` 返回 `YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm` 作为提醒去重/重排判别。
3. 提醒：TASK_DUE 通知的触发时刻从固定当地 9:00 改为 `dueTime` 对应的绝对时刻；occasion 带时间，截止时间变化会重新调度；仅日期任务仍按 9:00 与日期 occasion。
4. 日历：仍按 `dueDate` 归入当天；同一天中只有当前工作区时钟晚于 `taskDueInstant` 的任务进入逾期列表；仅日期任务仍在次日视为逾期（原行为）。
5. 存储：SQLite migration 45 / PostgreSQL migration 40 增加 `due_time TEXT`；字段映射、schema 检查同步；旧行默认 NULL，保持日期语义。
6. API：`/api/work/create` 与 `/api/work/update`（含 v1 别名）接受 `dueTime`；OpenAPI CreateWork/UpdateWork/WorkItem 增加带 `HH:mm` pattern 的可空字段；Web 任务编辑器在已选截止日期时显示可选时间输入，任务行/侧栏显示 `YYYY-MM-DD HH:mm`。
7. 本地优先/回放：canonical WorkItem 校验调用扩展后的 `validateSchedule(start, due, dueTime)`；Outbox 仍使用既有 `work.update` 命令与幂等收据，不新增命令或事件。

## 影响

- 日期语义向后兼容：旧数据/仅日期任务不迁移、行为不变。
- 分钟级截止在通知与日历逾期判断上使用工作区时区，避免宿主/浏览器时区漂移。
- 未实现秒级精度、时区随任务单独覆盖、自然语言“下午3点”解析；重复任务规则仍以日期为主。
- 生产部署、真机 IME/触控、跨设备时钟偏差未验证；不能宣称生产已上线。
