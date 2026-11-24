# Session 405 · Windows 任务栏与窗口图标

用户要求改善任务栏等系统入口的图标分辨率。本轮从 `78f67af` 恢复，实现在 `ec9e960`，使用现有的折叠地图、山脊和金色圆点母版。

## 改动

原 ICO 有 8 帧。项目锁定的 `tauri-codegen 2.6.3` 取 ICO 的第一项生成默认窗口图标，托盘通过 `app.default_window_icon()` 获取同一图像。在本机 150% 缩放的旧窗口上，WM_GETICON 返回的源图是 16×16。旧 EXE 的 30px 和 36px 请求均返回资源 ID 4，对应旧 32px 帧。

`scripts/make-native-icons.mjs` 现在从 SVG 直接生成 18 个透明帧。首帧 256px，其余覆盖 100%、125%、150%、175%、200%、250%、300%、400% 的任务栏、标题栏及常用系统入口尺寸。16–24px 的图标额外内收半个像素。ICO 文件从 10,859 增至 22,437 字节；第二次生成与第一次逐字节相同。完整尺寸表见 [品牌规范](BRAND.md)。

## Windows 验证

- 使用 Windows 11 build 26300、144 DPI（150%）和两个独立的未签名 Tauri 测试程序。在运行中窗口上读取 WM_GETICON，旧版返回 16×16，新版返回 256×256。
- 使用 PrivateExtractIconsW 从两份 EXE 各提取 18 档图标，核对返回 HICON 的宽高。新版为每一档返回不同的底层资源 ID，包含 30、36、42、60、72 和 96px 的任务栏图标。
- 在临时目录创建仅指定候选目标的 .lnk。用 SHGetFileInfoW 实际渲染快捷方式与目标 EXE 的大、小图标。排除左下角快捷方式箭头区域，32px 的 379 个、16px 的 79 个受检像素分别逐像素相同。
- 原始命令为 `pwsh -File docs/ux-upgrade/evidence/session405/measure-icons.ps1 -Executable <隔离测试程序> -OutputDirectory <新目录>`。显示器设置和已固定的任务栏快捷方式保持原状。其他 DPI 的验证使用系统 API 请求具体像素尺寸；多显示器之间移动窗口与安装升级仍待实测。

[改前改后对照](evidence/session405/windows-icons.png) · [旧版读数](evidence/session405/before.json) · [新版读数](evidence/session405/after.json) · [快捷方式像素核对](evidence/session405/shortcut-appearance.json)

## 回归、交付与恢复

旧版在新增的高分辨率首帧断言处失败；一次试做去除了全部额外内边距，16px 帧未达到现有透明区门槛。保留半像素内边距后，`pnpm exec vitest run packages/host/src/native-icons.test.ts apps/web/src/branding.test.ts` 通过 5/5。构建后运行 `pnpm test:e2e --grep 'native updater UI:|end to end native bridge'`，桌面中英文和移动中文合计 6/6。Windows 离线工具链以 `tauri build --no-bundle --no-sign` 构建了独立测试程序。

本批仅包含 Windows 资源、生成器及其回归断言。Web 和 Android 资源重新生成后，Git 内容差异为空。无需修改数据、API 或同步流程。需要回退时从前一提交构建原版 ICO 的测试程序，并用同一脚本复核。原始日志保存在 `.artifacts/ux405`。

最终本地 `pnpm check` 退出 0。架构边界、11/11 包类型检查、309 个文件和 1595/1595 个测试通过，单元及集成测试用时 585.11 秒，构建 2/2。Windows 与浏览器测试进程均已退出。
