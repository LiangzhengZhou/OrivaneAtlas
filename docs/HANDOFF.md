# Orivane Atlas 接力文档

## 026 当前状态：Android arm64 debug APK 已完成

- Android arm64 debug APK 已完成全新构建：src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk，134790311 bytes，SHA256 A96A5A347E62177E4D797695D4111462E2A383BFF4912AC5D5E6E7498CD46C90。
- Gradle assembleArm64Debug -x rustBuildArm64Debug 实际 BUILD SUCCESSFUL；apksigner verify --verbose 通过 v2 签名。
- Windows 限制通过复制 arm64 Rust .so 到 jniLibs 处理；local.properties 仅本机使用，未进入公开 Git。
- APK 与 EXE 均包含服务器地址输入和项目 icon；APK 仍是 arm64 debug 包，不是正式 release 签名包。
- 待完成：将本次 EXE/APK 上传到新的 GitHub Release，并实现正式签名与软件内一键更新。

## 025 当前状态：原生客户端服务器配置修复已推送，Android 新包仍阻塞

- 已修复登录入口：EXE/APK 内置公开前端，首次启动要求输入 HTTPS 服务器地址；API 请求使用该地址，账号密码不再脱离服务器单独提交。
- 已修复服务器切换时重复 session 请求及原生 WebView 存储异常容错。
- 已重新生成项目指定 icon 的 Android launcher 资源，并纳入公开源码。
- Windows NSIS 已重新构建：src-tauri/target/release/bundle/nsis/Orivane Atlas_0.0.1_x64-setup.exe，SHA256 A2C61DB7B39FD1D56C522E71A4DDC75EEBD6904936ACED78ED56A80A6144CF11。
- Android 依赖下载已通过清除本机失效 Cargo 代理解决；Rust arm64 编译通过，但 Windows 符号链接/Gradle 清理构建仍未产出新的 APK。旧 APK SHA256 6A2346B68E33D3769321D77F3C9EEB62F1CB616360070D67AF5591CE809784A6，禁止作为本轮成品发布。
- 公开源码已提交并推送：f27281b fix: make native clients server-configurable。未上传服务器地址、凭据、内部文档或工具链。
- 本轮不能声称 GitHub 新版二进制 Release 已完成：EXE 可发布，APK 尚未取得本轮新产物；正式签名与软件内一键更新仍未实现。

## 024 当前状态：公开文档已面向自部署用户整理并推送

- 根 README 保持英文，并在顶部展示 assets/icon.svg。
- 新增公开英文 docs/README.md 与 docs/SELF_HOSTING.md；DEVELOPMENT.md、STORAGE.md、STORAGE_POSTGRES.md 已改为公开贡献/自部署语境。
- 从公开 Git 版本移除内部接力模板、生产/连接工作台 ADR、内部研究补充和内部架构修订；本地私有文件仍保留为未跟踪文件。
- OpenAPI 中涉及秘密文件名的描述已改为通用的 provider credentials/encryption keys 表述。
- 提交并推送：a7b3856，提交说明为 docs: focus public documentation on self-hosting；使用临时清空 Git 代理成功推送到 origin/main。
- 当前公开定位：Orivane Atlas 是服务端驱动、可自部署工作台；本地 AI/多人协作是可选的未来产品能力，不是公开接力系统。
- EXE/APK 继续只作为 GitHub Release 资产，不进入 Git；现有 v0.0.1-debug 仍是 debug/pre-release，不能称生产签名版本。

### 下一步

1. 检查 GitHub docs 页面与 README icon 的渲染。
2. 后续单独实现并验收 Windows/Android 正式签名及软件内更新链路。
3. 不要把 docs/HANDOFF.md、PROJECT_STATUS.md、sessions、DEPLOYMENT、账户/服务器资料或 F 盘工具链加入公开 Git。

## 023 当前状态：GitHub 调试 Release 已成功发布

- 公开仓库：`https://github.com/LiangzhengZhou/OrivaneAtlas`。
- GitHub Release `v0.0.1-debug` 已发布并标记为 Pre-release，标题为 `Orivane Atlas v0.0.1 Debug Builds`。
- 已公开资产：`Orivane.Atlas_0.0.1_x64-setup.exe`（SHA256 `A5C2F3598F161CD16B32D947B47646B08124507EA44483F397AA81D9BE9D6AD6`）和 `app-arm64-debug.apk`（SHA256 `6A2346B68E33D3769321D77F3C9EEB62F1CB616360070D67AF5591CE809784A6`）。
- 页面实测显示 tag、标题、Pre-release、两个资产和摘要均正确；空 tag 导致的创建失败已修复。
- 公开边界保持有效：私有运维文档、历史接力记录、服务器地址/账户/凭据、生产配置未上传；EXE/APK 仅作为 Release 资产，不进入 Git 历史。
- 下一步优先级：实现并验收软件内一键更新；随后准备正式签名、Android release/multi-ABI、真机安装与更新回滚测试。不得把本次 debug Release 当作生产版本。

## 019 当前状态：EXE 与 Android arm64 debug APK 已构建；后续路线已登记

- Windows NSIS 成品已复核：`src-tauri/target/release/bundle/nsis/Orivane Atlas_0.0.1_x64-setup.exe`，3,774,341 bytes，SHA256 `A5C2F3598F161CD16B32D947B47646B08124507EA44483F397AA81D9BE9D6AD6`。
- Android 成品已生成：`src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`，134,878,900 bytes，SHA256 `6A2346B68E33D3769321D77F3C9EEB62F1CB616360070D67AF5591CE809784A6`。`apksigner verify --verbose` 通过 v2 签名；这是 debug APK，不是发布签名包。
- APK 使用 F 盘现有 Android SDK/NDK/JDK 和 Cargo 工具链；因 Windows 当前会话禁止符号链接，采用已编译 arm64 `.so` 的本地复制，并以 `assembleArm64Debug -x rustBuildArm64Debug` 完成打包。未安装 Visual Studio。
- 全量 universal/multi-ABI debug 构建仍未完成：Tauri 生成的 x86 等任务会重新调用 CLI 并要求 server-address 文件；本轮只交付可安装的 arm64 debug APK。
- 本轮未实现生产一键更新、发布签名、Android keystore 或 GitHub 发布。多人协作/本地 AI/开源讨论已记录于 `docs/sessions/2026-09-15-019-build-and-roadmap.md`。
- 当前接力认领：本轮原生构建工作已完成并释放；后续工作按 P0/P1/P2/P3 推进，不自动创建子任务、不擅自部署或推送。
- P0：发布签名与正式更新链路、Android release/multi-ABI、真机安装验收、全量检查；P1：成员/邀请/RBAC/审计/同步；P2：Agent Principal 与本地 AI 治理；P3：安全扫描、许可证确认、GitHub 开源准备。

## 020 当前状态：GitHub 开源准备已完成，等待用户决策

- 已完成公开仓库基础整理：补强 `.gitignore`，排除 Android/Windows 构建产物、JNI 目录、Gradle 本地目录、数据库、凭据和签名材料。
- 已新增 `CONTRIBUTING.md`、`SECURITY.md`、`docs/OPEN_SOURCE_READINESS.md`，明确分层、验证、安全报告和开源前置条件。
- README 已改为公开开发说明，避免把生产登录流程、服务器运维信息和真实部署地址作为公开使用入口。
- 审计确认：当前无 GitHub remote、无正式提交历史；未发现已提交的真实密钥，但现有历史文档/API 示例仍含生产 IP、服务器路径和内部运维内容，公开前需逐文件决定是否移除或改写。
- 本轮没有创建 GitHub 仓库、添加许可证、提交 Git、推送代码、发布二进制或修改服务器。
- 待用户确认：GitHub 账户/组织、仓库名、公开或私有、许可证、是否公开部署文档/历史接力记录，以及是否公开 EXE/APK。
- 本轮记录：`docs/sessions/2026-09-15-020-open-source-readiness.md`。

## 018 当前状态：Windows 成品完成，Android 与更新待收尾

- 正式产品名为 Orivane Atlas；dev.arclattice.app 暂保为稳定包标识。
- Windows 成品：src-tauri/target/release/bundle/nsis/Orivane Atlas_0.0.1_x64-setup.exe，SHA256 A5C2F3598F161CD16B32D947B47646B08124507EA44483F397AA81D9BE9D6AD6。
- Android native 编译通过，Gradle APK 因 Kotlin DSL 插件解析失败未生成。
- IndexedDB 草稿已按 workspaceId/principalId/文档 key 持久化；服务器仍为权威，未实现完整离线写队列。
- 一键更新入口/发布配置仍待接入，必须确定 HTTPS 更新源、Windows updater 公钥与签名流程、Android Play 或 Package Installer 渠道及 keystore。
- 本轮记录：docs/sessions/2026-09-15-018-orivane-native-client.md。

## 015 当前状态：已部署，认领完成并释放

## 016 当前状态：原生构建接手，工具链阻塞

### 2026-09-15 续接结果

- 已确认并准备复用旧项目工具链：F:/ZProjectBuild/AndroidSdk 含 Android 35、build-tools 35.0.0、NDK 26.1.10909125、adb；JDK 21 与 Gradle cache 均存在。
- 已将 Rust 安装尝试限制在 F:/Software/ArcLattice-native-toolchain；安装器两次恢复/下载后仍报告 toolchain is not installable，没有可用 cargo/rustc。未改全局 PATH。
- 实际命令 pnpm exec tauri android init 在设置 Android/JDK/Gradle 环境后因 cargo metadata 找不到而退出1；未生成 Android 工程、APK 或 EXE。
- 更新功能仍未实现：Windows 需签名 Tauri updater，Android 需选 Play In-App Update 或系统 Package Installer 渠道，并准备发布元数据/签名材料；本轮未写入凭据或伪造发布配置。
- 下一步：取得可用 Rust MSVC 与 Visual Studio C++/Windows SDK 后重跑 doctor/init；再按 ADR0015实现 updater 契约与平台入口，执行真实 NSIS/APK 构建和签名状态核验。
- 续接结果：轻量方案已落地 LLVM-MinGW 20260908 + Rust GNU 1.98.1，doctor 通过；首次 connected build 因 crates.io 访问失败（代理 127.0.0.1 不可连接）退出1。需恢复 Cargo 网络或提供 crates 缓存后继续。
- 成品结果：MSYS2 UCRT64 GCC 已安装到 F:/Software/ArcLattice-native-toolchain/msys2，Windows GNU 编译与 NSIS 打包成功。安装包路径为 D:/Lib/Codex_workplace/ArcLattice/src-tauri/target/release/bundle/nsis/ArcLattice_0.0.1_x64-setup.exe，SHA256 AC66C7FFDB8C7A9E60A8F0798A3390095CE73205601FC24335672ED93DFA4AB1。Android init 成功；APK 构建因 static.crates.io 连接代理失败而未完成。

2026-09-15：本轮接手 EXE/APK 构建。项目目的仍为 Orivane Atlas 工作台；本轮只处理 Tauri 原生打包，不改变 Domain/Application/权限边界。connected 配置安全检查通过，明确无 remote IPC permissions。当前未生成 EXE、NSIS 或 APK。

- 已检查：Node v24.20.0、pnpm 11.19.0；src-tauri/tauri.connected.conf.json 指向 HTTPS 生产地址，bundle 为 NSIS，src-tauri 已有 Android 图标资源。
- 阻塞：本机没有 cargo/rustc、Java、Android SDK/ADB、MSVC/Windows SDK；Tauri Android 工程尚未初始化。Rust 安装器下载至 F:/Software/ArcLattice-native-toolchain，但现有残留 rustup-init 进程锁定安装文件，尚未形成工具链。
- 未做：未安装大型系统工具链、未改服务/部署、未写凭据、未伪造构建产物。F盘目录可继续复用。
- 下一步：清理仅属于本轮的 rustup-init 残留后完成 Rust MSVC 安装；安装/确认 Visual Studio C++ 与 Windows SDK；安装 JDK、Android command-line tools、platform-tools、build-tools、NDK；随后分别运行 doctor、connected EXE 构建、Android init/release 构建，并对产物做文件/哈希/签名状态核验。
- 新增产品要求：两个软件都必须支持软件内一键更新到最新版。按 ADR0015，Windows 接 Tauri Updater 签名更新；Android 按渠道接 Play In-App Update 或系统 Package Installer 确认安装。尚未实现/配置/验收；生产 updater 私钥、Android keystore、商店凭据不得进入仓库或接力文档。

本轮验证结果：pnpm desktop:doctor 退出码 1（配置安全检查通过；cargo/rustc 缺失）。EXE/APK 构建未运行，因为前置工具链不满足。

认领范围：F:/Software/ArcLattice-native-toolchain 工具链目录与 src-tauri 原生构建验证；无其他对话重叠已知信息。

2026-09-15：公式实时预览、全局字号、任务渐变/归档/软删除、笔记日记批量整理已上线 https://123.207.179.150。SQLite v7 / OpenAPI0.6.0。apps/web、application、storage-sqlite、host、i18n、测试/API/迁移与文档认领释放；下方014及更早维护记录仅历史。

- 本地最终pnpm check：15文件283项、lint/边界/类型/构建通过；构建后E2E42/42通过，最终lint通过。服务器check:server-safe的lint/类型通过，备份测试超默认5秒（246通过/1超时），整体命令退出1。相同wrapper以test:server-safe --testTimeout=15000重跑247/247通过；直接Vite构建Host127ms、Web3.79秒通过，不提高资源限额。
- 00:04:28–00:10:13 CST仅维护arclattice-web；现web3809377、HTTPS3649322。原站nginx740821/class-manager-api2049871/zproject-api3033350不变，首页及/api/health均200。无共享配置/网关/units/依赖变化。公网API0.6.0/schema7/290816字节备份验收成功；公网桌面/手机浏览器0 JS错误/0业务写入，截图已检查、会话登出。
- 快照脚本为root审查config/snapshot-015.mjs（支持v1–v7）。data/backups/pre-015-20260915.sqlite与pre-015-restore-check.sqlite验证v6；post-015-ready-v7-20260915.sqlite与post-015-v7-restore-check.sqlite验证v7完整性/外键及新文件恢复。旧产物uploads/artifacts-pre-015.tar.gz保留。不能用旧014代码打开v7库，回退不能只换产物。
- 下一轮源码基线uploads/source-015-final.sha256（254文件）；先核对远端全部清单与新增文件。本地主副本关系不变，Git未跟踪成果不可清理。会话记录sessions/2026-09-15-015-workbench-organization.md，设计ADR0014。
- 公式支持段落中的行内和多行数学，活动公式保留源码并显示预览；代码不渲染。不是全部Obsidian语法兼容。批量整理最多100项、同工作区平级文件夹（不是知识空间转移）；保留正文/日期，删除可恢复。色相按ID稳定分配，不保证任意数量绝无同色。
- 下一步：前端约1.75MB大包/独立staging构建、更多公式语境和草稿持久保护。真实AI、自动异机接收机/计划、原生工具链仍需用户选择，未在本轮完成；未重跑PDF验证或服务器PG/浏览器。

~~~sh
cd /srv/arclattice/workspace
sha256sum --quiet -c /srv/arclattice/uploads/source-015-final.sha256
runuser -u arclattice -- git ls-files --others --exclude-standard
~~~

## 014 历史：透明品牌修复

2026-09-14：用户确认修复Logo白框。原因是CSS白底而非PNG不透明；已移除背景/圆角，登录宽度上限260px、侧栏180px（手机126px），CSS浅色单色显示保留原图透明通道。没有重绘/替换图片或改业务/API/数据库。014工作认领完成并释放。

- 本地pnpm check：15文件278项、lint/边界/类型/构建通过；构建后pnpm test:e2e：36/36通过；最终lint通过。桌面/手机登录与侧栏截图已查看。
- 22:47:39–22:47:43 CST仅停本项目web，经原限额wrapper直接Vite构建3.13秒成功。现web PID3789290，HTTPS3649322；原站三个PID不变、首页及/api/health均200。公网浏览器验收通过，无JS错误/业务写入，已登出。
- 一致性快照data/backups/pre-014-20260914.sqlite（v6）及旧Web产物uploads/artifacts-pre-014.tar.gz保留。本轮无迁移、不重跑服务器全量测试/PG/浏览器或PDF验证。
- 当前源码基线：/srv/arclattice/uploads/source-014-final.sha256，248文件。先核对清单与新增文件，再改服务器主副本；本地只是验证镜像。不盲目覆盖。014不可变记录：sessions/2026-09-14-014-transparent-brand.md。
- 下方013功能与未完成边界继续有效，但其维护PID/源码基线为历史。下一步仍为路由拆包/独立staging构建；真实AI供应商、异机备份接收端、原生工具链需用户选择，不能算已完成。

~~~sh
cd /srv/arclattice/workspace
sha256sum --quiet -c /srv/arclattice/uploads/source-014-final.sha256
runuser -u arclattice -- git ls-files --others --exclude-standard
~~~

## 013 功能基线（部署操作记录为历史）

2026-09-14：Orivane Atlas 品牌、统一实时编辑、日历日记、知识/任务画布、个人AI、长期凭证已部署，SQLite v6 / OpenAPI 0.5.0。apps/web、application、host、storage-sqlite、i18n、测试与相关文档的013工作认领完成并释放。以下013内容优先，下方012/011仅历史。不可变记录：sessions/2026-09-14-013-orivane-atlas.md。

### 下一轮以本节为准

- 入口 https://123.207.179.150；HTTP80仍是原站。维护重启使旧会话失效，请重新登录。没有重置账号、密码或访问密钥，没有创建生产测试数据。
- 名称/用户logo已接入，账号登录/注册切换移至表单下方；笔记/日记/空间/讲义统一主区域标签页，实时预览/源码/阅读、1秒自动保存/Mod-S、IME保护、导入导出/修订/私有图片/打印PDF。日历打开唯一日记，空草稿不写库，已删日记可恢复。
- RELATED是允许环的无向关系，REFERENCES有向；NOTE/WORK/SPACE/DOCUMENT混合画布，拖动/连线/删除/打开对象，默认200节点可加载更多，布局仅内存。任务依赖画布仍验证DAG。
- 个人/任务项目/知识空间分别配置本人的Chat Completions或Responses提供商；生产不读管理员全局ARCLATTICE_MODEL_CONFIG。公网HTTPS443/地址校验/DNS绑定，显式选择上下文并审批，逐项审核后事务应用文本建议。实际供应商尚未配置/调用，日调用限额不是费用预算。
- API凭证30/90/365天或null长期，默认30天，旧expiry不变，支持撤销且改密/停用失效。Bearer不能管理提供商/调用服务器AI/管理账号/下载全库。外部AI可经OpenAPI0.5.0读写授权工作区。
- SPACE/DOCUMENT已进入知识关系和在线同步。草稿/重试键仅页面内存；会话过期可同身份重认证，冲突需审阅合并。仍无持久离线队列/CRDT、完整Obsidian插件/块引用、原生安装包或已启用的自动异机备份。
- data/vault/master.key和providers.enc是独立受限加密凭据库，不在SQLite/异机拉取备份中；灾备需重新配置提供商或另行安全保管两者。业务数据库备份含账号验证器/图片/已授权AI上下文，须私密保存。
- 服务器主副本 /srv/arclattice/workspace；本地为核验后的验证镜像。013代码包246文件，旧012-final的232文件部署前再次验证无漂移。收尾基线为 /srv/arclattice/uploads/source-013-final.sha256（247文件），下一轮先核对全部清单和新增文件，绝不盲目覆盖。Git无提交/远程，未跟踪文件都是成果。
- 先读 AGENTS、本文、PROJECT_STATUS、DEPLOYMENT、ADR0008/0009/0013，以及ACCOUNTS_LIBRARY/CONNECTED_OPERATIONS。不要自动创建任务或子代理。

### 013 实际验证与部署

- 本地 pnpm check：15文件/278项通过，lint/AST/类型/Host+Web构建通过；最后新增混合图测试及修正文案后补跑lint/typecheck/build，浏览器全量最终33/33通过。曾出现移动端DOM fill仅插入而未替换，测试改为编辑器键盘全选输入后，三布局各重复3次共9项通过。
- 共享机wrapper check:server-safe的lint/类型、13文件/242项及Host构建通过；Web阶段因嵌套pnpm/turbo与内存高水位持续回收而人工停止，不能称该整体命令成功。相同wrapper/不提高限额，直接运行Vite后3.40秒成功。无PG/浏览器/全局工具链。准确补建命令见DEPLOYMENT。
- 维护：22:02:40停止本项目web；22:16:51启动；22:17:10健康就绪确认（均CST）。最终双语文案补建于22:24:54–22:24:58仅停本项目web；22:28:05复核web3783773、HTTPS3649322 active/enabled。原站nginx740821/class-manager-api2049871/zproject-api3033350未变，首页及/api/health均200。未改原站、共享配置、网关、防火墙或units。
- v5升级前 pre-013-20260914.sqlite / pre-013-restore-check.sqlite；v6就绪后 post-013-ready-v6-20260914.sqlite / post-013-v6-restore-check.sqlite 均验证完整性与外键，新文件恢复，不覆盖活库。脚本为root审查snapshot-013.mjs。
- 外网verify-release通过：可信TLS、首页/health200、匿名401、Secure会话/CSRF、条件同步/library/admin/API0.5.0，备份253952字节/schema6，aiConfigured=false；最终重启后verify-release-browser再次通过全部页面，个人配置提示已纠正、无JS错误/业务写入，验收会话登出。

### 精确命令

~~~sh
cd /srv/arclattice/workspace
sha256sum --quiet -c /srv/arclattice/uploads/source-013-final.sha256
runuser -u arclattice -- git status --short
runuser -u arclattice -- git ls-files --others --exclude-standard
systemctl is-active arclattice-web arclattice-https
curl --fail -H 'Host: 123.207.179.150' http://127.0.0.1:4317/api/health
/srv/arclattice/admin/run-limited.sh /srv/arclattice/toolchain/pnpm/node_modules/.bin/pnpm check:server-safe
~~~

本地：pnpm check；先build再pnpm test:e2e。只读公网：node scripts/verify-release.mjs https://123.207.179.150 C:/Users/admin/AppData/Local/ArcLattice-private/access.key；浏览器脚本为scripts/verify-release-browser.mjs（相同参数）。备份端点每分钟一次，不快速重复。服务端禁止全量PG测试或浏览器。

下一步：前端按路由拆包/独立staging构建减少维护；草稿持久安全存储/附件回收；真实提供商需本人配置并批准测试；自动异机备份需用户指定接收机/计划/密钥保管；原生安装需大型工具链选择。不要把上述未完成项视作已交付。

## 012 历史记录（不是当前状态）

2026-09-14：账号/管理员、外部AI API、独立知识空间/讲义/图片/打印PDF已完成实现、本地验证和服务器部署。范围 Application、SQLite v5、Host、Web/i18n、测试/OpenAPI/部署文档。服务仅在16:20:22–16:26:23 CST停止本项目web构建；现web PID3700886，HTTPS3649322，均active/enabled。原站三个PID与首页/健康200保持。没有创建生产测试账号、默认管理员或示例讲义。

### 下一轮以本节为准

- 入口 https://123.207.179.150。使用旧访问密钥登录→账号与API→自行绑定管理员用户名/密码→退出后用新账号登录。普通注册需管理员审核且工作区隔离，不能接管旧数据。旧密钥保留恢复能力，切勿共享。
- 使用说明 docs/ACCOUNTS_LIBRARY.md；设计 ADR0012；OpenAPI0.4.0，推荐/api/v1。read-write允许读取私人正文；write能创建/更新/删除/恢复且响应含被操作对象，不是盲写或仅上传。Bearer不可管理账号/备份/调用服务器AI/Shell。30天凭证仅显示一次，改密/停用撤销。
- SPACE/DOCUMENT独立于任务PROJECT，支持Markdown/数学公式/修订/图片/软删恢复/.md导入导出/A4浏览器打印PDF。单图片500,000字节，工作区图片约20MB；图片不支持硬删回收配额。讲义尚未接旧NOTE/WORK知识图和/api/sync，当前手动刷新；非服务端PDF生成。
- 远端主副本/srv/arclattice/workspace。本轮同步前011-final的218文件及新增文件均无漂移；012-code为231文件，最终收尾清单/srv/arclattice/uploads/source-012-final.sha256。下方011清单仅历史，下一轮必须校验012-final并盘点新增文件，再同步。
- 先读AGENTS、本文、PROJECT_STATUS、DEPLOYMENT、ADR0008/0009/0012及相关架构。不自动创建任务或子代理。Git main无提交/远程，未跟踪文件是项目成果，不得清理。

### 012 实际验证

- 本地pnpm check：14文件/240项通过，lint/AST边界/类型/Web+Host构建通过；pnpm test:e2e：27/27，桌面en/zh及移动zh。Host31项包括跨租户、撤销后的延迟请求/重放、密码/凭证、管理员审批和v5备份恢复。OpenAPI引用与别名契约1项通过。
- 本地PDF测试：1页A4、80,378字节；已渲染检查中文/公式/表格、打印无应用页脚。实际查看桌面/移动讲义、账号、管理看板截图。
- 共享机仅wrapper check:server-safe：12文件/204项、lint/类型/构建通过。未跑PG或浏览器。前端798.45KB未压缩bundle警告保留，非构建失败。
- v4升级前pre-012-20260914.sqlite及pre-012-restore-check.sqlite；health就绪后的post-012-ready-v5-20260914.sqlite及post-012-v5-restore-check.sqlite均验证通过。现使用root审查snapshot-012.mjs，支持v1–v5。
- 外网verify-release：可信TLS、首页/health200、匿名401、Secure会话/CSRF、条件同步、library/admin/API0.4.0通过；备份241664字节、schema5。verify-release-browser：管理员绑定入口/四指标看板/知识空间/旧知识与AI页通过，无JS错误，无业务写入，验收会话已登出。
- 新生产截图test-results/release-012-account.png、release-012-admin.png、release-012-library.png已查看，无横向溢出。未替用户实际绑定管理员；注册/审批/本地AI写入端到端仅隔离库测试，不向生产写样例。

### 精确命令与接续工作

~~~sh
cd /srv/arclattice/workspace
sha256sum --quiet -c /srv/arclattice/uploads/source-012-final.sha256
runuser -u arclattice -- git ls-files --others --exclude-standard
systemctl is-active arclattice-web arclattice-https
curl --fail -H 'Host: 123.207.179.150' http://127.0.0.1:4317/api/health
/srv/arclattice/admin/run-limited.sh /srv/arclattice/toolchain/pnpm/node_modules/.bin/pnpm check:server-safe
~~~

本地验证和只读外网验收命令沿用下方，但当前结果以012为准。源码包不含数据库/私钥/构建产物；最终文档同步不重启服务。详细记录sessions/2026-09-14-012-accounts-library.md。012所有模块认领释放。

优先后续：账号过期重认证/草稿可靠性、讲义接入统一知识关联与在线同步、附件容量/回收、API客户端持久重试队列；须新ADR/测试，不扩成任意Agent执行。仍未完成真实模型配置、自动异机备份（缺用户指定接收机/计划/密钥保管）、原生安装包（缺大型工具链授权）。多用户仅当前单管理员与私人工作区，不是完整RBAC/协作分享。其他长期缺口见PROJECT_STATUS。

## 011 历史记录（以下不是当前部署状态）

更新：2026-09-14（Asia/Shanghai），会话011。IP HTTPS已更新至知识引用/在线同步/受控AI请求切片，SQLite v4。不是完整v0、自治Agent、离线同步或原生安装包。附件是需求参考，不构成额外操作授权。

## 下一轮先看

- 入口 https://123.207.179.150，必须HTTPS；HTTP80仍为原站，无需隧道。服务重启后需用工作台密钥重新登录，不是SSH密码。
- 源码主副本 /srv/arclattice/workspace；本地 D:/Lib/Codex_workplace/ArcLattice 为核对后的验证副本。先校验远端清单和新增文件，不覆盖并行修改。
- 阅读远端 AGENTS → 本文 → PROJECT_STATUS → DEPLOYMENT → ADR0008/0009/0010/0011 → architecture/AMENDMENTS及相关章节。
- arclattice-web.service回环4317，arclattice-https.service443，active/enabled。旧preview已停，禁用同库双宿主。不得动原站、共享nginx或整机。
- 正确SSH为root@123.207.179.150:22，strict known_hosts；server-ipv4别名为另一机器，禁止复用。凭据保持受限文件、仓库外，不输出。

## 011交付与边界

1. 知识：跨笔记/日记/任务/项目标题和Markdown正文检索、稳定ID的REFERENCES/RELATED、入链/出链、打开编辑器、版本化软删关联。不是Book/Document/附件/embedding/完整图画布。
2. 在线同步：一致性快照SHA256游标、前台5秒及focus/online刷新、离线提示。两独立会话更新/草稿保护/旧版本冲突通过浏览器测试。无离线持久队列、CRDT或设备撤销。
3. AI：人工输入→审核→明确批准/拒绝→单次模型请求→仅展示结果。无自动知识上下文、工具或任务修改。配置摘要绑定审批、单并发/日限额、响应/时间上限、重启中断不重发、独立Audit。服务器未配置模型，无真实提供商外发。
4. 异机备份：HTTPS鉴权拉取、SQLite检查、AES-256-GCM、原子新归档、独占锁、新文件恢复及定时模板通过测试。接收机/计划/密钥保管未选择，未启用任务、未实际外发业务库。
5. 原生：Tauri连接overlay/doctor，远端无IPC权限。仅WebView2存在，缺Rust/Cargo/MSVC/SDK，未安装大型工具链，未生成exe/签名/Android。

原任务/依赖/项目/日期/月历、笔记/日记/全修订/Markdown导入导出、回收站/设置/全库备份保持。中英/移动布局通过。操作见 CONNECTED_OPERATIONS.md 和 OFFSITE_BACKUP.md。

## 实际验证与部署

- 本地 pnpm check：13文件/229项、lint/边界/typecheck/Web+Host build通过。最终OpenAPI/验收脚本修改后又通过lint/typecheck。
- pnpm test:e2e：24/24（桌面en/zh、移动zh）；AI使用测试替身。查看知识/审批/结果实际截图。
- 服务器仅wrapper check:server-safe：11文件/193项及类型/构建通过，36项PG只在Windows运行。
- 14:45:14–14:47:31 CST仅停本项目web进行构建。新web PID3677307，https仍3649322；原站nginx740821/class-manager-api2049871/zproject-api3033350未变，首页及健康200。
- SQLite追加v4；v3升级前和v4就绪后快照及各自新文件恢复成功。启动瞬间首次health未就绪，post-011-20260914.sqlite实际为v3，保留；确认就绪后另建post-011-ready-v4-20260914.sqlite与post-011-v4-restore-check.sqlite，均v4，不覆盖旧备份。
- 外网可信TLS、首页/health200、匿名401、登录/读取/条件同步/备份/CSRF通过，备份184320字节，AI路由null。Chromium直连公网知识/AI页面通过，无JS错误/业务写入，验收会话退出。
- 未验证真实模型计费调用、实际接收机定时备份、原生安装、LinuxPG/真实PG dump/restore、长期压力/渗透/证书续期周期/整机重启。

## 检查点与精确命令

Git main无提交/远程，全部未跟踪文件都是成果，不可清理。不存在自动源码双向同步。

~~~sh
cd /srv/arclattice/workspace
sha256sum --quiet -c /srv/arclattice/uploads/source-011-final.sha256
runuser -u arclattice -- git status --short
runuser -u arclattice -- git ls-files --others --exclude-standard
systemctl is-active arclattice-web arclattice-https
curl --fail -H 'Host: 123.207.179.150' http://127.0.0.1:4317/api/health
/srv/arclattice/admin/run-limited.sh /srv/arclattice/toolchain/pnpm/node_modules/.bin/pnpm check:server-safe
~~~

只在本地隔离机执行 pnpm check；先build再pnpm test:e2e（1420/1421）。只读外网验收：

~~~powershell
node scripts/verify-release.mjs https://123.207.179.150 C:/Users/admin/AppData/Local/ArcLattice-private/access.key
node scripts/verify-release-browser.mjs https://123.207.179.150 C:/Users/admin/AppData/Local/ArcLattice-private/access.key
pnpm desktop:doctor
~~~

备份端点每分钟一次，不快速重复。source-011-code.tar.gz为构建输入（216文件，SHA256 a63cfcb5107c396a8496728850d547c6fb7e5073c3a3880aada38741372a6797）。source-011-final含收尾文档和只读浏览器验收脚本。artifacts-pre-011保留旧产物，旧代码不可打开v4活库；数据备份独立于源码包。

## 剩余与选择

优先真实集成：用户选定模型endpoint/model/私有key文件/限额→配置并人工批准无私密内容的一次真实推理；选择可信第二台接收机/目录/时间/密钥保管→手动加密备份与新文件恢复后启用任务；允许Rust/MSVC安装→编译、权限、安装/下载/导入/升级验收。不能把脚本/配置当成这三项已经交付。

其他缺口：完整知识模型/图画布、项目层级/状态编辑/Timeline/提醒、LOCAL_ONLY/离线复制、多用户RBAC、规划/证据/来源/Agent工具运行集成。固定PRIVATE/REMOTE/AI DENY/HUMAN不是完整Policy/Provenance。Activity/Outbox无投递worker；Audit只覆盖执行关键点，无完整审计产品。AI记录1000上限，无归档/retention。PG v2只接任务；会话过期重认证体验、关闭页面丢草稿和持续运维仍需完善。

## 010保留与认领

010用户报告access.key路径不存在；仅确认开发机LAPTOP-HNH4EO4O/admin副本存在，不能假设另一终端存在。经验证SSH读服务器现有key至用户剪贴板的方案见DEPLOYMENT和sessions/2026-09-14-010-access-key-location.md；未重置密钥，用户本人登录结果尚未确认。010文档本轮一并同步。

011 Application/SQLite/Host/Web/i18n/native/backup/tests/docs认领完成并释放，009及更早已释放。会话记录：sessions/2026-09-14-011-connected-workbench.md。下一轮先认领/检查重叠，不自动创建任务或子代理。
# 020 当前状态：项目入口已迁移至 11220，443 已释放

2026-09-15：Orivane Atlas 当前入口为 https://123.207.179.150:11220；项目宿主仍仅监听 127.0.0.1:4317。项目专属 Caddy 当前监听 *:11220 并返回首页 200。项目 443 监听已停止；arclattice-https.service 当前 active 但 disabled，避免重启后自动恢复旧入口。

- 本轮只修改项目专属 Caddy 与 web unit，迁移前备份为 /srv/arclattice/config/Caddyfile.pre-11220-20260915 与 /srv/arclattice/config/arclattice-web.service.pre-11220-20260915。
- 现场核验发现服务器当前没有任何进程监听 80；原站 Nginx 未停止、未修改，实际监听 *:8088。原站 nginx、class-manager-api、zproject-api 均 active。
- 实际监听仅见项目 127.0.0.1:4317、*:11220，以及原站 Nginx *:8088；443 无监听。
- 未修改原站 Nginx 配置、原站目录、原站 API、共享防火墙或共享网关；未把 80 交给本项目。
# 021 当前状态：仅账号密码登录，服务器账户已初始化

2026-09-15：登录页已收紧为仅用户名、密码和登录按钮；页面不再显示注册、访问密钥登录或宣传内容。服务端已关闭公开注册接口与旧访问密钥会话入口。项目仍通过 https://123.207.179.150:11220 提供服务，80/443 均无监听。

- 服务器端已创建并激活三个账户：admin（ADMIN）、test（USER）、gaugefield（USER）。
- 当前账户仅能由服务器管理路径创建/激活；密码只保存为不可逆验证器，不写入源码、日志或接力文档。
- gaugefield 使用用户本轮提供的密码；管理员和测试账户密码为本轮服务器端随机生成值，已在本轮对话中交付给用户。
- 本轮页面部署前备份：/srv/arclattice/config/Login.tsx.pre-login-only-20260915、/srv/arclattice/config/server.ts.pre-login-only-20260915。
# Orivane Atlas 接力文档

## 020 当前状态：原生 11220 重建已登记，待补齐构建缓存

- connected 配置已改为 `https://123.207.179.150:11220`，未修改服务器监听。
- 本轮 Windows connected 重建因 crates.io 代理/本地 Cargo 缓存不足失败；Android 重建因 Gradle Kotlin DSL 5.2.0 插件缓存不足失败。
- 旧 EXE/APK 保留但不作为本轮 11220 可用版本；未生成新产物。
- 记录：`docs/sessions/2026-09-15-020-native-11220-rebuild.md`。
- 下一步：恢复 Cargo/Gradle 依赖获取后重建，再做哈希、签名和真机验收。
# 021 当前状态：Apache-2.0 已确认，等待公开边界整理与 GitHub 连接

- 本轮范围：为 Orivane Atlas 准备 GitHub 开源，不推送、不覆盖远端。
- 许可证：Apache-2.0；根目录 LICENSE 已新增。
- 目标仓库：https://github.com/LiangzhengZhou/OrivaneAtlas。
- 已检查：Git 状态、CI、敏感信息模式和上级 Temp 目录；确认没有 GitHub remote，且未发现已提交真实密钥。
- 当前阻塞：git ls-remote 被本地代理 127.0.0.1:7890 拒绝连接，无法确认远端是否为空；不得强推。
- 公开前必须完成：脱敏或排除生产部署文档、历史接力文档、服务器脚本和 OpenAPI 生产地址；检查 CI 不读取生产凭据；再制作经过筛选的首次提交。
- 不公开：数据库、data/vault、密钥、用户文件、签名密钥、F 盘工具链和 debug APK。
- 本轮未运行：pnpm check、原生构建、Git commit、Git push。

## 022 当前状态：公开源码已推送，二进制待 Release 上传

- Apache-2.0 公开源码已推送到 GitHub main。
- 已排除生产运维资料、账户信息、服务器地址、历史接力文档和原生构建产物。
- 已追加提交脱敏 OpenAPI/开发文档；公开 HEAD 不再包含生产 IP、服务器路径或本机账户路径。
- EXE/APK 不进入 Git 历史；待创建 GitHub Release 作为资产上传。APK 是 arm64 debug 包，EXE 尚未正式签名。
- 当前未运行 pnpm check；当前工作区仍保留未跟踪的私有接力/部署资料，不得 git add。
