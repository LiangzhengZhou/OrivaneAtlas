# 升级候选的兼容与回滚

当前开发基线为 3.1.14。候选尚未分配正式发布版本。既有 SQLite 51、PostgreSQL 46 及本地存储版本沿用仓库迁移代码。本批没有新增数据库迁移、API 字段或 Agent Tool。当前候选客户端依赖基线已有的上传、Workspace Snapshot、删除/恢复、审批和同步契约。旧服务端的最低兼容版本需在版本矩阵中实测后确认。

## 运维影响

- 升级包应同时包含 HTML、哈希命名的 JS/CSS、字标、favicon 与离线 Shell。新版使用新的静态 Shell cache 名称，原有 IndexedDB、草稿、Outbox 和账号绑定仍由各自存储服务管理。
- 资源列表/网格偏好按服务器、workspace、principal 分区。原有主题模式、调色板与路径参数可继续读取。新增的本地网格偏好可由旧客户端忽略。
- 文件浏览没有改变资源所有权。笔记目录、通用关联及项目/知识空间关联遵循现有契约。队列逐个调用正式上传服务，单项完成表示本机已保存；远端状态通过同步功能确认。
- 原生构建前运行图标生成与安全圆检查。准备发行时需分别核验 Windows 更新包、Android 包名/版本/签名、升级路径与真机体验。调试包和图标帧证据用于开发验收。

## 恢复演练和回滚

1. 在隔离环境记录当前二进制、静态资源清单、适配器和 schema 版本。使用专门测试工作区生成示例原件、笔记、文件夹关联、待同步命令和保留的历史修订。
2. 按现有备份流程制作独立快照，另存文件原件和受保护的 vault 恢复材料。演练目标必须是新路径。操作者用匹配版本核对完整性、实体版本、正文、二进制摘要、关联、Outbox 与 receipt。
3. 纯 UI 回滚可以成套恢复相同数据契约的旧客户端/静态资产，验证离线重开、深链与账户隔离。本候选使用新的静态 cache 标识；还需验证安装过两个版本的浏览器回退后加载匹配资源。
4. 跨历史 schema 回滚应使用匹配旧代码与升级前独立快照，在新目标完成恢复核对后再决定切换。原始生产数据、设备缓存和密钥不得作为测试输入。

本轮没有发布、部署或操作生产数据。实际端到端恢复结果、正式版本编号、最低跨版本兼容范围和设备验收仍需补齐。

## Session 398 的兼容验证

数据库仍为 SQLite 51 / PostgreSQL 46。本批涉及本地副本水合覆盖。新副本导入三个既有文件夹关系列表，旧副本对完成标记添加可选 folderLinksIncluded，仍使用已有元数据仓库和 schemaVersion 1。旧客户端可以忽略字段；真正回退后的数据一致性须在独立副本演练。回退到漏读关联的旧客户端可能导致关系在该客户端不可见，不应据此清理数据。

本地补齐前先校验账号、远端身份、epoch 和游标。快照领先时延后关联补齐，继续正常增量，避免跳过其余记录。已有备份路径、权限、原件和 Outbox 继续生效。测试用旧完成标记、领先和同一游标的快照验证一次性提交和只写关系。

Windows GNU 优化构建使用 --no-sign --no-bundle 成功。隔离 WebView2 程序使用专属标识 app.orivane.atlas.ux398fixture、离线样例和独立浏览器数据目录，验证键盘与预览。源代码的连接版 CSP 明确允许同源、data 和 blob 图片，其余资源类型继续用既有规则。此步骤不安装程序、不检查真实账号、不签署发行包。Android 设备体验、版本升级和发行渠道验证单独记录。

### 本机 WebView2 隔离冒烟复跑

在项目根目录从已构建的 Web 资源创建独立测试配置。原版 PDF 复验配置位于本机 .artifacts/ux398/webview2-pdf.json，其 identifier 为 app.orivane.atlas.ux398fixture、productName 为 Atlas UX fixture、frontendDist 为已冻结的本地构建、beforeBuildCommand 为空，updater.endpoints 为本机不可用的测试地址。开发测试使用 Windows GNU 本机工具链和离线 Cargo cache。

```powershell
$cfg=(Resolve-Path .artifacts/ux398/webview2-pdf.json).Path
pnpm exec tauri build --no-sign --no-bundle --config src-tauri/tauri.connected.conf.json --config $cfg
node scripts/smoke-windows-webview.mjs .artifacts/ux398/new-webview-result src-tauri/target/release/arclattice.exe
```

脚本检查 PE 产品名，创建独立 WebView2 配置目录，使用本机回环调试端口读取测试窗口，将本轮原件导入测试应用，最后关闭测试进程。输入目录必须是新路径，以便原始证据可追溯。文档归档的 Windows 图像与结果来自此流程。未进行安装、凭据迁移、代码签名、推送或生产更新。

### Android ARM64 原生编译

Android 使用现有 NDK 26.1.10909125、API 24 和离线锁定 Cargo 依赖，补齐 Tauri Android 包标识后 arm64 release 原生库构建成功（2m37s，5 个警告）。llvm-readelf 核对 ELF64/AArch64，llvm-nm 核对 app.orivane.atlas JNI 导出，14,872,056 字节，SHA-256 3304B4A94FDE716B5AF15452C4706E847376C3B0EE9830A99B323E231D321762。adb devices -l 设备列表为空。该结果覆盖 JNI 编译，不包括 APK 安装、系统输入、返回和生命周期。日志见 .artifacts/ux398/android-arm64-r2.log 与 android-elf.txt。

### 已执行的 Web 升级与回退演练

2026-11-23，Chromium 153.0.8010.12，使用本地 3.1.14 构建及 398 候选的同一隔离 profile 和同一 origin。真实上传、从 UI 复制引用、下载并比较 SHA-256。基线、升级、回退、再次升级及断网重载五个阶段保留相同字节与深色偏好。脚本 scripts/rehearse-ux-web-upgrade.mjs 接受两个构建目录和全新输出目录。evidence/session398/web-upgrade.json 保存入口和 JS 哈希、原件摘要及实际阶段。生产数据库和平台安装包尚未演练。

PDF 原件页视图复用锁定的 PDF.js 和同源 Worker。发行资产须保留带哈希的 PDF 解析 JS 和 Worker。Windows 本地验证配置 webview2-pdf.json 使用冻结的 pdf398-web，保留原版照片、表格和 PDF 次页证据。随应用部署的缓存资源与大文件策略须在离线升级后复查。

### 已验证的旧数据与备份夹具

全量浏览器 807/807 包含 tests/e2e/local-storage.spec.ts 的 v1 IndexedDB 备份恢复，以及 tests/e2e/legacy-upgrade.spec.ts 的真实旧 SQLite v29 项目、Markdown 与分块 PNG 升级。全量 Vitest 的 305/305 文件包含 packages/storage-sqlite/src/files.test.ts 的 v34/v35 恢复，并由 packages/storage-postgres/src/files.test.ts 和 knowledge-backup.test.ts 在临时 PostgreSQL 集群验证物理备份和内容。Web 资产回退证据单独记录在 web-upgrade.json。这些结果覆盖本机夹具，原生客户端安装降级、其他历史版本及运维侧恢复演练仍开放。
