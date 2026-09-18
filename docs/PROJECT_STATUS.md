# 项目状态

## 057 0.0.8 客户端构建与 GitHub 发布（2026-09-18）

- 已完成：版本升级至 `0.0.8`，Windows x64 NSIS 安装包和 Android arm64 APK 已构建；Windows updater 签名、APK v2/RSA4096 签名及当前 Web 资源嵌入校验通过。
- 已完成：GitHub `v0.0.8` 已发布为 latest，六个发布附件公开下载并逐项 SHA256 校验通过；源码提交 `bd58198` 已推送 `main`。
- 已验证：`pnpm check` 本地通过（40 个测试文件、417 项通过、1 项跳过）；完整 E2E 先出现 5 个旧定位器失败，修复后专项 6/6 通过，项目相关 E2E 与 native/gateway 测试通过。PostgreSQL 并发测试单独复跑通过。
- 未完成：服务器部署和重启未执行。指定 SSH 主机指纹可达，但 `root` 密码认证连续被服务器拒绝；未上传源码、未备份数据库、未重启任何服务。真实 Android 设备安装/升级未验证。

## 056 三组功能实现（2026-09-18，本地已验证）

- 已实现：项目拥有资料与外部引用分离；项目专属 Markdown 文档、2 MiB 文件仓库、软删除/恢复、活动记录、任务时间线、子项目工作区与中英双语 UI。SQLite 17 追加迁移，资料、文件、活动和 outbox 在同一请求事务内提交。
- 已实现：完整计划导入的文档发布适配器、周期字段扩展；AI Gateway 的注册/能力、UNLIMITED 预算、金额预留/对账、有界 fallback、MCP 明确工具；分类 icon/color/position、密度偏好、安全多账户切换。
- 已实现：侧栏桌面收起/展开和移动端导航披露，任务页默认未完成已激活任务，看板仅显示已激活任务。
- 已验证：项目资料专项 3/3、项目/文件/MCP Host 专项 5/5、项目工作区与资料/文件/时间线/活动桌面英文/桌面中文/移动中文 E2E 6/6；`pnpm typecheck`、`pnpm build` 通过。截图已检查。
- 未通过/未完成：全量 `pnpm lint` 仍有并行代理留下的 11 项格式诊断，未运行全量 `pnpm check`；AI 未连接真实 provider，Android 文件保存未做真机验证；未部署、未推送、未重建 EXE/APK。

## 055 待办核对（2026-09-18，文档审查）

核对当前接力与048历史差距，业务实现/部署状态仍以054/053/051为准。本轮无业务改动、无测试、无部署；待办分类及被新记录取代的旧项见sessions/2026-09-18-009-handoff-open-items.md。未新增功能骨架，不将“本地完成”当作“已发布”。

## 054 激活任务视图与布局（2026-09-18，本地）

- 已实现：任务页/看板强制仅TASK且Domain判定已激活；任务默认未完成，看板默认四状态；独立任务规划管理全部激活状态及未归属任务。搜索/归档/状态筛选均不能绕过激活过滤，导航/hash/重载恢复默认。徽标区别激活与可执行，计数与显示一致。
- 已实现：项目卡片宽度/间距和底部操作区、明确进入项目按钮；独立筛选面板及激活说明、响应式布局；ADR0034/双语文档。无迁移或API改变，无额外骨架。
- 已验证：类型、Host/Web构建、架构边界、7文件格式、diff通过；pnpm test 374通过/1原生夹具跳过（105.67秒）；三端专项12通过。全量E2E84通过/3旧默认筛选断言失败；改为显式选择全部后，三端失败用例复跑3/3通过（8.6秒），未重跑全量。桌面任务/看板/项目及手机任务截图已实际检查。
- 未通过：pnpm check仍被5项既有格式诊断阻断。未部署/推送/发布/重建EXE/APK或真机验收；EXE使用同一Web前端构建，须重新打包才包含这些修改。

## 053 项目工作区与导航（2026-09-18，本地）

- 已实现：项目标题进入独立工作区，Markdown说明、关联笔记/文档/知识空间、子项目列表及预选父级创建、递归任务、保留外部阻塞的依赖图；桌面折叠可访问名称、手机独立展开/收起及跨断点样式修复。ADR0033，无 Schema/API 变更。
- 已验证：typecheck、Host/Web build、架构边界、改动7文件Biome及diff检查；单测374通过/1原生夹具跳过；完整E2E84/84通过（3.3分钟），最终仅样式/文案微调后重构建并三端专项6/6通过（13.2秒）。桌面折叠/手机展开收起/项目资料与依赖图截图已检查。
- 未通过：pnpm check在5项既有格式诊断处停止（WorkflowManager、bootstrap、application index/workflows、host server）；未修改这些文件的既有业务。构建仍有大块警告。
- 部分实现：项目资料为独立知识实体的引用，不是独占所有权；新资料先在笔记/知识库创建。专属文件仓库、时间线、活动、Agent运行页面尚未开始。本轮未新增这些功能的骨架。
- 未执行：服务器同步/部署、Git推送/发布、新EXE/APK、Android真机验收；当前安装包不会自动获得本地前端改动。

## 051 服务器部署（2026-09-18）

- 已部署：本轮导航/项目树导入与预览/层级限制相关13文件，SQLite保持15，生产源码基线source-051-final.sha256。050的SSH阻断已通过用户授权交互密码登录解除。
- 已验证：服务器类型检查、非PG测试323通过/1跳过、Host/Web构建、前后快照及独立恢复；公网health200/匿名asset401，桌面及移动登录截图已查看。其他站点及网关服务PID不变。
- 未通过/未验证：组合check因8项格式/导入问题停止；未跑PG、真实账号项目树导入及真机更新；新增树深度预览边界仍需专项审查。
- 未发布：GitHub、原生版本号和更新清单未变。050原生本地包可配合当前服务器，不能视为新自动更新发布。

## 050 原生交付（2026-09-18）

- 已构建/验证：本地0.0.7 EXE及正式签名arm64 APK，当前前端资源嵌入核对、Windows更新签名、APK v2签名通过；产物见HANDOFF 050。
- 已验证：typecheck、Host/Web build、非PG测试323通过/1跳过、E2E78通过；桌面与移动截图已查看。
- 未通过：全量check在8项lint错误处停止；本轮未跑PG、未做真机安装/实际更新。
- 未部署/未发布：SSH认证失败，线上仍以047为准；新项目树导入API未部署。版本未递增、更新源未改、未推送GitHub。Windows仍无Authenticode。

## 048 原需求核对（2026-09-18，静态审查）

047部署与发布仍有效；未新增业务实现或重新测试。已实现的功能名不能代表原prompt全部子项完成：分类缺排序/颜色/图标，计划仅tasks导入，周期缺结束日期/默认负责人/激活/多项目，AI仍每日1–100配置上限，普通任务/看板未统一inactive过滤。完整Gateway、知识owned/linked、MCP/Agent文档、安全多凭据、独立Local Mode、PG账户、侧栏/密度未闭环。详细证据、原章节和下一步见sessions/2026-09-18-003-original-prompt-audit-048.md；本节补充046剩余项，不推翻已验证的核心功能。

## 047 生产与公开发布（2026-09-18）

- 已部署：046业务代码、SQLite15、持久登录/后台周期/命名AI配置等；生产健康，其他应用未动。下方“未部署/未发布”是历史记录，当前以本节为准。
- 已发布：main 75b1fb5a00bfbb33bbfdf35068fbb44dd1b3b01f、GitHub v0.0.7；EXE/APK/签名/两端更新清单/校验文件共六附件，全部公开下载哈希和latest源验证通过。
- 已验证：升级前后SQLite快照及独立恢复；服务器lint/types、独立受限测试323通过/1跳过、Host/Web构建；公网只读桌面/移动检查通过。沿用046本地375测试及78 E2E，不重复声称本轮全量测试。
- 限制：服务器组合check因内存回收停滞终止，后分步通过；GitHub CI因便携PG缺少libicuuc.so.60失败（323通过，PG套件未启动，云端E2E未运行）。Windows无Authenticode；未做真机安装/应用内更新/Launcher验证。
- 未完成/仅部分实现：完整AI Gateway注册/六类策略/金额账本/fallback/Embedding/Agent工具、安全多凭据、知识owned/linked、密度偏好、PG物理恢复仍按046待办，不能把发布等同全路线图完成。

## 046 后台周期、多模型配置与数据许可（2026-09-18，仅本地）

- 已实现：Host启动/60秒后台周期调度，持久游标、事务去重、禁用账号隔离、规则快照及旧规则补录；不是完整RRULE或Android后台服务。
- 已实现：AI发送持久预留、文档与父空间策略逐次检查、provider实际token记录；同范围多个命名模型配置，独立CAS，审批绑定配置指纹，删除后重建不能恢复旧审批。凭据仍加密保存，不提供自动fallback。
- 已验证：全量check通过，31文件375测试；最终格式/架构检查通过；新增nonce后Vault35测试通过；全量中英桌面/中文移动E2E78/78通过，移动配置截图已查看。Rust8通过/1默认忽略，严格Host夹具另行通过。
- Android图标已实现无文字罗盘与13%自适应安全区，五档DPI检查通过。0.0.7最终EXE/APK已重建，F:/Software/OrivaneAtlas/releases/v0.0.7-local/；更新签名/APK正式证书/最新JS-CSS嵌入/编译图标/原生库一致性验证通过。没有Windows Authenticode，真机Launcher/最近任务/设置和覆盖安装未验证。服务端未部署，不承诺与旧服务端兼容。
- 未完成：共享provider/model注册表、受信本地模型登记、六类使用策略、金额预算/账本对账、审批后受限fallback、Embedding/Agent工具统一接入。不能标记完整Gateway完成。
- 未部署、推送或发布；生产服务不变。SQLite15/PG7，PG物理恢复、安全多账户凭据、知识owned/linked及密度偏好仍未验收。下方旧节中“无后台调度/图标未修改/仅单配置”等描述由本节取代。

## 045 分类、审核计划与周期任务（2026-09-17，仅本地）

- 已实现：独立项目分类及多分类关联、分类筛选/软删除/恢复；Manifest v1 JSON预览、人工确认、版本与工作图绑定、原子幂等发布、依赖校验和导入来源；日/周/月周期定义、时区日历、漏做记录、当日生成、防重复及显式补录。三存储适配器、HTTP/OpenAPI、双语Web界面已接通；SQLite15/PG7。
- AI部分实现：在既有执行门禁上增加发送前事务内复核RUNNING版本、上下文版本/正文/标题/删除、所属工作空间及文档父空间/路由范围。并非完整Gateway；统一注册表、持久用量账本、完整DataPolicy与fallback尚未完成。
- 已验证：pnpm check通过（156文件格式/架构、类型、28文件362测试、构建）；三适配器事务/幂等/回滚契约，SQLite分类与工作流升级前后独立备份恢复。新分类/计划/周期三端专项通过，检查移动截图并统一按钮样式。全量浏览器最终结果见HANDOFF045/会话记录。
- 明确限制：周期为用户触发生成，不是后台调度器/完整RRULE；旧定义版本漏做补录会冲突；Manifest仅新增任务，不编辑/删除现有工作；工作图任何变更保守地使预览失效。PG物理恢复、原生重建/真机未验收。既有原生测试夹具不代表本轮新传输白名单已经重新编译。
- 最终浏览器：72/72通过（2.9分钟）；前两轮71/72的临时服务关闭超时已在测试夹具中修复。最终样式/夹具改动后build、lint、全量E2E通过；桌面及移动截图已检查。
- 未完成：Gateway完整能力、后台周期调度、知识owned/linked、密度偏好、安全多凭据切换、PG账户、Android图标/安装包发布验收。无部署/推送/发布/EXE或APK更新，生产与安装包版本不变。

## 044 多归属与AI执行门禁（2026-09-17，仅本地）

- 已实现：任务多项目归属全链路、独立关联表及旧值回填、CAS/事务Activity/Outbox、次要项目删除保护、恢复归属修正、共享归档与递归去重、双语编辑器/OpenAPI；SQLite13/PG5。
- 已验证：最终pnpm check通过（144文件格式/架构、类型、25文件343单测含原生Host夹具、构建），SQLite升级前后独立恢复、PG旧行回填及备份门禁、三适配器归属CAS/事务回滚/恢复契约；全量E2E66/66通过，检查中英桌面/中文移动布局截图；diff检查通过。PG物理备份恢复、原生重建/真机未执行，前端大块警告保留。
- 部分实现：AI Gateway执行门禁已接Host，重新授权与路线审批、超时取消和错误脱敏；不是完整统一Gateway，注册表/用量账本/数据边界fallback未完成。
- 未开始：独立分类、Manifest计划导入、周期Definition/Occurrence；原有知识归属、密度偏好、安全多凭据切换/PG账户/Android图标仍待办。无生产或安装包变动。

## 043 项目归档与验证基线（2026-09-17，仅本地）

- 已实现：继承项目归档/恢复、独立子项归档保留、递归进度及任务过滤、双语原因提示；恢复不修改任务状态或Markdown。ADR0025，无新迁移。登录品牌区恢复。
- 已验证：pnpm check通过（141文件格式与架构、类型、23文件327单测含原生Host夹具、构建）；全量E2E63/63，中英桌面与中文移动；检查移动归档/登录截图；diff检查通过。旧夹具登录竞态已修复，公开注册及旧secret入口保持禁用。
- 仍未完成：分类/多归属、AI Gateway/Manifest、周期任务、知识owned/linked、密度偏好、PG鉴权、安全多凭据切换、Android图标。构建大块警告未处理。未执行原生重建/签名安装/真机验收。
- 无部署、推送、发布；线上038/SQLite9，本地安装包0.0.6、公开0.0.4不变。后文历史check失败和继承归档未实现由本节取代，不代表其他路线图缺口已消失。

## 042 激活规则与项目层级（2026-09-17，仅本地）

- 已实现：四种激活策略纵向接入、UTC定时可执行判断、手动未激活执行拦截、依赖变更同事务联动版本/事件；Ready/Focus过滤。PROJECT父级选择、卡片上下文、同工作空间循环/删除保护。中英文UI和OpenAPI同步。
- 已验证：22文件321单测通过，含三存储适配器激活/层级/并发/Outbox故障回滚；typecheck/build通过；桌面en/zh与mobile-zh专项E2E6通过，验证真实HTTP持久字段及非法策略，检查移动截图；11文件Biome、架构边界、diff通过。
- 未通过/未执行：全量check被299项其他既有/生成格式诊断阻断；全量E2E、原生构建和真机未执行。没有新迁移。
- 未完成：分类、多项目归属、继承归档/递归汇总、统一AI Gateway和计划导入、周期任务、PG鉴权、安全多凭据切换、Android图标。定时激活为UTC日期派生规则，不是后台调度器。
- 未部署/推送/发布；生产038/SQLite9、本地安装包0.0.6、公开0.0.4不变。下方041所称activation/层级未完成由本节取代，其他缺口仍有效。

## 041 账户体验与隔离（2026-09-17，仅本地）

- 已实现：中英退出/切换账户、会话查看/单个/全部撤销、最近账户元数据预填与忘记；切换仍需要密码，不存多份凭据。Runtime请求/排队同步/缓存游标隔离及改密清理；未保存编辑确认。原生离线退出有远端撤销未确认提示，受限传输支持会话API。
- 已验证：全量306单测通过（含原生严格Host夹具）；Rust8通过/1默认忽略夹具另行通过；typecheck/build、专项E2E9通过及移动截图、12文件Biome/架构/diff通过。旧Host/PG测试基线已修复；非法配置初始化的数据库泄漏已修复。
- 未通过：pnpm check被300项其他既有/生成文件lint诊断阻断。未跑全量E2E、Android编译/真机或安装包构建。
- 仅骨架/未完成：SavedAccount仍元数据，不是安全多账户免密切换；activation仍待纵向验收。PG鉴权、项目层级/多归属、统一AI Gateway/计划导入未完成。Android图标待办。
- 未部署/推送/发布；线上038/SQLite9，本地安装包0.0.6、公开0.0.4均不变。下方旧条目的账户UI未完成描述已由本节取代。

## 040 持久会话（2026-09-17，仅本地）

- 已实现并验证：SQLite v12仅存会话散列，重启保持、到期、改密/禁用/退出撤销、会话列表与选择/全部撤销、账号隔离、32会话限制；v11升级与升级前后独立备份恢复。备份工具使用迁移定义的当前版本，拒绝未来版本。
- 验证：7文件31专项通过；8包typecheck及根tsc、Host构建、架构边界通过。全量测试/格式检查尚未全绿，详见040会话记录，不将专项成功等同发布验收。
- 仅骨架/未完成：安全多账号切换、缓存/草稿隔离和会话管理UI；PG账户适配器未开始。原生UI和图标本轮未改，未跑E2E或原生构建。
- 无部署/推送/发布；线上最后记录038/SQLite v9、已有本地安装包0.0.6、公开0.0.4均不变。

## 039 产品改造第一批纠错（2026-09-17，仅本地）

- 已实现并验证：动态会话策略、原会话期限不变、严格枚举、设置与幂等收据同事务、事务内授权复核。真实HTTP与数据库重开专项2项通过；8包typecheck和根tsc、Host构建、改动4文件Biome、边界检查和diff检查通过。
- 尚未完成：PERMANENT跨Host重启保持、设备/全部会话撤销管理、安全多账号切换与缓存隔离。已有SavedAccount和activation属于半成品，不能据字段存在标记完成。
- 全量检查：pnpm check在lint阶段304项诊断退出1，未继续全量测试/build；另行Host build通过。native transport测试因无夹具跳过；本轮无UI变更，未运行E2E/截图/原生构建。
- 计划：先账户会话完整纵向实现，再分类/层级/归档/多项目任务与双库迁移，随后AI Gateway/Manifest导入、周期/知识关联/密度UI，最后发布验收。CURRENT_IMPLEMENTATION_AUDIT.md、GAP_ANALYSIS.md已纠正此前静态审计。
- 未部署/推送/发布；线上最后确认038、SQLite v9，本地既有迁移到v11不代表生产已升级。

## 038 七天会话已上线（2026-09-16）

- 已实现/部署/验证：Host固定7天、Cookie604800秒；仅后端切换，SQLite仍v9。服务器受限专项HTTP1项、typecheck、Host构建通过；270文件基线通过，公网与回环health正常、匿名session401。其他服务PID未变，原站首页/health200。
- 综合检查未全绿：check:server-safe因5项既有格式诊断退出1，未执行全量测试、PG或浏览器测试；无生产用户登录验收。备份及独立恢复均验证。
- 重新登录后生效，无需重建客户端；固定期限非滑动、服务端重启仍失效。未推送/发布，本地0.0.6和公开0.0.4不变。退出/切换账户UI与Android图标未开始。下方037/036线上状态为历史记录。

## 037 七天会话（2026-09-16，仅本地）

- 已实现/验证：Host绝对会话7天、Cookie604800秒，准确到期拒绝；专项HTTP1项覆盖8小时后/7天边界/退出撤销；typecheck/build、专项Biome和架构边界通过。全量check仍295既有格式/生成诊断。
- 未部署：线上仍8小时；部署Host后重新登录获取新期限，现有EXE/APK不需重建。会话仍进程内，服务器重启失效；持久化/refresh token未实现。
- 仅记录未修改：原生退出登录/切换账户UI不足；Android三星桌面图标文字裁切。按用户要求留待之后处理。

## 036 原生会话保持与Windows托盘（2026-09-16，本地0.0.6）

- 已实现：Windows当前用户DPAPI、Android Keystore AES-GCM保存原生会话，不存密码、不暴露Cookie给JS；启动同服务器恢复后由/api/session验证。退出登录、切服、401清除，离线退出也清除。ADR0019。Windows关闭隐藏，托盘打开/退出；不自动开机启动。
- 已验证：typecheck/build；Rust8通过/1忽略（严格Host夹具另1通过）；Android Kotlin及JVM测试通过；专项E2E15通过并查看移动恢复截图；两包精确内嵌当前JS/CSS；APK v2签名/code6与原正式证书一致；Windows真实更新签名及篡改拒绝。Windows实际点击关闭后窗口消失且进程存活，托盘菜单恢复/退出尚未实测，测试进程已清理，用户旧进程未动。
- 本地成品：F:/Software/OrivaneAtlas/releases/v0.0.6/，EXE 7,090,318 bytes、APK 18,711,192 bytes及EXE.sig。未推送/发布/部署；公开版本仍034的0.0.4，服务器仍033。
- 边界：服务器当前8小时绝对会话且仅进程内；过期/服务器重启仍需重新登录，未实现多日refresh token。Android真机Keystore/重启/覆盖安装未测；Windows无Authenticode。全量check在既有295格式/生成诊断处停止，不宣称全绿。
- 036认领完成释放；下一步用户安装验收，按后续授权发布和独立规划长期会话。准确命令/哈希见sessions/2026-09-16-036-native-session-tray.md。

## 035 原生登录与快速反馈（2026-09-16，本地0.0.5）

- 已实现：受限原生HTTPS传输，保留服务端Origin/CSRF鉴权；Cookie仅原生内存，切服清除并拒绝过期响应，禁止重定向。私有图片/备份共用鉴权通道。地址本地校验、native连接3秒/登录总计8秒；401/403/429/网络TLS/超时/无效响应中英分类，无自动密码重试。ADR0018。
- 已验证：typecheck/build、Rust5通过（另1由Host夹具执行）、真实严格Host联调1通过（错误密码/登录/会话/数据/图片上传读取/SQLite备份/CSRF/退出/切服）、登录UI3端3通过及移动截图、更新与图片回归9通过、Android JVM3通过、边界/diff。Rust超时真实等待8秒后重试通过。
- 已构建：F:/Software/OrivaneAtlas/releases/v0.0.5/ 下Windows EXE及.sig、Android arm64正式APK，versionCode5/原正式证书；真实签名验签、篡改拒绝、内嵌前端字节一致、Windows启动响应通过。Windows仍无Authenticode；没有真机Android或已安装客户端升级/真实账户验收。
- 未发布/未部署/未推送：公开版本仍034的0.0.4，线上仍033；无远端写操作或账户操作。本次native修复不需服务器Schema/CORS变更。Web同样新增反馈但线上Web尚未更新。全量pnpm check在295格式/生成文件错误停止，未运行全量单测/E2E，不宣称全绿。
- 035认领完成释放；下一步用户验收本地安装包，再按授权发布0.0.5和更新清单，必要时单独部署Web反馈。记录见sessions/2026-09-16-035-native-login-feedback.md。

## 034 签名与原生更新已发布（2026-09-16）

- 已实现并公开：v0.0.4（stable feed，早期0.x并非生产就绪认证），commit71cb556，发布于15:57:25 CST。GitHub https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v0.0.4 。Windows x64 EXE、Android arm64 release APK、EXE.sig、latest.json、android.json共5资产匿名下载回验SHA256/长度全部一致；/releases/latest指向本版。
- Windows内置公钥验证更新包，Android独立正式RSA4096密钥签名，同包dev.arclattice.app/code4；用户已接受旧debug版备份后迁移安装。登录/设置有中英更新入口、确认、失败重试；固定官方HTTPS更新源，窄IPC权限。Android系统权限和确认保留，非静默安装。
- 已验证：typecheck/build、6项更新UI浏览器测试（替代native bridge）、Android JVM策略3项、Windows release Rust1项、APK v2签名、EXE真实更新签名及篡改/截断拒绝、两包当前JS/CSS嵌入、Windows启动响应；手机最终截图已查看。更新包签名不是Authenticode，EXE仍NotSigned/未知发布者。
- 全量未绿：pnpm check在283格式/生成文件诊断停止；pnpm test253通过/38失败，其中37旧登录404、1并发超时，异机3项单独重跑通过。全量E2E3通过/3失败/1中断/44未跑，旧登录和品牌期望失效；debug Rust测试0xc0000139，release测试通过。不得把专项通过写成全量通过。
- 真机APK安装/迁移/权限、Windows已安装版跨版本升级重启未测；无adb设备。Android进度不定量。Windows受信任发布者证书仍需外部申请/审核，未申请、未购买、未获批；仅更新包签名已完成。签名密钥受限保存F盘，未公开；独立离线备份尚未创建，后续不能重新生成发布密钥。
- F盘成品目录F:/Software/OrivaneAtlas/releases/v0.0.4/。本轮未改服务器，保持033部署/SQLite v9，不可将此次本地公开源码提交当作服务器主副本已同步。
- 本轮034认领完成释放。准确命令/摘要/迁移和剩余项见sessions/2026-09-16-034-signed-native-updates.md。公开提交仅40项源码/公开文档；私有运维、接力、密钥未上传。旧历史内部资料残留仍待授权处理。

## 033 服务器与原生0.0.3更新完成（2026-09-16）

- 已部署032分块图片上传，SQLite v9；00:55:01–00:55:06 CST仅维护本项目web，公网HTTPS健康与新资源验证通过。升级前v8/升级后v9一致性备份和新文件恢复通过；其他服务PID未变。服务器268文件基线为uploads/source-033-final.sha256。
- GitHub v0.0.3-debug于00:57:52 CST公开，commit 0fa295965b64a311c6a685b283d0cb141bf987cc；Windows x64 EXE、Android arm64 APK均已上传且GitHub SHA256/长度一致。发布页 https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v0.0.3-debug 。F盘成品目录F:/Software/OrivaneAtlas/releases/v0.0.3-debug/。
- 两端版本0.0.3，Android versionCode3，同包标识/原debug签名/正式Logo；已核验包内分块前端、新.so、15张launcher与旧正确图标一致，无私人服务器IP。仅手动覆盖安装，一键更新和生产签名未实现。
- 本地typecheck/build、25专项测试、2图片HTTP（含21MiB传输/恢复）、3端图片E2E及截图、15文件Biome/边界/diff通过。pnpm check在151项格式/生成文件诊断停止。服务器typecheck通过，server-safe为218通过/37旧secret登录夹具404失败，整体check在5项格式问题停止。没有全量全绿声明。
- 公网只读验收通过，无业务写入；没有应用账号/连接Android设备，线上已登录粘贴和真机安装升级未测。图片无产品大小/工作区配额，Markdown文本限制及网页/HTTP异机备份64MiB限制未改。
- 本轮033认领已完成释放。准确命令、备份、哈希及剩余事项见sessions/2026-09-16-033-server-native-release.md；私有运维接力未推送。旧公开历史内部文档残留仍需单独处理。



## 032 图片无限大小上传（2026-09-15，仅本地）

- 已实现：取消图片500KB及工作区约20MB配额；256KiB顺序分块上传，下载逐块鉴权/背压；SQLite v9、幂等及私有暂存、24小时未完成上传清理；双语文案/OpenAPI/自部署说明。旧图片兼容，Markdown文本限制不变。
- 已验证：typecheck/build、25专项单测、44 SQLite/application测试、2图片HTTP专项、3端图片E2E（700KB文件）及截图；21MiB以上传输/逐字节回读/一致性备份恢复；v8→v9迁移和独立旧快照恢复；15文件格式、边界、diff通过。
- 检查限制：全量pnpm check在145项格式/生成文件错误停止；未跑全量host/E2E，未真机或生产验证。
- 未执行：部署、GitHub推送、EXE/APK重建及新版发布。线上仍030、公开原生包仍031；只有同时更新客户端和服务器才启用新上传。浏览器/HTTP异机备份64MiB限制未改，大库须运维一致性快照。


## 031 原生客户端与GitHub（2026-09-15）

- 已实现、构建、发布：v0.0.2-debug Windows x64 NSIS与Android arm64 debug APK，含029现代上传/私有图片粘贴、正式Logo、服务器地址输入；原生版本0.0.2/Android code2。源码cd24c3a推送main，私有接力/运维排除。
- 已验证：两端内嵌新版JS字节、APK内新库、APK v2签名/版本/ABI、GitHub上传SHA256和长度、匿名公开发布；typecheck/22专项测试/1图片HTTP/3端图片E2E/边界/diff通过。成品在F:/Software/OrivaneAtlas/releases/v0.0.2-debug/。
- 检查未通过：pnpm check被141项格式/生成文件错误阻断。没有连接Android设备，真机安装/升级/剪贴板未验证；Windows Authenticode未签名、Android是debug签名，正式签名及一键更新仍未实现。
- 服务器未操作，Web/Host维持030部署；本轮仅本地构建及公开发布。上文当前状态优先于下方历史记录。

## 030 当前线上增量（2026-09-15）

- 已部署：029现代文件卡片、笔记/日志/知识文档私有图片上传及粘贴、SQLite v8。Web/Host构建成功，16:28:55 CST启动新版。
- 已验证：升级前v7及升级后v8一致性备份与独立新文件恢复；服务器类型检查；可信公网HTTPS健康、新前端资源、默认服务器地址、手机登录布局、匿名图片鉴权。未改其他站点/网关。
- 检查限制：server-safe测试214通过/37旧登录夹具失败，整体check在Login格式错误停止。公网只读验收0业务写入，未以应用账号实测生产粘贴；此前本地专项3端9次重复通过仍有效。
- 未执行：GitHub推送或EXE/APK更新；当前安装包内置前端未更新。正式签名、一键更新、真机等旧遗留未改变。

## 029 当前增量：现代上传与图片粘贴（2026-09-15）

- 已实现，仅本地：现代文件选择卡片；笔记/日志/知识文档私有图片上传与粘贴；SQLite v8迁移与备份兼容；中英文及移动布局；异步插入保留后续输入。
- 已验证：typecheck/build、19文件Biome、架构边界、diff检查；专项单测23/23与图片HTTP测试；专项E2E重复9/9、最终3/3；迁移/新旧备份恢复、截图审阅完成。
- 全量结果：pnpm test 250通过/37失败（旧登录夹具）；pnpm check阻断于137项既有格式问题；全量E2E受旧登录UI夹具阻断，未通过。
- 未执行/未实现：生产部署与v8迁移、推送、原生重构建、真机剪贴板验证、图片压缩、孤儿清理、图片打包导出。下方历史状态不代表本轮变更已上线。
- 无需第三方图床：图片保存在自己的鉴权服务器，一次一张PNG/JPEG/WebP、每张500,000 bytes以内。

## 028 发布完成（2026-09-15）

- 已发布：v0.0.1-debug.2 预发布，EXE/APK 新图标成品均公开；两份上传资产大小与 GitHub SHA256 digest 校验一致。
- 已推送：bb08bb2 正式图标与 README、私有文档排除。当前公开树不含接力/运维记录，本地文件保留。
- 安全遗留：此前 de9d272 已公开内部文档；当前树删除不等于清除历史。本轮没有强推改写历史，需要后续确认处理。
- 未完成：正式签名、一键更新、真机测试。内部版本仍 0.0.1；全量检查既有失败仍有效，未宣称通过。

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

## 050 当前状态：导航与页面层级改进（2026-09-18）

### 已实现

- Web 主工作区不再显示与侧边栏重复的页面大标题说明区；创建按钮位于顶部操作栏。
- 桌面侧边栏支持折叠/展开，导航项支持拖放排序并通过本地 UI 偏好持久化。
- 外部 AI 计划导入安全边界与 Manifest v1 schema 已公开记录。

### 已验证

- pnpm exec tsc -b --pretty false 通过。

### 仅部分实现

- 移动端顶部栏尚未完成独立抽屉式收起/展开交互。
- 子项目已有 parentProject 数据和选择能力，但尚未补专门的创建子项目入口与明确的服务端层级/数量上限。
- AI 计划导入仍限于已有项目追加任务/依赖；完整 AI Gateway、项目树导入、多项目归属和外部 transport 尚未完成。

### 本轮未执行

- pnpm check、E2E、原生 EXE/APK 构建、真机验收、服务器更新与 GitHub 发布。

## 051 当前状态：项目树计划导入与层级限制（2026-09-18）

### 已实现

- Workflow Manifest v1 支持可选 projects 数组，项目节点可通过 parentTempId 嵌套，任务可通过 projectTempId 归属导入项目。
- 根项目树可在没有既有 projectId 时预览；发布阶段按拓扑顺序创建项目和任务，并保留已有预览/版本冲突/人工确认机制。
- 服务端统一限制项目树深度最多 16 层，创建与更新路径均校验。

### 已验证

- pnpm exec tsc -b --pretty false 通过。

### 仍待验证或实现

- 项目树专用预览 UI、领域/契约/E2E 测试尚未补齐。
- 完整 AI Gateway、专用外部 API transport 和真正的跨项目计划导入仍未完成。

## 052 当前状态：项目树可视化预览（2026-09-18）

- 已实现：计划审阅卡片显示项目树、子项目节点、任务归属、根级任务和数量摘要。
- 已验证：pnpm exec tsc -b --pretty false；git diff --check。
- 未验证：E2E、原生构建、真机验收、服务器部署。
# 2026-09-15 public repository status

- Public documentation cleanup completed and committed as a7b3856.
- Root README is English and includes the project icon.
- Public docs now focus on self-hosting, development, storage, API, and architecture.
- Internal handoff, production operations, account/server material, and private history remain local and untracked.
- Debug EXE/APK remain GitHub Release assets only; production signing and in-app updates are not complete.
# 027 正式图标更新（2026-09-15）

- 已实现：README 使用正式 Logo；保留原生图标已有修改。
- 已验证：Windows NSIS 与 Android arm64 debug 资源重打包成功；APK v2 签名验证通过，包内图标提取查看确认。哈希见 HANDOFF 027。
- 检查失败：pnpm check 在 lint 阶段报 139 项既有格式/生成文件错误；后续测试未执行。git diff --check 通过。
- 未完成：版本提升、GitHub 新版、真机安装、正式签名、一键更新。无服务器操作。

## 2026-09-17 Architecture review handoff
- DONE: CURRENT_IMPLEMENTATION_AUDIT.md and GAP_ANALYSIS.md generated from current code/docs.
- DONE: MOBILE_ICON_ISSUE.md confirms retained P2 issue and affected build areas.
- NOT IMPLEMENTED: Category/hierarchy, task membership/activation/recurrence, ProjectPlan import, instance AI Gateway, account switching UI.

## 2026-09-17 Batch 1 progress
- PARTIAL: Host session lifetime now accepts ONE_DAY, SEVEN_DAYS, THIRTY_DAYS, PERMANENT; default is revocable server-side PERMANENT.
- VERIFIED: pnpm typecheck passed. Vitest could not start because the vitest executable is unavailable through pnpm.

## 2026-09-17 Execute-first Batch 1 continuation
- DONE: SQLite migration 10 and PostgreSQL migration 3 add persistent instance_setting.session_lifetime_policy with default PERMANENT.
- DONE: Host reads the persisted setting on startup while preserving explicit policy override for test/bootstrap callers.
- VERIFIED: pnpm typecheck passed across all 8 packages.
- PARTIAL: Admin setting route/UI, SavedAccount and selector, request cancellation isolation, and permanent-cookie rolling renewal remain before Batch 1 is DONE.

## 2026-09-17 Continuous refactor status

- 已实现并验证：Session policy 四种策略及持久化、Permanent rolling renewal、请求取消与旧响应保护、SavedAccount 初步模型、Task activation 基础、SQLite/PostgreSQL migrations 0010/0011/0003/0004。typecheck 8/8 通过，session lifetime Vitest 1/1 通过。
- 尚未实现：Batch 1 完整账户 UX 与隔离；Batch 2–9 主体功能。
- 后续规划：按 Batch 1→9 连续完成 Schema、Domain、Application、API、UI、i18n、测试和必要文档，最后运行完整验证并修复失败。
