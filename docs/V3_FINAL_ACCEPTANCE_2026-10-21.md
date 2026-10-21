# Orivane Atlas v3.0.0 — Final Acceptance（2026-10-21）

当前状态：**AUTOMATED ACCEPTANCE PASS — MANUAL RELEASE GATES OUTSTANDING**。

**NOT RELEASE READY**：Windows真实冷启动通知点击与Android真机通知仍未人工签收。
正式版本保持2.4.0；本文不是发布授权。最终源码自动化门槛已完成，人工门槛与发布授权仍独立。

> Publication preparation: the user subsequently authorized GitHub v3.0.0 Release and server redeployment. This report preserves the pre-publication acceptance snapshot and its2.4.0 build labels. Version metadata and signed packages are being advanced to3.0.0; see [3.0.0 release notes](RELEASE_3.0.0.md). The two outstanding manual notification gates remain unverified.
## 来源与工作树保护

唯一Windows-native仓库：D:\Lib\Codex_workplace\ArcLattice。
HEAD：a9dc99a37486a191139c548a70150df2d20d6c67。接管时777条dirty状态，
没有reset/clean/checkout/revert/clone/worktree/commit/push/tag/deploy或服务器操作。
历史Session、全部正式性能与浏览器失败证据保留。过程记录见Session292。
process-local pnpm11.19.0；Node24.20.0/win32；Playwright1.63.0；
配置Rust环境后cargo/rustc1.98.1，没有改用户全局工具链或lockfile。

## 接管矩阵真实结果

`.artifacts/session289-session291-full-r2-*` 已于北京时间01:54完整结束。

| 指标 | 合计 | desktop-en | desktop-zh | mobile-zh |
| --- | ---: | ---: | ---: | ---: |
| DISCOVERED / EXECUTED |684|228|228|228|
| PASS |683|227|228|228|
| FAIL |1|1|0|0|
| SKIP / INTERRUPTED |0|0|0|0|

Exit1，35.4分钟，flaky0。唯一失败为Recurrence Lifecycle的Ended断言。
JSON/HTML/results/trace/截图及exit保留，机器汇总session292-inherited-browser-audit.json。

## Recurrence修复与定向证据

IMPLEMENTED：saveRecurrence只复用ADR0119已有三次总尝试的workspace revision
冲突恢复。原CAS版本/规则/actor不变，每次重做整笔授权/校验/事务；不重试网络。
双连接adapter修复前真实结果1PASS/2FAIL（workspace revision VERSION_CONFLICT）。
修复后相关5files19/19PASS。原生Chromium双IndexedDB连接3/3PASS，含无关事务成功、
同definition CAS拒绝、持续竞争上限和零中止Outbox残留，精确正文/规则/version验证。
三配置生命周期3/3及每配置重复5次共15/15PASS。生产buildPASS。
这些是TARGETED PASS，不替代完整浏览器或最终质量检查。

## 本轮完整重验r3与修复后r4

`.artifacts/session289-session292-full-r3-*` 完整684执行、682PASS/2FAIL/
0SKIP/0INTERRUPTED/0FLAKY，exit1，48.0m；desktop-en226/228，其余各228/228。
672SHA无变化。失败：API Grants teardown超时、Project引用解绑未消失。
原Recurrence三配置PASS。原始报告与失败证据保留，汇总session292-r3-browser-audit.json。

API请求/全部权限断言/截图约4.2秒完成，随后finally关闭宿主挂起；只复用
其他fixture既有closeAllConnections处理preconnect，无timeout或权限断言调整。
Project解绑真实调用runtime.unlink。双连接原生Chromium修复前3/3确认无关revision
错误拒绝，adapter before1PASS/2FAIL；仅扩展原ADR0119 helper到unlink。
修复后原生双IDB3/3、相关5files20/20、types/build、三场景三配置各重复3次
27/27PASS，exit0。CAS、软删、正文、三次上限、Outbox精确数量保持。

最新r4：**FULL BROWSER ACCEPTANCE PASS**。
`.artifacts/session289-session292-full-r4-*`完整684/684，三配置各228/228，
0FAIL/0SKIP/0INTERRUPTED/0FLAKY，exit0，47.0m。673文件SHA无变化。
机器汇总session292-r4-browser-audit.json，源文件manifest及integrity保留。

## 最终质量

**FULL QUALITY CHECK PASS**：`.artifacts/session292-resume-full-check.log`，exit0。
Lint936文件/架构边界、11包及root Typecheck、284测试文件、1475/1475 PASS、0SKIP，Production Build PASS；测试547.02秒。git diff --check exit0。
首次check在17:23中断，旧日志/PG异常保留，不计PASS；恢复后PG定向3/3及完整check均通过，没有修改PG源码。

## 最终性能：FORMAL PERFORMANCE PASS（R11）

R11于北京时间22:53:20完整结束：**20/20功能样本、14/14指标PASS**，12.3分钟，功能与比较exit均0。673源码/构建/测试文件SHA一致；20个样本Worker首尾均存活。冻结构建与r4完整浏览器及最终check对应同一份产品源码，最终机器审计再次核对673文件无差异。
正式队列：`.artifacts/session290-session292-formal-r11-*`。原固定数据集、原20样本中位数、10%回退门槛、14指标、完整正文及业务断言均保持。未筛选样本、未拼接队列。

| 指标 | 基线ms | R11中位ms | 相对基线 | 结论 |
| --- | ---: | ---: | ---: | --- |
| Now→Scheduled | 11.3900 | 9.4940 | -16.65% | PASS |
| Task tab switch | 11.5905 | 10.4260 | -10.05% | PASS |
| Project filter | 18.4990 | 15.9305 | -13.88% | PASS |
| List→Board | 11.5185 | 9.4745 | -17.75% | PASS |
| Calendar open | 19.2075 | 12.5460 | -34.68% | PASS |
| Calendar month switch | 3.3970 | 3.2315 | -4.87% | PASS |
| Dependency local graph | 31.9170 | 30.1090 | -5.66% | PASS |
| Task picker open | 3.3405 | 3.1255 | -6.44% | PASS |
| Task picker drill-down | 2.7485 | 2.2305 | -18.85% | PASS |
| Knowledge local graph | 27.3945 | 23.7465 | -13.32% | PASS |
| 50KB typing | 7.2665 | 5.2930 | -27.16% | PASS |
| 100KB typing | 6.9605 | 6.2025 | -10.89% | PASS |
| Atlas conversation list | 15.9020 | 15.1615 | -4.66% | PASS |
| Atlas conversation open | 32.2640 | 31.3835 | -2.73% | PASS |

历史证据全部保留：R8原正式14/14 PASS；R9正式13/14 FAIL（100KB +15.056%）；R10正式12/14 FAIL（Dependency graph +12.744%、100KB +14.410%）。R10功能20/20与673SHA仍通过，失败比较exit1。R11是最终源码正式结论的唯一队列依据。
针对当前环境可复现性，R8仅在.artifacts隔离重建，75dist文件SHA精确一致；四次交替小样本仅为诊断。随后20样本原R8控制完整14/14、20/20功能、75SHA不变（session290-session292-r8-control-formal-* / session292-r8-control-20-integrity.json），才紧接运行最终源码正式R11。没有因此把R9/R10失败抹掉，也未宣称已唯一确定环境根因。
输入期交互栈/JSON计时诊断完整工件保留；单调用Wiki目标复用候选只有.artifacts准备脚本，未构建、未运行、未进入产品源码。没有新增性能重构。
综合机器审计：`.artifacts/session292-r11-final-acceptance-audit.json`。旧R10 BLOCKED审计和原始失败保留，要求全部通过的旧审计确实在性能断言拒绝；没有生成虚假通过报告。

## Native自动化：PASS

Rust：30 PASS、0 FAIL、5默认ignored；三个真实OS父级opt-in测试显式各1 PASS，子进程辅助用例由父级实际调用，不声称35个直接通过。严格真实Native Transport 1/1 PASS。
Windows EXE/NSIS构建PASS。Android95任务全部实际执行，JVM NotificationPolicy4与UpdatePolicy3共7/7 PASS、0SKIP；APK v2/v3签名、2.4.0/2004000元数据、10密度图标/品牌一致性PASS。Fresh JNI源与包内目标SHA一致。
原Rust首轮编译后入口0xc0000139失败工件保留；诊断定位TaskDialogIndirect，使用仓库build.rs既有进程级ATLAS_NATIVE_TEST_MANIFEST=1修正测试环境，打包前清除，无产品源码或全局工具修改。
Android CLI受Windows symlink限制，既有fallback复制本轮fresh编译JNI并核对SHA；未把旧JNI或APK构建当物理设备通知通过。
新包另存`.artifacts/session292-final-packages/manifest.json`（含SHA），旧包另存session292-pre-native-packages；均为本地未发布候选。
证据见`.artifacts/session292-native2-*`和`.artifacts/session292-final-*`原始日志/退出码。native2流水线末尾FAILED RECURRENCE_ACK仅指补充fixture首轮，不能覆盖各Native步骤exit0。

## Recurrence ACK补充回归

原684快速Pause/Resume/End场景不改。独立补充fixture首轮在Paused本地状态后立即用远端旧snapshot当版本基点，两配置失败，全部保留。仅外部fixture补await现有Pause ACK barrier，再Resume/End、最终ACK等待；r2三配置3/3 PASS、exit0、13.5秒，精确版本+2、原规则/标题/时长、最终ENDED及Outbox清空均保留。工件`.artifacts/session292-recurrence-ack-r2-*`。

## UI / Accessibility

详见`UI_NATIVE_AUDIT_2026-10-21.md`的实际截图路径和范围。已查看主要桌面中英/移动中文表面、暗色、CJK、减少透明度、强制颜色及复杂数据视图，未按截图数量声称所有帧人工签收；本轮未发现新的阻塞布局问题。
完整r4包含响应式、键盘/焦点、CJK、强制颜色、减少动画/透明度等原断言，均PASS。品牌PNG SHA不变，Android adaptive background保持#F3F4F6。

## 剩余Release Gates与发布边界

- Windows Toast真实Cold-start Click：**MANUAL ACCEPTANCE OUTSTANDING**。
- Android Physical Notification（权限/后台/重启/时区与实际点击）：**MANUAL ACCEPTANCE OUTSTANDING**；adb实际设备列表为空。

自动化门槛均已完成；上述人工证据未取得，不能由Toast Probe、模拟路由或签名构建替代。实际人工步骤及记录要求见UI_NATIVE_AUDIT_2026-10-21.md。视觉审阅是报告列明范围的实际抽查，不声称所有截图帧或辅助技术均人工签收。
正式版本仍2.4.0，目标v3.0.0尚未发布。保留唯一dirty worktree、全部原始失败与通过工件、原包和新包SHA。未commit/push/tag/release/deploy或操作服务器。下一步仅为取得真实人工通知验收；后续若改产品源码，按影响范围重新验证，不能沿用冻结源码结论。
