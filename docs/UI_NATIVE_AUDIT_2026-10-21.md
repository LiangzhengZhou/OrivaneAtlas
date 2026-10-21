# 2026-10-21 — Session292 UI / Native 证据复核

状态：持续验收中；此文件只记录实际审阅和边界。不是发布批准。
正式版本2.4.0，品牌PNG SHA256：
12E98E78FD60082975FA0FD655AD1C80C00598186232971AE22CA4971E7BB176。

## 实际视觉审阅

本轮使用原始PNG查看工具实际打开下列代表性帧。r2根目录为
`.artifacts/session289-session291-full-r2-results`，r3为
`.artifacts/session289-session292-full-r3-results`。r2的UI源码在接管时与R8一致；
本轮只改Application周期事务包装，没有改UI源码。新r3截图继续核对最终构建。

| 表面 | 实际查看的证据 | 观察 |
| --- | --- | --- |
| Sidebar / 页头 / 总览 | r2 route-audit 1440-light-overview；r3 desktop-zh 1280-light-overview；r3 populated1024dark 01-home | 标题、统计和主要动作层次可辨，无固定栏覆盖内容 |
| Tasks / Board | r2 desktop-en1280light tasks；r3 populated1024dark 03-tasks-list / 04-tasks-board | 1500条场景中局部列表正常，Board列在容器内滚动 |
| Project list | r2 mobile390light projects；r3 desktop-zh1024light projects | 中文“计划中”单行，名称与状态不重叠 |
| Project Overview / Knowledge | r3 populated1024dark06-project-overview；r2 mobile owned-project-materials | 动作、知识分组、文件原始大小与关系可读 |
| Notes / Journal | r2 desktop-zh1280dark notes/journal；mobile390light journal | 空态与搜索不重叠；用户内容未被翻译 |
| Knowledge Spaces / Files | r2 desktop-en1024light library；mobile430light library；mobile file-editor-atlas | 文件/文档筛选可读；过期文件提案明确提示且接受禁用 |
| Markdown / Workspace Tabs | r2 desktop-zh delta-document-sans-reading；mobile document-knowledge-graph | CJK/英文正文、标签、Wiki链接可读，编辑/阅读边界清楚 |
| Graph / Inspector | r2 desktop-zh1280dark graph；desktop-en knowledge-graph-workspace；r3 desktop-en1280light graph | 焦点/详情和图视口清晰；未据空图推断完整关系数据 |
| Gantt | r2 desktop-en及mobile-zh project-gantt | 任务名保留，移动横向滚动在表格容器内 |
| Calendar | r2 mobile430dark calendar / calendar-sheet-context；r3 desktop-en1024dark calendar | 月格、日期、Agenda与操作可读；移动Agenda随页面滚动，不属于固定遮挡 |
| EntityMemo / Private Memo | r2 desktop-en private-memo-offline；mobile memo-atlas-temporary-draft | 本机保存状态与审核入口可见；草稿与正式正文不同界面区域 |
| Atlas Float / Full | r2 desktop-en atlas-float；desktop-zh atlas-conversation；mobile file-editor-atlas | 浮层为抬升表面；未给正文加Glass；会话加载错误清晰 |
| Notification Center | r2 desktop-zh notification-open；r3 desktop-en reduced-preferences-notifications | 通知内容、未读状态和动作可读，降透明度时为实色表面 |
| Settings | r2 desktop-en1024light settings；mobile390dark settings | 语言/外观说明与选择器可读，移动页面滚动正常 |
| Dialog / Mobile Sheet | r2 mobile forced-colors-dialog / task-inspector / navigation-mobile-more-sheet | 键盘焦点边框、主要动作和关闭入口可见；保存栏不遮住输入区的可滚动范围 |
| Focus / Trash | r3 desktop-zh1280dark focus / trash | 空态与过滤入口可读 |

以上是实际视觉抽查，不把生成PNG数量当作全部帧已人工签收，也不声称辅助技术
或真实设备人工验收已经完成。当前抽查未发现需要修改产品源码的布局阻塞。
自动化Keyboard/Focus/CJK/ForcedColors/ReducedMotion/ReducedTransparency等结果
必须以完整r3报告为准，当前仍运行中。

## 历史OPEN记录校正

- 旧Atlas“会话列表失败显示模型请求失败”：当前已有专门会话加载错误文案；
  r2 atlas-offline-errors及atlas-float场景、r3完整对应场景验证，非新模型请求。
- 旧Project FILE原文入口：当前bootstrap.importLegacyProjectFile按原绑定/epoch/
  principal/workspace/version取原字节，并同身份导入一等File；已有work.spec.ts:2636
  的迁移一次/软删恢复/离线重载/字节精确场景。旧projectFile占位拒绝不是当前UI下载路径。
- 移动项目状态拆行已有既有修复与本轮PNG确认；没有改变品牌图或Adaptive背景。
- Graph信息层级与移动月历属于本轮抽查观察，未发现关键动作不可访问；没有临时重设计。

## Native 边界

旧EXE/NSIS/APK/JNI已复制到session292-pre-native-packages并保存SHA清单。
最终源码Rust/真实Transport/三个父级Windows OS opt-in/Windows与Android资产重建
均串行排队，尚不能在此记PASS。Rust默认ignored包括三个父级OS场景、一个子进程
fixture和一个严格Host Transport fixture；子fixture需由父级传入专用身份，不能
空跑返回当作验收。Transport必须通过Host测试实际调用。

Windows Toast真实cold-start click与Android physical notification均为
**MANUAL ACCEPTANCE OUTSTANDING**，Probe/模拟路由/签名构建不能替代。

Session292设备盘点：`adb devices -l` 实际返回空设备列表，原始输出保存
session292-android-device-inventory.txt。没有把模拟器或APK构建当物理通知验收。

## 21:17 最终自动证据更新

r4完整684/684，各配置228；UI/a11y相关场景在同一整轮PASS，0skip/retry。
最终check284files1475/1475、0skip PASS。Native2已实际完成Rust30PASS/5默认ignored；
三个OS父级opt-in显式各1PASS、strict Host Transport1PASS；Windows EXE/NSIS PASS。
Android95个Gradle任务全部实际执行、JVM Notification4/Update3共7PASS/0skip；
APK v2/v3签名/2.4.0包元数据/10密度图标及fresh JNI源目标SHA一致PASS。
Adaptive背景两个源资源明确#F3F4F6，品牌PNG SHA未变。最终包与测试程序另存
session292-final-packages/manifest.json，原包另存pre-native目录。
Native第一轮启动失败为漏测试manifest开关，原失败EXE与日志保留；只改process-local
命令环境。外部ACK补充首轮基点过早保留，增加原ACK barrier后3/3PASS，远端ENDED/
精确版本增量/规则/Outbox清空均断言；原684快速场景未改。
当前剩余自动阻塞为最终正式性能：R9完整13/14失败保留，R10二十样本正在执行。
物理Windows冷启动点击与Android真机通知仍MANUAL OUTSTANDING；无发布授权执行。

## 22:28 后续性能定位（北京时间，以本条校正前述21:27记录时间）

R10实际于21:25结束，恢复后读取完整结果：12/14 FAIL，具体Dependency graph35.9845ms(+12.744%)与100KB7.9635ms(+14.410%)。20功能样本PASS，Worker20/20，673SHA一致。
综合独立审计session292-r10-blocked-acceptance-audit.json核对浏览器/质量/Native/签名/JVM/ACK/包SHA均符合上述PASS，最终状态仍BLOCKED。
22时段单样本session292-r10-hotspot交互profile1/1PASS；session292-json-diagnostic外部fixture1/1PASS，通过仅诊断JSON.parse计时核对，单次0.1–0.3ms，不能单独解释p95超标；未修改生产源码，未把诊断当正式。
当前运行20样本字节一致R8控制（exec9147）：session290-session292-r8-control-formal-*，独立control dist75SHA等于原R8，test工作量/原业务断言与统计/预算不变，仅外部fixture webRoot指向control；清单session292-r8-control-20-manifest.json。此队列仅判断原R8当前环境可复现性，不能用其结果替代最终源码R10。

## 人工通知门槛的可复核记录要求

使用session292-final-packages/manifest.json列明的本地候选，先核对SHA；不更改2.4.0正式元数据，不将安装/设备检查等同发布。
Windows：在隔离测试身份创建可定位的通知，记录计划身份与预期目标；真实退出应用进程，待OS通知出现后由人工点击；记录OS重新启动应用、正确账号/workspace/目标、消费一次、无跨身份泄露。保留时间、OS版本、候选SHA、实际进程/路由结果及人工截图；当前没有此项真实点击证据。
Android：接入物理设备后记录设备型号/OS、候选SHA、通知权限；验证允许/拒绝及重新允许、后台/进程退出后真实通知点击、重启恢复与时区变更场景，核对正确账号/workspace/目标和消费一次；保留设备日志与人工操作记录。当前adb设备列表为空，全部上述物理场景未签收。
这些是待执行的人工步骤，不能据本节文字计PASS；当前最终性能同样未通过，不能开始发布。

## 2026-10-21 22:55 — Session292最终收口：自动化通过，人工通知门槛未完成

**AUTOMATED ACCEPTANCE PASS — MANUAL RELEASE GATES OUTSTANDING / NOT RELEASE READY**。
唯一仓库D:/Lib/Codex_workplace/ArcLattice，HEAD a9dc99a37486a191139c548a70150df2d20d6c67，正式版本2.4.0；现有staged/unstaged/untracked全部保留，未commit/push/tag/release/deploy/服务器操作。

- IMPLEMENTED：saveRecurrence和unlink复用既有workspace revision有界恢复（最多三次总尝试），同实体CAS/原输入/事务原子性/Outbox不放宽；API grants仅宿主teardown复用closeAllConnections。
- TARGETED / END-TO-END PASS：真实双IndexedDB连接无关revision、同实体负向、持续竞争上限；三配置生命周期与解绑；独立ACK r2三配置3/3，最终远端ENDED/精确+2/原规则/Outbox空。原失败fixture/Trace保留。
- FULL BROWSER ACCEPTANCE PASS：r4完整684/684，14files，desktop-en/desktop-zh/mobile-zh各228，0FAIL/SKIP/INTERRUPTED/FLAKY，retries0，exit0，47.0m。原r2 683/684与r3 682/684报告/失败证据保留。
- FULL QUALITY CHECK PASS：最终完整pnpm check（session292-resume-full-check.log）lint936/架构边界、11包及root types、284files1475/1475/0SKIP、生产build，exit0；diff-check0。旧17:23中断日志/PG失败保留，恢复PG定向3/3及最终完整check通过。
- FORMAL PERFORMANCE PASS：R11完整20样本、14/14、Worker首尾20/20、673SHA不变，功能/比较exit0，12.3m。100KB6.2025ms(-10.89%)、依赖图30.109ms(-5.66%)。R8历史PASS、R9 13/14与R10 12/14失败均保留；R8控制75字节SHA一致、完整20样本14/14只是诊断，不用于替代R11。Wiki候选未build/运行/采用。
- Native自动化PASS：Rust30PASS/5默认ignored；三个真实OS父级显式各1PASS（子辅助由父调用），strict Transport1/1；Windows EXE/NSIS；Android95任务实际执行/JVM7/7/0skip、v2/v3签名/图标10密度/JNI源目标SHA一致。Native初轮manifest遗漏与ACK首轮基点错误保留，均按实际环境/fixture修正，未改产品规则。最终包SHA清单session292-final-packages/manifest.json；品牌PNG与#F3F4F6不变。
- UI/a11y：实际视觉抽查与原图路径见UI_NATIVE_AUDIT_2026-10-21.md，完整r4包含键盘/焦点/CJK/响应式/强制颜色/减少动画和透明度等原断言全部通过。不声称所有帧或辅助技术人工签收。

最终报告docs/V3_FINAL_ACCEPTANCE_2026-10-21.md；机器综合审计.artifacts/session292-r11-final-acceptance-audit.json，全部673源/构建文件与r4一致，包SHA/签名/退出码/计数核对通过。此前R10 blocked审计另存，不能混淆。
下一步：取得Windows真实cold-start click与Android物理通知人工证据（当前adb无设备），按UI_NATIVE_AUDIT记录候选SHA/平台/权限/重启/时区/账号workspace目标/消费一次。没有发布授权；不再无必要重复全量自动化，不把人工门槛改记PASS。
准确命令：正式性能 `& ./.artifacts/session290-formal-run.ps1 -Prefix <新的session290前缀>`；本轮R11 prefix=session290-session292-formal-r11。质量用process-local pnpm11.19.0的pnpm check并配置真实ATLAS_NATIVE_TEST_EXE；Rust已有F:/Software/ArcLattice-native-toolchain，测试需ATLAS_NATIVE_TEST_MANIFEST=1，打包前清除；不改全局工具链。
本次工作认领的生产修复/自动化验收已收口；人工门槛保留待签收。最后进程/dirty/HEAD/diff与退出见session292-closeout-checkpoint.json。
