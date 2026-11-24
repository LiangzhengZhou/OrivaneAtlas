# Session 403 · 个人长中文笔记

## 1. 执行摘要
在 7b7d262 上复现组字中断后恢复临时拼音，产品修复为 d1e998f。68a7c01 统一宿主关闭路径，解决升级测试遗留的扫描器。

## 2. 范围
个人笔记的源码编辑、阅读视图、恢复草稿、重新打开与重复任务回归。多人委派继续暂缓。

## 3. 设计系统
沿用现有编辑、阅读和保存控件。桌面中英文、中文移动视口与深色主题均有操作记录。

## 4. 模块体验
对 56,066 字符合成 Markdown 追加“已校对”，输入候选 shanye，保持组字超过两个防抖间隔。旧草稿含 shanye。修复后检查整份恢复正文，组字期间刷新，重新打开并读到“末段已校对”，确认输入“山野”后切换阅读视图，比较正式保存的每个字符并重新打开。

## 5. 资源中心
本轮沿用既有文件与文档关系，验证材料为合成笔记。

## 6. 架构与文件
apps/web/src/DocumentWorkspace.tsx 选择已确认的恢复快照，LiveMarkdown.tsx 在 EditContext 或编辑 DOM 上订阅组合输入。tests/e2e/work.spec.ts 与 tests/ux-dark.playwright.ts 覆盖正常用户入口。packages/host/src/server.ts、cold-bootstrap.test.ts 及 tests/e2e/legacy-upgrade.spec.ts 涉及关闭清理及回归。

## 7. 数据与同步
原草稿 IndexedDB 格式、实体身份、冲突及敏感内容规则沿用。首次编辑后产生的已确认正文取自编辑器。测试独立核对恢复缓存和服务端笔记。

## 8. 性能环境
本地 Windows、Chromium 与环回 SQLite 测试宿主，移动验证为浏览器模拟。950 ms 用于让组字跨过草稿定时写入间隔。本轮没有开展设备性能基准。

## 9. 测试命令与结果
- 旧版桌面基线运行 pnpm test:e2e --grep 'long Chinese note|long Markdown contents|notes, safe reading' --project=desktop-zh，两个既有流程通过，新回归按预期失败。
- 最终 pnpm test:e2e --grep 'long Chinese note' 为 3/3，tests/ux-dark.playwright.ts 专项 2/2。改后曾出现仅移动端仍写入候选的失败，通过浏览器事件记录定位到 EditContext。
- 关闭后手动触发一次扫描，旧夹具出现 1 条重试日志；改后相同探针三配置 3/3、0 条日志。探针仅用于诊断。Host 关闭与单次扫描专项 4/4。
- 首轮完整检查 PostgreSQL 环回端口绑定失败。CI 调度的第一轮全量复跑 1594/1594。新宿主测试夹具另修正必需的 webRoot。原日志位于 .artifacts/ux403。

## 10. 交互证据
[旧版复现](evidence/session403/before-desktop.png) · [桌面恢复后](evidence/session403/after-desktop.png) · [深色移动恢复后](evidence/session403/after-mobile-dark.png)

## 11. 兼容与回退
本批更改不需要迁移。恢复上一版前端和宿主构建即可回退。旧版本已经存储的拼音无法自动推断用户原本想选择的汉字。

## 12. 开放项
Android 真机输入法、屏幕阅读器和移动端进程回收尚待验收。继续时可先验证长中文标题与正文连续组字时切换标签的焦点和关闭提示。

## 13. 运维
全部操作使用本机隔离夹具。总体验收按 ACCEPTANCE.md 继续；本次没有发布版本。

### 最终回归中断状态

中断后核对：最终 browser-final.log 最后启动第 771/852 项，退出码 1073807364，已记录的扫描重试为零。check-verified.log 显示 11/11 包类型检查通过，PostgreSQL connected.test.ts 两项失败，缺少整套测试终态。未发现仍在运行的 Vitest 或 Playwright 测试进程。两个最终全量门禁均待重新验收。

恢复时先核对分支 codex/ux-upgrade、HEAD 和 git status --short。优先单独运行 pnpm exec vitest run packages/storage-postgres/src/connected.test.ts 并保留临时数据库日志；定位失败后重跑本地 pnpm check 和 pnpm test:e2e。日志位于 .artifacts/ux403，前后截图见 docs/ux-upgrade/evidence/session403。Android 真机和系统输入法待验，多人开发继续暂缓。
