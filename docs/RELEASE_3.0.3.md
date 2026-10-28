# Orivane Atlas v3.0.3

## 界面与工作流

- 文件页统一为 `NOTE / DOCUMENT / FILE` 资源工作区：统一类型、排序、上传入口与移动端资源优先布局；笔记文件夹只组织笔记，文档和上传文件保持原有资源语义。
- 笔记与日记：紧凑对齐的列表行、列表/小图标/中图标/大图标视图、按年/月/周/日分组，以及独立保存的显示偏好和折叠组搜索定位。
- 文档：稳定的阅读列、内容卡和选区定位工具栏；支持文档内图片上传、原始图片查看和 Markdown 保存状态。
- 任务与项目：任务计时器、截止时间分钟级输入、项目概览/材料/活动区域收敛，空内容不再占据大块空白。
- Atlas：上下文选择前置到输入区上方，模型与发送保持同排；主界面与浮动窗口统一材质和 composer 层级。
- 设置与账户：移动端高级设置分组、主题/界面语言标签、通知字段、账户与 API 页面层级收敛，服务器连通性测试独立呈现。
- 统一视觉 tokens、浅/暗主题、玻璃浮层、圆角/阴影/字体和图标密度；修复英文移动端导航导致的视口水平溢出和底部导航不可点问题。

## 可靠性与数据

- 文件夹恢复、导入回放、文件夹图标和资源入口的持久化与恢复路径加固。
- 任务计时器使用开始/暂停/停止时间戳，不按秒写库。
- 通知原因、同步 ACK 与本地写入并发时的文件删除/恢复/上传/时区保存问题修复。
- 保留实体版本校验、原子事务、有限重试和本地草稿恢复；未改变同步协议或权限边界。

## 验证范围 / Validation scope

- 当前源码：293 个测试文件通过 / 1 跳过；1527 个测试通过 / 1 跳过；lint、boundaries、typecheck、build、diff-check 通过。
- 三配置完整 Playwright：738/738 通过，未使用 retry/skip 规避失败。
- Windows NSIS 3.0.3 构建成功；Tauri updater 签名独立验证通过，修改/截断安装包被拒绝。
- Android arm64 3.0.3：JVM 测试通过；APK v2/v3 签名、生产证书 SHA-256 `87d09897bebadcc58067b90e9926f719de9c9869918ad664273e7a08b282a51a`、包名 `app.orivane.atlas`、versionCode `3000003`、图标安全区与打包一致性通过。
- 正式 20 样本 / 14 指标性能验收尚未完全通过：当前环境仍有单项/多项指标超出既有 10% 预算，不能把本版本声明为性能已验收；性能优化仍是后续 3.1.0 工作项。

## 升级说明

- Windows 安装包使用既有 updater 签名身份，但不是 Authenticode 发布者签名；Windows 可能显示未知发布者提示。
- Android APK 使用既有生产证书和包名；versionCode 为 `3000003`。已有生产证书安装可直接升级，不要混装 debug 签名包。
- 如使用自托管同步服务，请先部署与本版本匹配的服务器和数据库迁移，再升级客户端。
- 真机通知冷启动、Android 系统栏/cutout/IME/手势/双指和用户视觉签收仍为 MANUAL OUTSTANDING；浏览器自动化不能代替真机验收。

## 版本

- Windows installer: `OrivaneAtlas-3.0.3-windows-x64-setup.exe`
- Windows updater signature: `OrivaneAtlas-3.0.3-windows-x64-setup.exe.sig`
- Android arm64: `OrivaneAtlas-3.0.3-android-arm64.apk`
- Update metadata: `latest.json`, `android.json`
- Checksums: `SHA256SUMS.txt`
