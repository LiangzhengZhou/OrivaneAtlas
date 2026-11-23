# Session 401 · 大 PDF 与已撤权副本

先核对 Host 支持绑定工作区的单区间 206、强 ETag、Content-Range 和精确长度。Web 或原生客户端遇到不兼容响应会结束预览，用户可在授权有效时下载完整原件。分发原生客户端时一起更新 Web 资产、原生命令和 ACL。100 MiB 原件上限与 16 MiB 提取预算分别适用。

确认撤销后当前标签要求原工作区的同一所有者重新登录。主动退出会返回独立设备工作区。批量操作中断后，重新认证、等待既有回执同步，打开原集合选择剩余条目完成移动；目的集合中已提交的成员沿用原 ID 与版本。操作前保全未同步草稿、Outbox、设备原件与已有备份。回退使用上一套相互兼容的 Host、静态资源及原生程序；旧客户端缺少主动会话复核，仍须依赖服务端原件授权。此变更沿用现有数据 schema。已核对获授权设备上的合成原件和远端隔离账号，部署状态及安装包升级沿用发布门禁。在同一隔离浏览器副本实测 Session 400 的 eeef72c 前端、60553a4、回退、再次升级及最后离线读原件，五步均保留同一深链、暗色偏好与下载 SHA-256。[五阶段结果](evidence/session401/web-rollback.json)

# Session 400 兼容与恢复增量

本批增加 `POST /api/v1/folders/move`（同时支持未版本化别名）。发布准备应先核实服务端能处理移动、命令回执和源/目标的版本前提，再考虑启用新版客户端。个人或设备存在待同步移动时先保全副本、Outbox、Receipt 和当前工作区的备份；在隔离环境恢复可处理该命令的服务与客户端并重放，再评估降级。旧服务端不能完成新增移动。不得通过删除 Outbox、重建资料关系或清空客户端来回滚。集合成员行保持原 ID，目标已有成员时只软删除源关联。此批未改变数据库 schema。

首次打开包含 Wiki 索引的已有工作区时，请先升级服务端。旧式清单只有展示字段，客户端无法将关联与后续版本更新对应。新版 Host 的清单提供数据库已有的标识、工作区、版本与时间；旧客户端的校验可以读取该清单。在旧 Host 上遇到升级提示时保留本机工作区，升级 Host 后可直接重试。已有 1,000 篇互链文档的隔离账户成功激活；另在三配置验证未解析目标后来创建时沿用原关联 ID。详见 ADR0152。

细粒度凭据读取混合资源关联需 `knowledge:read` 及 `files:read`，项目关联需 `knowledge:read` 及 `projects:read`。审核调用方原本需要的能力，权限不足时返回 403。历史凭据不能写新增移动路由。首次分发时连同静态资产提供本版 `openapi.json`。正式文件原件 GET 经过原先的读取授权与完整校验后可响应单个 Range，断点重试携带响应的强 ETag。历史项目附件导入仍使用其原来的版本约束。生产部署版本和平台升级包无本轮证据。本轮 Windows 使用新测试标识及独立 WebView2 用户目录构建并运行未签名夹具，见 evidence/session400/windows-calendar.json。2026-11-24 02:51 查询既有 ADB 服务，已连接和就绪设备均为 0；既有 SDK 有 Android 35 平台及 NDK，缺少 emulator 和系统镜像。

本轮候选 eeef72c 使用同一隔离浏览器副本完成五阶段回退，基线 da0105e，证据包含每一阶段的深链、脚本与原件摘要。复核命令为 `node scripts/rehearse-ux-web-upgrade.mjs .artifacts/ux398/account399-web .artifacts/ux400/collection-retry-web <新的输出目录>`。[原始结果](evidence/session400/web-upgrade-eeef72c.json)

NDK 26.1 以 API 24 目标构建 Android ARM64 原生库，ELF64、AArch64 和 JNI 符号已验证。源自 bdc9d1c 工作树，原生源码至 db711d7 无变化。编译 7 分 5 秒，5 条编译器警告。二进制摘要见 [ARM64 构建证据](evidence/session400/android-arm64.json)。离线重跑 Android JVM 通知与更新策略 7/7，通过 Gradle 的两份 JUnit XML 核对，未打安装包。安装升级、Android 软键盘与生命周期仍须设备验收。

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
