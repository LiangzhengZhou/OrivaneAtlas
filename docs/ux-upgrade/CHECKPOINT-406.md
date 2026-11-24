# 个人任务列表 · Session 406

2026-11-24，Windows 本地隔离工作树，分支 `codex/ux-upgrade`，起点 `56e7c52`。界面提交 `56abeda`，回归路径修订 `4a880be`、`2a5b89f`。

## 界面与兼容

打开任务页首先看到「现在 / 稍后 / 已计划」、可切换的列表 / 看板 / 时间线，以及任务内容。项目、状态、优先级、排序、激活与归档集中到一个「筛选与排序」控件。生效的非默认筛选和排序在收起时仍然可见。范围切换保留分组，支持左右方向键、Home 和 End。列表区分首次使用、当前范围为空和没有匹配项，提供相应的创建或恢复操作。

变更集中在 `App.tsx`、`TasksRoute.tsx`、`TasksWorkspace.tsx`、`personal-tasks.css`、中英文文案与 Playwright。创建、完成和撤销沿用原应用契约。本批不涉及 API、持久化格式和数据库迁移。需要回退时，从起点提交在隔离工作树构建旧 Web 前端，使用同一份合成任务执行下列比较；无需恢复数据库。正式发布仍需另行授权。

## 前后对照

使用旧版 Web 包 `index-OuicTly-.js`（上轮最终构建）与本轮 `index-B4JCR-8e.js`，在全新离线浏览器上下文中通过真实编辑器创建相同三项任务。测量单位为 CSS 像素，完整行数截止到底部导航上沿。均未发生横向溢出。

|视口|首行上缘 改前 → 改后|首屏完整行数 改前 → 改后|
|---|---:|---:|
|1440×900 浅色|326 → 221|3 → 3|
|900×800 浅色|417 → 221|3 → 3|
|390×844 浅色|617 → 385|1 → 3|
|360×800 深色|626 → 385|0 → 2|
|320×700 强制颜色|626 → 462|0 → 1|

[手机改前](evidence/session406/mobile-list-before.png) · [手机改后](evidence/session406/mobile-list-after.png) · [桌面改前](evidence/session406/desktop-list-before.png) · [桌面改后](evidence/session406/desktop-list-after.png) · [窄屏](evidence/session406/narrow-list.png) · [深色](evidence/session406/mobile-list-dark.png) · [强制颜色](evidence/session406/forced-colors.png)

在仓库根目录运行下列 PowerShell 命令。测量脚本只使用传入的构建目录，单独创建浏览器上下文并拦截网络。输出使用新的目录名。

```powershell
pnpm build
node docs/ux-upgrade/evidence/session406/measure.mjs apps/web/dist .artifacts/ux406/layout-replay
```

## 回归记录

原始日志位于 `.artifacts/ux406/`。首次创建、范围与筛选恢复、完成并撤销、列表/看板兼容路径在三种默认配置合计 9/9。最终构建的深色专项 4/4、900 像素窄屏专项 1/1。全量运行发现两处旧用例尝试直接操作收起的表单，已经改为先展开筛选，再操作原控件；两个流程在桌面中英文和移动中文分别回放 3/3。没有删减原断言。

```powershell
$env:CI = "1"
$env:ATLAS_NATIVE_TEST_EXE = (Resolve-Path src-tauri/target/release/deps/arclattice_lib-d85ce0df86450c72.exe).Path
pnpm check
$env:ATLAS_E2E_BASE_PORT = "30630"
$env:NO_PROXY = "localhost,127.0.0.1,::1"
pnpm test:e2e --reporter=line --output=.artifacts/ux406/browser-replay
pnpm exec playwright test -c tests/ux-dark.playwright.ts --grep "personal task workspace|quick completion and restore" --output=.artifacts/ux406/dark-replay
pnpm exec playwright test -c playwright.narrow.config.ts --grep "personal task workspace" --output=.artifacts/ux406/narrow-replay
```

本地 `pnpm check` 退出 0，309 个文件、1595/1595 测试（2381.29 秒），11/11 包类型检查和 2/2 构建。最终测试修订后还单独执行了 lint、架构边界与根项目类型检查。中英文词条契约 3/3。

首次完整浏览器进程启动第 505/858 项后异常退出（1073807364），没有最终报告。随后分别执行三个完整项目。首次独立英文回归得到 284 通过、2 失败，两份跟踪分别显示 Chromium 拒绝测试宿主使用的 6667、6669 端口。`e98a88d` 使这两个夹具沿用仓库的 worker 端口分配。修复后，相关文件在三种配置合计 9/9，完整英文也重新跑通。

|最终完整项目|结果|耗时|原始日志（.artifacts/ux406/）|
|---|---:|---:|---|
|mobile-zh|286/286|13.8m|final-mobile-zh.log|
|desktop-zh|286/286|13.8m|final-desktop-zh.log|
|desktop-en|286/286|15.4m|verified-desktop-en.log|

三个项目共 858/858，各自退出码为 0。复现时可将上方完整浏览器命令分别加上 `--project=desktop-zh`、`--project=mobile-zh`、`--project=desktop-en`，每组使用独立输出目录。原始进程、分组运行和独立复验均已结束。长期证据见 [门禁读数](evidence/session406/gates.json)、[首次使用](evidence/session406/after-mobile.png) 和 [深色空列表](evidence/session406/empty-mobile-dark.png)。

真人读屏、Android 真机和本轮 Windows 原生任务流程仍待实测。使用上述三个合成任务，在系统软键盘和读屏开启时复核创建、范围名、焦点恢复、完成与撤销。