# Session 407 · Windows 任务行与编辑

本轮范围为个人任务交互和 Windows 窗口适配。分支 `codex/ux-upgrade`，起点 `89f51d0`，任务交互 `3396ef2`，窄窗口导航 `564eb63`，保留手机首屏密度 `8de2c4c`。

## 使用变化

- 任务行提供带文字的开始、暂停、继续计时按钮。切换状态复用一个按钮，累计时间仅作本地显示。选择模式下，标题的鼠标单击、Enter 和空格均切换选择，状态通过 aria-pressed 暴露。
- 键盘打开任务详情后可直接编辑标题，保存后焦点回到原任务。宽编辑面板将标题与状态放在同一行，小面板纵排。没有前置任务时完整编辑器收起关系，已有关系时展开；摘要显示当前可执行状态。
- 原生窗口缩窄时，导航已经切换到底栏，但侧栏仍占一整个视口。将侧栏高度、顶部菜单和桌面折叠控件与底栏断点对齐。580 像素及以下沿用紧凑手机页头。

## Windows 和移动端证据

使用本机离线 Rust 工具链、隔离 Tauri 标识 `app.orivane.atlas.ux407fixture`、新 WebView2 数据目录与三项合成任务。两个未签名 EXE 分别嵌入基线和最终 Web 构建。通过 Win32 API 最大化及缩放同一测试窗口，以鼠标与键盘操作内嵌页面。WebView2 158.0.4370.33，当前窗口 96 DPI。

|操作或读数|结果|
|---|---|
|1920×1009 桌面内容区|鼠标开始计时、空格暂停、Enter 打开详情；标题与状态坐标从 145/233 改为 145/145 CSS 像素。选择截止日期并保存，键盘焦点回到原任务。|
|674×985 窄窗口|主内容上缘从 985 改为 51 CSS 像素。顶部菜单可用 Enter 展开、Escape 收起。标题可键盘勾选和取消；完成、撤销和刷新后能再次读到日期与已暂停时长。|
|WebView2 强制颜色和暗色|在原生窗口内模拟对应媒体偏好。计时控件的键盘焦点在强制颜色下有实线轮廓。|
|浏览器宽度|1440/900/390/360/320 像素无横向溢出。390×844 首屏完整显示 3 项，360×800 深色为 2 项，320×700 强制颜色为 1 项。580、581、674、767、768、800、801 像素断点跨越在三个浏览器配置中验证。|

[Windows 窄窗改前](evidence/session407/windows-narrow-before.png) · [窄窗改后](evidence/session407/windows-narrow.png) · [桌面详情](evidence/session407/windows-details.png) · [深色](evidence/session407/windows-dark.png) · [强制颜色](evidence/session407/windows-forced-colors.png) · [手机](evidence/session407/mobile-list.png)

## 复验与兼容

在本地隔离工作树使用已有工具链，以 `pnpm exec tauri build --no-bundle --no-sign --config <fixture.json>` 构建测试程序。配置指定上述独有标识、productName 为 Atlas UX 407 fixture、本地禁用的更新地址及被测 frontendDist。输出目录和浏览器配置目录每次使用新路径。脚本拒绝控制产品名不匹配的窗口。

```powershell
node docs/ux-upgrade/evidence/session407/windows-tasks.mjs <新输出目录> <测试程序> after
$env:NO_PROXY = "localhost,127.0.0.1,::1"
$env:ATLAS_E2E_BASE_PORT = "31140"
pnpm build
pnpm test:e2e --grep "task timer persists|task selection mode batches|task single click opens|inline prerequisites|task due minute|quick completion and restore|resizing Tasks keeps"
```

任务仍通过现有服务访问，计时只在状态转换时写入。本轮没有 API 或数据库迁移。回退可在隔离工作树从 `89f51d0` 构建原 Web/Windows 客户端并用同一脚本的 before 模式核对。没有部署或安装更新。跨显示器混合 DPI、已固定任务栏快捷方式安装升级、真人读屏和 Android 真机仍待验收。

## 检查记录

本地日志在 `.artifacts/ux407`。任务专项 18/18、独立键盘焦点 3/3、深色完成撤销 2/2、最终断点专项 3/3、最终构建与 lint 通过。较早的候选运行在发现原生断点与手机首屏回退后中止，其局部结果不计入完整回归。最终浏览器按三个完整项目运行，读取各自的 delivery-*.log 与退出码。完整 pnpm check 日志为 check.log。
## WebView2 内容缩放

在同一 96 DPI 原生窗口内，以独立配置和合成数据重复运行上述流程，给脚本末尾传入 `1.25`、`1.5`、`2` 可指定 WebView2 内容缩放。脚本校验实际 devicePixelRatio。125%、150%、200% 的窄窗口内容区分别为 540×788、450×657、337×493，任务内容上缘均为 44 CSS 像素，均可完成键盘编辑、勾选、计时、完成与撤销。三档的宽窄窗口均无横向溢出。[缩放实测数据](evidence/session407/windows-webview-scales.json) · [200% 窄窗口键盘焦点](evidence/session407/windows-narrow-200.png)。多台物理显示器之间切换 DPI 仍需单独验收。
## 22:23 +08:00 回归检查点

- 首轮完整桌面中文 286/287，原用例仍寻找已被「前置任务」折叠面板替换的「工作关系」区域。修订 `84dc44b` 通过正常交互检查快速新建时前置设置可见、完整编辑时摘要可用键盘展开，专项回放 3/3。最终代码独立类型检查与 lint 通过。
- `.artifacts/ux407/delivery-desktop-zh.log` 为已结束的首次完整中文结果。`delivery-desktop-en.log`、`delivery-mobile-zh.log` 由 PID 3616 串行运行，独立单工作进程完整重跑中文写入 `reviewed-desktop-zh.log`，使用 31180 系列隔离端口。读取对应同名 JSON 的终止时间与退出码。`check.log` 仍在 Vitest 阶段。以上测试运行时均需保留其临时宿主和本机测试数据库进程。

## 最终复核

本轮门禁已结束。pnpm check 退出 0，309 个文件、1595 个测试全部通过，两项构建成功。完整桌面中文、桌面英文、移动中文各 287/287，合计 861/861。首轮桌面中文 286/287；旧区域定位器已在 84dc44b 更新，专项 3/3 后又完整重跑通过。实测 WebView2 内容缩放 100%、125%、150%、200%。详见 docs/ux-upgrade/CHECKPOINT-407.md 与 evidence/session407/gates.json。

|浏览器配置|通过|耗时|原始日志（.artifacts/ux407）|
|---|---|---|---|
|desktop-zh|287/287|39.5m|reviewed-desktop-zh.log|
|desktop-en|287/287|20.0m|delivery-desktop-en.log|
|mobile-zh|287/287|19.3m|delivery-mobile-zh.log|

全检跨越本轮界面调试，另在最终界面上完成独立构建、类型检查、lint（含架构边界）和完整浏览器回归，测试定位器修订后再次执行类型检查。上述 861 项只计每个项目最后一次完整结果。初次桌面中文、较早中止候选和各专项均未重复计入。所有本轮原生窗口和测试进程均已结束。

后续个人体验验收可用独立 Windows 配置，在文件预览与笔记列表重放侧栏收窄、键盘开关及保存归焦；在两台不同 DPI 的显示器之间移动窗口核对焦点和任务栏图标，使用 Windows 讲述人复核详情与计时的播报。混合 DPI 设备、真人读屏、用户已固定的任务栏快捷方式升级与 Android 真机仍待验收。多人工作继续暂缓。
