# 项目状态

## 023 GitHub Release 增量 — 调试构建已公开发布（2026-09-15）

- GitHub 公开仓库：`https://github.com/LiangzhengZhou/OrivaneAtlas`。
- 已发布预发布版本 `v0.0.1-debug`，标题为 `Orivane Atlas v0.0.1 Debug Builds`。
- EXE 资产已公开：`Orivane.Atlas_0.0.1_x64-setup.exe`，SHA256 `A5C2F3598F161CD16B32D947B47646B08124507EA44483F397AA81D9BE9D6AD6`。
- APK 资产已公开：`app-arm64-debug.apk`，SHA256 `6A2346B68E33D3769321D77F3C9EEB62F1CB616360070D67AF5591CE809784A6`。
- 本次 Release 明确标记为 Pre-release；APK 是 arm64 debug 包，EXE/APK 均不是正式签名发布包。
- 未上传私有运维资料、历史接力文档、账户信息、服务器凭据或生产配置；构建产物未进入 Git 历史，仅作为 Release 资产发布。
- 已验证：Release 页面显示正确 tag、标题、预发布标记、两个资产及摘要；之前的空标签错误已解决。
- 仍未完成：Windows/Android 软件内一键更新生产链路、正式签名与密钥管理、Android release/multi-ABI、真机安装验收。

## 015 当前增量 — 已实现、验证并部署

## 019 原生构建增量 — EXE 与 APK 已构建

- Windows Orivane Atlas NSIS 安装包已验证存在，SHA256 为 `A5C2F3598F161CD16B32D947B47646B08124507EA44483F397AA81D9BE9D6AD6`。
- Android arm64 debug APK 已由 Gradle 成功构建并通过 `apksigner verify` v2 校验，SHA256 为 `6A2346B68E33D3769321D77F3C9EEB62F1CB616360070D67AF5591CE809784A6`。
- Android 仅 arm64 debug；未完成 multi-ABI/release 签名/商店包。全量 `pnpm check`、E2E、本机安装验收和一键更新生产链路未在本轮运行/完成。
- 本轮没有服务器变更、GitHub 推送、许可证选择或凭据写入。

### 当前完整交付边界

- 已实现并部署：Orivane Atlas Web 工作台、SQLite v7、OpenAPI 0.6.0、Markdown/知识空间/任务画布、个人 AI 配置机制、IndexedDB 本地草稿、账户与管理员基础能力。
- 已构建但未正式发布：Windows NSIS EXE；Android arm64 debug APK。两者均连接现有 HTTPS 服务；Android 本地草稿只属于客户端缓存，服务器仍是权威数据源。
- 仅设计/骨架：Windows/Android 软件内一键更新、多人协作权限模型、本地 AI Agent Principal/审批流、GitHub 开源发布流程。
- 明确未完成：正式签名与发布渠道、Android multi-ABI/release、真机验收、完整离线队列/CRDT、完整 RBAC/协作实时同步、真实 AI 供应商验收、自动异机备份启用、GitHub 发布与许可证选择。

### 工具链与构建位置

- Windows/Rust 工具链：`F:/Software/ArcLattice-native-toolchain`，使用 LLVM-MinGW、MSYS2 UCRT64、Rust GNU 1.98.1。
- Android SDK/NDK/JDK：`F:/ZProjectBuild/AndroidSdk`、NDK 26.1.10909125、`F:/ZProjectBuild/Java/microsoft-jdk-21/jdk-21.0.12.1+1`。
- 本轮未安装 Visual Studio，未修改服务器或其他 Web 服务。

## 020 开源准备增量 — 已完成基础整理，尚未发布

- 已新增公开贡献与安全文档：`CONTRIBUTING.md`、`SECURITY.md`、`docs/OPEN_SOURCE_READINESS.md`。
- `.gitignore` 已补充原生构建产物、Android Gradle/JNI 本地目录、数据库、凭据和签名材料规则。
- README 已调整为公开开发者入口，不再把生产登录/运维流程作为公开仓库使用说明。
- 已执行工作区文本审计：未发现已提交真实密钥；测试 secret/password/token 属测试数据或变量。
- 当前仍不可称为“已开源”：无 GitHub remote、无正式提交历史、无 LICENSE；历史文档/API 示例仍含生产 IP 和内部运维信息，尚未完成公开/私有文档分离。
- 未执行：GitHub 建仓、首次提交、推送、许可证选择、完整 Git 历史 secret scan、公开仓库发布、Release 和 CI 公开验收。

本轮新增行内/多行数学实时预览（不改变Markdown原文）、界面16px/正文18px、任务稳定色相渐变、任务归档/取消归档/软删除、笔记与日记勾选/最多100项同工作区文件夹移动与软删除。归档独立于完成状态；文件夹是平级组织元数据，不是知识空间或跨工作区转移。删除可在回收站恢复。

新增 Application OrganizationService、SQLite v7 元数据及事务Activity/Outbox，OpenAPI0.6.0 /api/v1/organize；双版本预检、整批回滚与幂等回执；正文/日期/种类保持。有未保存文档时禁止整理。ADR0014。

2026-09-15已部署SQLite v7/API0.6.0。本地最终check283项及42/42浏览器回归、最终lint通过。首轮E2E39/42，三失败均旧标题正则同时匹配新增操作按钮，限定标题后整套42/42通过。服务器受限check的lint/类型通过，备份测试超默认5秒使整体退出1；同限额提高测试时限至15秒后247/247通过，Host/Web分别直接Vite构建成功。升级前v6与升级后v7快照/新文件恢复通过。公网API及桌面/手机只读浏览器验收成功，截图已检查，无JS错误/业务写入。仅维护本项目web，原站PID/HTTP200不变；完整记录见会话015和DEPLOYMENT。

013/014未完成范围保持：真实AI提供商、自动异机备份接收机和原生安装包未交付；不新增自治工具权限。当前前端约1.75MB未压缩，有大包警告。

## 014 当前增量 — 透明Logo修复

2026-09-14已实现、验证、部署：移除品牌CSS白底/圆角，缩小登录与侧栏Logo，深色区以浅色单色显示；原PNG及alpha未改。UI层改动，无API/数据迁移。

- 本地完整check通过（15文件278项、lint/边界/类型/构建），全部E2E36/36通过，最终lint通过；新增3种布局的透明背景/原图alpha/尺寸回归。
- 服务器受限直接Vite构建3.13秒通过；公网只读浏览器验收通过，桌面/手机及侧栏截图已人工查看，0 JS错误/0业务写入，会话登出。仅重启项目web，原站服务PID及HTTP200保持。
- 本轮未重跑服务器check:server-safe/PG/浏览器、PDF或备份下载API；无Schema变化，一致性v6快照完成，未重复恢复演练。下方013功能完成度/未开始与仅骨架范围保持，不因本次视觉修复扩大。

## 013 当前状态 — Orivane Atlas

更新：2026-09-14。https://123.207.179.150 已部署 SQLite v6 / OpenAPI 0.5.0；下方012/011仅历史，不代表当前缺口。不是完整v0或完整Obsidian兼容。

| 范围 | 实际完成度 | 当前边界 |
| --- | --- | --- |
| 品牌/登录 | 已实现、验证、部署 | 用户logo/Orivane Atlas、登录/注册切换下置、中英/移动布局 |
| 统一Markdown工作区 | 已实现、验证、部署 | NOTE/JOURNAL/SPACE/DOCUMENT主区域标签页；基本实时装饰、独立公式/表格/私有图片原位预览；源码/阅读、1秒自动保存/Mod-S、IME、原文导入/导出/修订 |
| 草稿/冲突 | 已实现、验证、部署 | 关闭/锁定保护、同身份重认证、版本冲突审阅合并；草稿和重试键仅页面内存，崩溃/强制刷新仍可能丢失 |
| 日历与日记 | 已实现、验证、部署 | 点击本地日期打开唯一日记、空草稿不写库、删除后恢复；无周期日记模板/提醒 |
| 知识/任务画布 | 已实现、验证、部署 | NOTE/WORK/SPACE/DOCUMENT、RELATED无向可成环、REFERENCES有向；任务依赖仍DAG；拖动/连线/打开/删边，默认200节点；布局不持久 |
| 知识空间与同步 | 已实现、验证、部署 | 学科讲义/图片/修订/打印PDF并入关系图及5秒在线同步；无嵌套目录/任意附件/离线队列/CRDT/协作分享 |
| 个人/项目AI | 机制已实现、替身测试通过、已部署 | 每人每scope配置Chat Completions/Responses、HTTPS443/SSRF门禁、独立加密vault；显式上下文审批及人工应用原子文本建议；真实提供商未配置/未计费调用 |
| 本地AI API | 已实现、验证、部署 | OpenAPI0.5.0/v1别名、30/90/365/null长期凭证；撤销/改密/停用失效；Bearer不得调用服务端AI/配置模型/管理账号/下载全库；无持久重试客户端 |
| 账户/管理员 | 012功能回归通过、部署 | 待审核注册、独立工作区、唯一管理员审核/停用；无邮件重置/MFA/完整RBAC |
| 原生客户端 | 仅连接配置与doctor，未编译 | 无exe/签名/安装验收/Android；大型工具链尚未安装 |
| 自动异机备份 | 加密拉取/恢复工具与定时模板已隔离测试，未启用 | 缺用户指定接收机/计划/密钥保管；本机同盘快照不是异机灾备；vault须单独保管或重配 |
| 数据备份/迁移 | SQLite v6已迁移、备份/新文件恢复验证 | v5升级前与v6就绪后快照/恢复均通过；不覆盖活库；没有生产回退切换演练 |
| PostgreSQL/Agent治理 | 原切片验证保持 | PG36项仅Windows、无完整Notebook/HTTP；82项治理规则不是自治Agent；无任意工具/Shell |
| 运维/事件/Git | 私有HTTPS已部署，原站不变 | 无Outbox投递worker/完整审计产品；未测证书续期周期/压力/整机重启；Git无提交/远程 |

### 013 实际验证

- 本地完整pnpm check：15文件/278项、lint/AST边界/typecheck/Host+Web构建通过。后续图画布E2E、文案与测试操作修正再运行lint/typecheck/build和全部浏览器测试。
- 浏览器33/33通过，桌面en/zh、移动zh。混合图验证4种节点、4条无向成环边与1条有向引用；双击讲义打开正确正文。IME、自动保存、标签页、日历、冲突/同步、账号/API/图片/PDF及既有任务流程覆盖。
- 曾有1项移动端测试失败：DOM fill在实时装饰中插入文本而非替换。改为CodeMirror键盘全选输入，先断言正文后测关闭保护；三布局各3遍共9项通过，再全套33项通过。不是通过重试忽略失败。
- 共享机wrapper check:server-safe：lint/类型、13文件/242项测试、Host构建通过；前端阶段受内存高水位回收影响人工终止。相同wrapper下单独Vite构建3.40秒通过，不提高限额；整体check命令不记为成功。无PG/浏览器/全局安装。前端约1.49MB未压缩/482KB gzip有大包警告。
- PDF技能用于只读渲染复核：1页A4、54182字节，中文/公式/表格正常，无应用导航；脚本样例作为原文不执行。实际查看桌面/移动实时编辑、混合图以及公网AI/知识空间截图。
- 已完成v5升级前与v6就绪后快照及各自新文件恢复；公网可信TLS/匿名401/会话/CSRF/条件同步/API0.5.0/备份253952字节schema6通过。公网浏览器登录/个人配置/知识图/账号/管理看板/知识空间通过，无JS错误/业务写入，会话登出。最终服务PID与维护时间见DEPLOYMENT。

未验证：真实供应商/本地AI客户端集成计费、自动异机任务、原生安装、完整无障碍/渗透/压力、LinuxPG/真实PG恢复、TLS跨续期周期。图片限500000字节/工作区约20MB，仅签名检查非完整解码、无硬删回收。完整Obsidian语法/插件、WikiLink自动解析、Book/Concept/来源证据模型、离线复制仍非本轮交付。

## 012 历史状态（以下表格不是当前完成度）

更新：2026-09-14，会话012。https://123.207.179.150 已部署SQLite v5多账号工作台；不是完整v0。当前设计见ADR0012，账号与本地AI指南见ACCOUNTS_LIBRARY.md。

| 范围 | 实际状态 | 缺口 |
| --- | --- | --- |
| 工作台/任务 | 已实现、验证、部署 | 中英/响应式/看板/搜索/版本/软删/DAG；无自由图编辑 |
| 项目/日程 | 已实现切片、验证、部署 | 单层归属/完成比例/日期/月历；无层级、Timeline、提醒、项目状态编辑 |
| Notes/Journal | 已实现切片、验证、部署 | 原文/基础安全阅读/全部修订/导入审核/导出；无Book/Document/附件 |
| 账号/管理看板 | 012实现、验证、部署 | 用户名密码、待审核注册、单管理员绑定/审核/停用、工作区隔离；无邮件重置/MFA/完整RBAC/协作分享 |
| 本地AI API | 012实现、验证、部署 | OpenAPI0.4.0、/api/v1、30天独立Bearer身份/撤销/权限/幂等；无客户端持久重试队列，生产未写样例 |
| 学科知识空间 | 012实现、验证、部署 | 独立SPACE/DOCUMENT、原Markdown/公式/修订/搜索/软删/.md/私有图片/A4打印PDF；无嵌套目录、任意附件或服务端PDF |
| 知识关联 | 011实现、验证、部署 | 标题正文检索、NOTE/WORK稳定ID引用/相关/反向查看；尚未接SPACE/DOCUMENT，非完整知识模型/embedding/图画布 |
| 在线同步 | 011实现、验证、部署 | 5秒前台刷新、内容游标、草稿/冲突/离线提示；不含新讲义，非离线双向复制/CRDT |
| AI执行机制 | 实现、替身测试通过、部署未接模型 | 显式输入/审批/限额/单次请求/中断；需用户选provider/model/key/预算及真实调用，无自治工具执行 |
| 原生客户端 | 连接配置/doctor，未编译 | WebView2存在，缺Rust/Cargo/MSVC/SDK；无exe、签名、安装或Android |
| 加密异机备份 | 工具/恢复/定时模板实现并隔离测试 | 未指定接收机/计划/密钥保管，未创建自动任务或实际异机备份 |
| 手动备份/恢复 | 已实现、验证、部署 | 仅管理员全库下载；本轮v4升级前/v5就绪后备份与新文件恢复；含账户验证器/图片，须私密保存；无覆盖活库API |
| SQLite | v5部署验证 | 新账户/凭证/知识空间/讲义/图片；事务变更/receipt/事件、独立Audit；旧迁移不变 |
| PostgreSQL | v2数据层验证，未部署 | Windows真实集群36项；无Notebook/Connected/HTTP及真实dump/restore |
| Activity/Outbox/Audit | 事务事件和执行关键Audit实现验证 | 无投递worker/完整审计UI/分页/retention/压力验证 |
| 身份/HTTPS | 已实现、验证、部署 | scrypt/Secure会话/CSRF/Host/receipt/租户隔离/事务内重验权限；单管理员，旧密钥为恢复入口；原站不变 |
| 保存可靠性 | 已验证 | 版本/幂等/草稿保护；草稿与重试键仅页面内存，重认证待补 |
| Agent领域治理 | 82项纯规则保持通过 | 未全量接运行权限/规划/证据/来源，不是自治Agent |
| Git/CI/许可证 | 基础配置 | main无提交/远程，全部未跟踪成果保留，CI未运行/许可证未决定 |

## 012 本轮实际验证

- 本地pnpm check：14文件/240项，lint/AST边界/typecheck/Web+Host build通过；pnpm test:e2e：27/27，桌面en/zh、移动zh。
- Host31项，包括跨租户、管理员审批/停用、改密/凭证不回放、延迟请求在撤销/退出后拒绝且无receipt/event、停用后再启用不复活旧凭证。OpenAPI1项验证引用与v1别名；迁移14项包括v5升级/备份恢复。
- PDF 1页A4/80,378字节，渲染并查看中文/公式/表格；查看本地桌面/移动和公网账号/看板/知识空间截图。
- 服务器仅wrapper check:server-safe：12文件/204项及lint/类型/构建通过，36项PG仅Windows。前端bundle798.45KB有体积警告。
- 16:20:22–16:26:23 CST仅本项目web维护；现web3700886、HTTPS3649322 active/enabled。原站nginx740821/class-manager-api2049871/zproject-api3033350未变，首页/健康200。
- v4升级前与v5就绪后快照及各自新文件恢复通过；外网可信TLS、匿名401、登录/读API0.4.0/library/admin、Secure/CSRF/同步验证通过，下载备份241664字节/schema5。公网浏览器无JS错误/横向溢出/业务写入，验收会话退出。
- 用户自行绑定唯一管理员，未创建默认密码或生产测试数据。具体清单/命令/维护记录见HANDOFF、DEPLOYMENT和会话012。

未验证：真实用户绑定操作、真实本地AI客户端接入、真实模型计费、异机定时、原生安装、长期压力/渗透/证书续期周期。图片单张500,000字节、每工作区约20MB，仅签名检查非完整像素解码，不支持硬删释放配额；新增讲义不在旧知识图/同步中。write API能返回被操作内容，并非盲写。

## 011 历史验证（非本轮结果）

- Windows pnpm check：13文件/229项、lint/AST边界/typecheck/Web+Host build通过；最终文档/OpenAPI/验收脚本修改后再通过格式/lint/typecheck。
- pnpm test:e2e：24/24（桌面en/zh、移动zh）。知识入出链、AI审批且不自动改业务、双会话同步/草稿/冲突/断网及旧功能通过。模型网络替身，不是真实供应商调用。
- Host接口22项、model12项、offsite3项、SQLite连接存储2项/迁移13项/原契约22项，包括v3→v4备份恢复、重复审批、并发/超时、租户、独立Audit和事务回滚。
- 服务器wrapper check:server-safe：11文件/193项、lint/类型/构建通过；36项PG仅Windows。未在服务器执行便携PG/浏览器或安装全局工具链。
- v3升级前快照及新文件恢复、v4就绪后快照及新文件恢复通过。首次启动瞬间health未就绪、首个post快照仍v3，保留后另建并验证v4快照，详见DEPLOYMENT。
- 外网可信TLS/IP SAN、首页/health200、匿名401、登录/读取200、Secure会话、条件游标null、AI未配置、CSRF403、备份184320字节；登出成功，无业务写入。
- 本机Chromium直连公网登录/知识/AI未配置提示通过，无JS错误或横向溢出；实际查看生产和本地中英/移动知识/AI截图。
- 原站首页/健康200，nginx740821/class-manager-api2049871/zproject-api3033350不变；本项目web3677307/https3649322，active/enabled。

未执行：真实模型/计费、实际异机定时/生产恢复切换、原生编译/安装/Android、LinuxPG/真实PG备份恢复、CI、长期压力/渗透、完整证书续期周期/整机重启。不能从其他检查通过推出这些已完成。

## 下一步

### 2026-09-15 原生构建接手状态

### 2026-09-15 Orivane Atlas 原生客户端续接

- 正式显示名已统一为 Orivane Atlas；稳定 identifier dev.arclattice.app 暂保以维持已有安装升级识别。
- 新增按 workspaceId/principalId/文档 key 隔离的 IndexedDB 草稿持久化；服务器仍为权威，不是完整离线同步。
- Windows NSIS 已成功生成：src-tauri/target/release/bundle/nsis/Orivane Atlas_0.0.1_x64-setup.exe，3,774,341 bytes，SHA256 A5C2F3598F161CD16B32D947B47646B08124507EA44483F397AA81D9BE9D6AD6。
- Android Rust/NDK 编译成功；APK 阶段因 Gradle Kotlin DSL 插件 org.gradle.kotlin.kotlin-dsl:5.2.0 无法解析失败，APK 未生成。
- pnpm exec tsc -b --pretty false 通过；全量 pnpm check 仍被生成 Tauri schema 格式问题拦截。
- 一键更新仍未生产验收，缺 endpoint、公钥/签名发布流程、Android 渠道与 keystore。

- 本轮已接手原生构建范围：目标为按 connected Tauri 配置生成 Windows EXE/NSIS 与 Android APK；不扩大权限模型，不引入任意 Shell/插件执行。
- 已验证：Node v24.20.0、pnpm 11.19.0；pnpm desktop:doctor 的配置安全检查通过（无 remote IPC permissions）。
- 未完成：Windows EXE/APK 均未生成。当前机器 PATH 无 cargo/rustc、Java、adb、Android SDK、MSVC/Windows SDK；Tauri Android 工程也尚未初始化。
- 工具链工作目录已创建为 F:/Software/ArcLattice-native-toolchain；Rust 下载文件存在但安装器被残留进程锁定，未形成可用 Cargo/Rustc。未安装大型工具链、未改系统服务、未改业务代码。
- 后续准确入口：准备 Rust MSVC + Visual Studio C++/Windows SDK 后运行 pnpm desktop:doctor、pnpm desktop:connected:build；准备 JDK/Android SDK/NDK 后运行 tauri android init（如 CLI 版本支持）及 Android release 构建，再检查 APK 实体与签名状态。构建成功前不得称为已交付。
- 2026-09-15补充盘点：已确认可复用 F:/ZProjectBuild/AndroidSdk（platform android-35、build-tools 35.0.0、NDK 26.1.10909125、platform-tools/adb）、F:/ZProjectBuild/Java/microsoft-jdk-21/jdk-21.0.12.1+1 与 F:/ZProjectBuild/gradle-cache；未复制大型组件。Tauri Android init 实际仍因 cargo metadata 不可用而失败。F:/Software/ArcLattice-native-toolchain 中的 Rust MSVC 安装两次恢复/下载后仍为不可安装的不完整 toolchain，cargo/rustc 不可用；系统未发现 Visual Studio/Windows SDK。故 EXE/APK 尚未生成。
- 2026-09-15续接：已在 F:/Software/ArcLattice-native-toolchain 安装 LLVM-MinGW 20260908 与 Rust GNU 1.98.1；desktop:doctor 实际通过。Windows connected build 已启动但因 Cargo 访问 crates.io 被本机代理 127.0.0.1 拒绝而退出1，尚未进入 Rust 编译，EXE/NSIS/APK 仍未生成。
- 2026-09-15成品进展：已在 F:/Software/ArcLattice-native-toolchain 安装 MSYS2 UCRT64 GCC 运行库并完成真实 Windows GNU 编译。NSIS 成品已生成：src-tauri/target/release/bundle/nsis/ArcLattice_0.0.1_x64-setup.exe，3774181 bytes，SHA256 AC66C7FFDB8C7A9E60A8F0798A3390095CE73205601FC24335672ED93DFA4AB1。Android 工程已由 tauri android init 成功生成，但 debug APK 构建因 static.crates.io 代理 127.0.0.1 失败（缺 hyper-util crate）退出1；APK 尚未生成。
- 新增要求：Windows 与 Android 均需软件内一键更新到最新版。已记录 ADR0015：Windows 使用签名 Tauri Updater；Android 按发布渠道使用 Play In-App Update 或系统 Package Installer，禁止静默安装。更新源、发布渠道、签名密钥和验收仍未配置/验证。

需用户选择AI路由/额度、可信接收机/时间/密钥保管，以及是否安装大型原生工具链，再完成真实调用、自动备份和恢复、Windows安装验收。完整知识模型/离线同步/自治Agent仍需继续按ADR开发。

010登录路径问题保留：开发机key存在不等于另一终端同路径存在；未重置密钥，用户本人登录结果未确认。准确命令见HANDOFF/DEPLOYMENT，细节见会话011。
# 当前部署状态（2026-09-15）

## Android native build update (2026-09-15)

- Fresh arm64 debug APK built successfully with Gradle. SHA256: A96A5A347E62177E4D797695D4111462E2A383BFF4912AC5D5E6E7498CD46C90.
- APK signature verification passed with APK Signature Scheme v2.
- The APK uses the regenerated Orivane Atlas launcher icon and server-origin login configuration.
- It remains a debug arm64 artifact; release signing, multi-ABI packaging, real-device acceptance, and in-app update are not complete.

## Native client audit (2026-09-15)

- Implemented and pushed server-origin configuration for native clients; login now requires an HTTPS server address and API requests target that origin.
- Regenerated Android launcher assets from the project icon.
- Windows NSIS rebuilt; SHA256 A2C61DB7B39FD1D56C522E71A4DDC75EEBD6904936ACED78ED56A80A6144CF11.
- Android arm64 Rust compilation succeeded after bypassing the stale local Cargo proxy, but a fresh APK was not produced because the Windows Gradle/symlink packaging path still fails. The prior APK is not a deliverable for this change.
- Source commit f27281b was pushed to origin/main. No binary release was created from the stale APK. In-app update is still not implemented.

- 已验证：Orivane Atlas 通过 https://123.207.179.150:11220 对外提供服务，项目 Caddy 返回 200。
- 已验证：项目 443 监听已释放；项目宿主仍为 127.0.0.1:4317，未暴露公网。
- 已验证：原站相关服务未停止或修改；Nginx active，实际监听 *:8088。服务器当前没有 80 监听，因此不能将 80 记为原站入口。
- 已验证：项目网关服务 active 但 disabled；配置及 web unit 均保留迁移前备份。
# 当前部署状态（2026-09-15）

## 原生客户端增量（2026-09-15）

- connected Tauri 配置已指向 `https://123.207.179.150:11220`。
- Windows：本轮未生成新 EXE/NSIS；旧产物不可视为 11220 构建。
- Android：本轮未生成新 APK；Gradle Kotlin DSL 5.2.0 依赖未缓存。
- 发布签名、自动更新、真机安装验收仍未完成。
## 021 当前状态：Apache-2.0 已确定，公开仓库边界审计进行中

- 用户已确定许可证为 Apache-2.0；已新增根目录 LICENSE，版权归属为 Liangzheng Zhou，年份为 2026。
- 目标仓库已确定为 https://github.com/LiangzhengZhou/OrivaneAtlas。
- 已检查上级 Temp 目录，未发现可直接复用的 Orivane Atlas 上传凭据或脚本。
- 远端查询尚未成功：本机会话代理 127.0.0.1:7890 当前连接失败；因此没有添加 remote、提交或推送。
- 公开边界仍需处理：生产 IP、服务器路径和运维命令出现在部署文档、历史接力记录、OpenAPI 示例及服务器脚本中；这些内容不能未经脱敏直接公开。

## 022 当前状态：GitHub 公开源码已推送

- 目标仓库 main 已推送，Apache-2.0 LICENSE 已包含。
- 公开范围已确认：代码与必要开发文档公开；生产运维、账户/服务器信息、历史接力文档排除。
- EXE/APK 不进入 Git；待发布为 Release 资产。
# 2026-09-15 public repository status

- Public documentation cleanup completed and committed as a7b3856.
- Root README is English and includes the project icon.
- Public docs now focus on self-hosting, development, storage, API, and architecture.
- Internal handoff, production operations, account/server material, and private history remain local and untracked.
- Debug EXE/APK remain GitHub Release assets only; production signing and in-app updates are not complete.
