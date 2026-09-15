# ADR 0015：原生客户端一键更新

状态：Accepted（2026-09-15）

## 背景

Orivane Atlas 的 Windows EXE/NSIS 与 Android APK 需要在软件内检查并更新到最新版。架构文档已规定 Windows 使用 Tauri Updater 签名更新，Android 使用 Google Play In-App Update 或 APK 系统安装器确认。

## 决策

1. Windows 使用 Tauri Updater：软件内执行检查、展示版本/变更说明、下载、安装并重启。更新元数据与包只允许 HTTPS；包必须通过 Tauri updater 公钥验签，验签失败、版本降级、目标平台不匹配或哈希不符均拒绝安装。
2. Android 分两种发布渠道：Google Play 版本优先使用 Play In-App Update；独立 APK 版本只下载签名 APK，并交给 Android Package Installer，由用户确认安装。应用不静默安装、不执行下载内容、不绕过系统确认。
3. 更新源使用 Stable/Beta/Nightly 等明确 channel；默认 Stable。客户端不能从普通业务 API、用户可编辑内容或不受信任地址动态改变更新源。
4. Tauri updater 私钥、Android keystore、Play 发布凭据不进入 Git、客户端、普通数据库或接力文档；仅使用受限的发布环境密钥文件/密钥管理器。开发测试使用独立测试密钥或不签名模拟，不能冒充生产发布。
5. 一键更新必须保留失败恢复路径：下载临时文件、校验完成后再安装；安装失败或中断不得删除当前可运行版本。更新流程不得新增 Shell、文件系统、凭据或任意插件权限。

## 验收

- Windows：检查无更新、发现更新、下载进度、签名成功安装重启、签名失败拒绝、断网/中断保留旧版本、禁止降级。
- Android：Play 渠道的应用内更新；独立 APK 的签名校验与系统安装器确认；断网/取消/不兼容包不破坏当前安装。
- 两个平台：中英文文案、当前版本/目标版本/变更说明、channel 显示；不记录或输出私钥、keystore、token。

## 边界

本 ADR 不授权现在发布到 GitHub、Google Play 或其他商店，也不决定公开仓库、许可证、生产签名密钥或发布账号。EXE/APK 与更新功能必须在工具链、发布源和签名材料明确后才能称为已交付。
