# Orivane Atlas 接力文档

## 057 0.0.8 发布状态（2026-09-18）

0.0.8 已构建并发布 GitHub latest：源码提交 `bd58198`，Windows/Android 六附件公开下载和 SHA256 校验通过。`pnpm check` 通过（417 项通过/1 跳过），构建签名与资源嵌入通过。服务器部署未完成：`123.207.179.150:22` 主机可达但用户提供的 root 密码被 SSH 拒绝，未执行远端命令、数据库备份或重启；待提供可用 SSH 认证后从远端 051 基线重新核对，再按部署文档仅更新项目服务。

## 057 新版构建部署发布（进行中）

用户明确授权构建EXE/APK、重启部署指定项目服务器并发布GitHub。主代理认领发布门禁修复、0.0.8版本、签名构建、远端基线核对/备份/部署与GitHub release；只操作本项目服务，凭据不落盘。保留全部056实现与本地修改。先修复并执行完整本地检查，服务器只用受限server-safe，禁止盲目覆盖远端主副本。

## 056 收尾状态（2026-09-18）

项目资料/文件/时间线/活动、AI Gateway/MCP/完整计划资料适配器、分类样式/密度、安全多账户与 UI 已在本地实现。SQLite 迁移当前 17；`pnpm typecheck` 与 `pnpm build` 通过，项目相关 E2E 6/6、Host 专项 5/5、资料存储 3/3 通过。全量 lint 尚被 11 项格式诊断阻断，未运行全量 check；真实 provider、Android 文件保存、EXE/APK 与部署未验收。当前无需继续占用认领区；保留工作树未提交修改。

## 056 三组功能补齐（2026-09-18，进行中）

用户明确要求本轮完成项目资料/文件/时间线/活动，完整AI注册/额度预算/fallback/MCP/多实体计划，以及分类/周期字段/密度/安全多账户，已授权并行子代理。主代理认领项目Application/SQLite扩展、ProjectWorkspace、Host server/OpenAPI/REST-MCP集成与总体验证。子代理分别认领Gateway核心及独立UI；workflows/recurrence及WorkflowManager；native安全账户/src-tauri/bootstrap/Login/AccountViews；categories三适配器/CategoryManager/独立密度组件。各代理不得覆盖他人范围；共享server/App/OpenAPI/migration注册由主代理整合。保留全部既有改动，不部署、不推送、不自行发布或安装工具链。迁移号预留SQLite16/PG8分类，SQLite17项目资料文件。准确状态持续更新。

## 055 待办文档核对（2026-09-18，仅审查）

核对054/053/051与048差距记录，未修改业务、运行测试或操作服务器。当前待办：5项格式门禁；项目树预览深度缓存及边界测试；最新UI部署/版本递增/签名打包/真实升级验收；项目owned/linked与专属创建/文件/时间线/活动；完整Gateway/预算/Unlimited/fallback/MCP；分类样式排序、周期扩展字段、密度偏好、安全多凭据、独立Local Mode、PG鉴权恢复与Linux CI。历史安全发布债务仍需单独授权处理。侧栏折叠、激活过滤、项目详情及子项目入口本地已完成，SSH阻断已解除，不应继续列为未实现。完整核对见sessions/2026-09-18-009-handoff-open-items.md；无工作认领。此清单为文档状态，不是本轮重新运行验收或实施授权。

## 054 激活任务视图与布局（2026-09-18，本地完成，认领释放）

已实现任务页默认已激活且未完成，看板仅已激活（四状态保留）；独立任务规划管理未激活/未归属任务，Domain UTC/依赖激活判定不变。任务徽标区分激活/可执行，显示计数一致，项目卡片和筛选面板布局优化。ADR0034，无迁移/API变化；保留此前修改，全部认领释放。

typecheck/build/架构边界/7文件Biome/diff通过；单测374通过/1原生夹具跳过；专项12通过，全量E2E84通过/3旧默认显示全部断言失败，显式选择全部后失败用例三端复跑3/3通过。未在测试修订后重跑全量。桌面/移动截图已检查，check仍5项既有格式诊断。准确命令见sessions/2026-09-18-008-active-task-views.md。

未部署/推送/打包，服务器仍051。EXE嵌入apps/web/dist，重新打包可包含折叠与任务视图，本轮没有新EXE/APK或真机验收。后续部署仍先核对服务器主副本，原格式/树预览深度缓存问题待处理。

## 053 项目工作区与导航（2026-09-18，本地完成，认领释放）

已完成 Web 项目工作区：说明/引用资料/子项目/递归任务/依赖图，自动预选父级创建，外部阻塞保留；桌面折叠可访问名称、手机独立展开/收起与跨断点溢出修复。ADR0033，复用既有应用契约，无迁移/API变更；资料为引用而非独占所有权。用户指南 PROJECT_WORKSPACE.md。

pnpm typecheck/build、架构边界、改动7文件Biome、diff通过；pnpm test为374通过/1原生夹具跳过；pnpm test:e2e为84/84通过，最终样式/文案微调后重构建并专项6/6通过。已检查桌面/移动截图。pnpm check因5项既有格式诊断失败，不能称全绿。准确命令及早期失败修复见sessions/2026-09-18-007-project-workspace-navigation.md。

未部署/推送/重建EXE/APK，服务器仍051基线；已有安装包不会自动更新本地前端。保留全部此前修改。下一步如需上线先按DEPLOYMENT核对source-051-final.sha256差异；继续专属文档创建/owned与linked模型、文件仓库、时间线和活动需独立ADR及事务验收。原树预览深度缓存风险仍待专项处理。本轮认领全部释放。

## 051 密码认证部署（2026-09-18，完成，认领释放）

用户授权密码登录，交互式SSH已成功，之前“必须私钥”的阻断已解除；密码未保存到项目文件。047实际综合基线402文件无漂移，按明确清单同步13个源码/测试/Agent文档文件，新基线uploads/source-051-final.sha256已复验。线上已更新本轮导航、项目树导入/预览及层级限制代码，不代表这些新增功能已有专门完整用例覆盖。保留050原生包与全部既有改动，未推送GitHub/修改更新源。

SQLite仍15，部署前后在线快照和独立恢复全部通过，旧源码/产物保留。服务器typecheck通过，独立非PG测试323通过/1跳过，Host/Web受限构建通过；check:server-safe因8项格式/导入诊断失败，不称全绿。2026-09-18 14:38:53–14:38:59 CST仅停止/启动项目Web，新PID820798；HTTPS及其他三个服务PID不变。公网可信TLS健康200、匿名asset401、登录页桌面/移动截图已看，无横向溢出/页面错误/业务写入；未用真实应用账户写入验收。准确命令/备份/哈希见sessions/2026-09-18-006-password-server-deploy.md。

下一步：修复格式门禁；新增项目树/层级边界专项用例（特别核对parseProjectPlan深度缓存返回0导致预览顺序相关的风险，实际创建仍有Application层限制）；如用户要求发布新客户端，递增版本与Android code、重新构建签名并更新GitHub清单，再做旧版升级实测。当前仍仅0.0.7本地重构建，不能自动检测为新版。下方050部署阻断属于已解决历史。

## 050 原生构建与部署验收（2026-09-18，原生完成，部署受阻）

已完成Windows NSIS与Android arm64正式签名构建，产物在 F:/Software/OrivaneAtlas/releases/v0.0.7-native-20260918-050/。两包当前JS/CSS字节核对通过，更新包签名及APK v2签名通过。版本仍0.0.7/code7，只是本地重构建，不是新版本发布；未修改更新源或推送GitHub。Windows无Authenticode，未做真机安装/实际升级。保留所有已有修改，仅修复base.css多余闭括号并更新过时E2E定位器。类型、Host/Web构建通过；非PG测试323通过/1跳过；E2E78通过，已查看桌面英文/移动中文截图。全量check被8项lint错误阻断，PG未运行，不能标记全绿。

服务器SSH认证失败（publickey,password），未执行远端命令、同步或重启。部署需要用户配置安全SSH认证或提供该服务器私钥文件位置，之后先核对source-047-final.sha256、备份与独立恢复，再受限构建和仅重启本项目。不得把本地新API当作已经上线。当前认领释放，部署待认证恢复；准确命令与限制见sessions/2026-09-18-005-native-build-and-deploy.md。

## 048 原prompt差距审查（2026-09-18，审查完成，认领释放）

仅审查并更新本地私有记录，无业务修改/部署/推送/新测试。完整差距见sessions/2026-09-18-003-original-prompt-audit-048.md。特别纠正：分类缺排序/icon/color；Manifest仅已有项目添加任务和依赖，非完整项目计划；AI maxRunsPerDay仍1–100，无Unlimited；ready/focus过滤inactive但普通任务/看板visible未过滤，不满足统一查询。安全多凭据、本地免账号完整Workspace、PG鉴权、知识owned/linked、完整Gateway/MCP、侧栏/密度和周期默认字段等未完成。0.0.7上线不等于原prompt完成，Android图标是产物已修复/真机待验。公开根目录审计文件046发布状态过时，留待下次实施统一更新。

## 047 部署与公开发布（2026-09-18，完成，认领释放）

服务器已部署046业务代码，SQLite9→15，升级前后快照及独立恢复通过；仅重启本项目Web，其他服务PID不变。源码已推送main：75b1fb5a00bfbb33bbfdf35068fbb44dd1b3b01f；GitHub v0.0.7已公开，六附件公开下载SHA256及两端latest更新源验证通过。正式Android签名沿用旧证书；Windows只有更新签名，没有Authenticode。

服务器lint/typecheck通过；组合check因受限内存回收停滞主动终止，不算通过；相同限额直接Vitest重跑323通过/1跳过，Host/Web构建成功。生产只读浏览器检查health200、匿名asset401、移动无溢出/0页面错误/0业务写入，桌面/移动截图已看。GitHub CI失败原因是Linux便携PG缺少libicuuc.so.60，323测试通过、PG套件未启动；云端E2E未运行。本地046全量375和E2E78结果仍有效，不称CI全绿。

下一轮先核对服务器uploads/source-047-final.sha256（已复验）；公开SELF_HOSTING.md在打包后更新，服务器保留打包版本，仅文档不同。私有接力仅本地保留，不上传GitHub。详细备份、准确命令、限制见sessions/2026-09-18-002-deploy-and-release-047.md。完整Gateway等046剩余计划未因发布而完成；真机安装、Launcher与实际应用内升级仍待验收。

## 046 后台周期、多模型配置与Android图标（2026-09-18，本批本地完成，认领释放）

ADR0032接通同范围多命名AI配置，旧条目兼容default；独立CAS、选择/审批/发送绑定profileId、移除不回退，双语创建与选择、OpenAPI同步。内部generation nonce防止删除再重建相同配置复活旧审批。Vault/HTTP专项78通过，nonce最终Vault35通过。全量check375/375，最终E2E78/78（中英桌面/中文移动），移动截图已检查。最终lint/架构/diff检查通过。

后台周期调度/Application workflows/Host生命周期、Gateway增量及Android图标认领已释放；保留全部既有修改及备份。未部署、不推送、不发布。Gateway未达到完整注册/策略/账本验收，不得标记全量完成。

后台启动/每60秒调度、事务游标与规则快照补录已实现；AI持久发送预留、文档/父空间数据许可、逐次重验及真实provider token记录已实现。Windows新Rust夹具8通过/1默认忽略，严格Host夹具另跑1/1通过。Android图标改为独立无文字罗盘，adaptive前景13% inset，五档DPI安全圆与两处资源一致性10项通过，最终APK编译资源及原生库一致性已核验。真机显示与安装尚未验收。

0.0.7最终EXE/APK已重建，包含命名配置UI；两端最新JS/CSS字节门禁通过。Windows更新签名与篡改拒绝通过，但没有Authenticode；APK沿用正式RSA4096证书且v2验签通过。成品在F:/Software/OrivaneAtlas/releases/v0.0.7-local/（README、SHA256SUMS及EXE/.sig/APK）。仅本地验收包：生产未更新，新的服务端功能不会因安装客户端而生效，不承诺旧服务端兼容，公开版本未变。

下一步：共享provider/model/capability注册、可信本地自托管登记、六类策略与金额账本/预算对账、审批后有界fallback、Embedding/Agent工具；每项需权限与持久化验收，不把命名个人配置当共享注册表。PG物理恢复、知识owned/linked、密度偏好、安全多凭据切换仍待办。前端大块警告仍存在。准确命令、失败修复、哈希和限制见sessions/2026-09-18-001-background-gateway-icons.md。

## 045 分类、审核计划、周期任务（2026-09-17，本批本地完成，认领释放）

已完成独立分类/项目多分类、Manifest v1预览与人工审核原子幂等发布、日周月周期定义/日期记录/漏做/当日生成/显式补录；三存储适配器、HTTP/OpenAPI、中英Web界面，SQLite15/PG7，ADR0028/0029。AI发送前增加事务内RUNNING及文档版本/正文/删除/父空间/范围复核，ADR0027补充；不是完整Gateway。

验收：pnpm check通过（156文件格式/架构、类型、28文件362单测、构建）；SQLite分类/工作流升级前备份与升级后独立恢复、三适配器CAS/隔离/回滚通过。最终全量E2E72/72通过（2.9分钟），桌面en/zh和移动zh；已检查分类/工作流截图，统一操作按钮。早期两次E2E71/72均为数学编辑测试临时Host关闭超时；专项3/3，通过在测试结束时关闭临时服务残留连接修复，全量重跑通过。最后UI样式与夹具改动后再次build/E2E/lint，diff检查通过。

限制及下一步：周期当前为用户触发，不是后台调度器/完整RRULE；Manifest只新增，工作图变化需重新预览。优先继续Gateway注册表、持久用量账本与完整DataPolicy（现有笔记DENY元数据不能当作已落实策略），再后台周期调度/定义版本补录、知识owned/linked、密度偏好。安全多凭据切换、PG账户、Android图标和原生发布验收仍待办；前端大块警告未解决。PG物理恢复未验收；原生旧夹具通过不代表新增API白名单已重新编译。

准确命令/文件/早期失败记录见sessions/2026-09-17-011-categories-plans-recurrence.md，用户使用说明docs/WORKFLOWS.md。未部署、推送、发布、重建EXE/APK；生产最后记录038/SQLite9，本地包0.0.6/公开0.0.4不变。保留全部既有修改与备份，本批认领已释放。不能将本批当成所有要求完成。

## 044 多项目归属与AI执行门禁（2026-09-17，本批本地完成，认领释放）

已实现独立任务多项目关联表（SQLite13/PG5）与旧projectId回填兼容，Application/CAS/事务事件、HTTP/OpenAPI、双语编辑器；PROJECT仍单父级。任一有效项目未归档时共享任务保持可见，递归统计去重；删除保护包含次要归属，恢复过滤已删除项目。SQLite升级前后备份独立恢复及PG回填验证已通过。

AI新增Application executeApprovedModel并已接入Host：发送前重新授权、解析当前审批路线、输入限制、有限超时/取消、脱敏失败。只支持既有已审批单路线，不自动fallback。ADR0026/0027。统一provider/model注册表、DataPolicy完整门禁、用量账本与fallback尚未完成。

最终pnpm check通过：144文件格式/架构、类型、25文件343单测（含既有原生Host夹具）、构建；全量E2E66/66通过（中英桌面/中文移动），检查新多归属桌面/移动截图；git diff --check通过。SQLite升级前后备份独立恢复、PG回填/升级门禁、三适配器归属回滚/恢复均验证；PG实际pg_dump恢复未验收。准确命令与早期修正见sessions/2026-09-17-010-task-memberships-and-model-gateway.md。

未部署/推送/发布/重建原生包，生产最后记录038/SQLite9、本地安装包0.0.6/公开0.0.4不变。分类、计划导入、周期任务未实现，不能将本节视为本轮全部需求完成。后续依次独立Category+项目分类关联、Gateway注册/账本/逐次数据边界、Manifest预览/确认/幂等原子发布、Definition/Occurrence周期与补录。前端大块警告、PG账户、安全多凭据切换和Android图标/真机验收仍待办。

本批原认领Work模型/三适配器/HTTP/项目任务UI及AI执行门禁已释放。既有未提交改动与备份全部保留；无部署发布。

## 043 项目归档与递归查询（2026-09-17，本地完成，认领释放）

已完成Domain祖先/后代查询、PROJECT归档应用契约、继承归档与恢复说明、递归进度与任务入口、中英UI/OpenAPI。祖先归档不修改子项/Markdown；恢复保留子项独立归档；归档不是执行权限。ADR0025，无新迁移，SQLite12/PG4。

本地pnpm check通过：141文件格式与架构边界、类型、23文件327单测（含真实原生Host夹具）、构建；最终全量E2E63/63通过（desktop-en/desktop-zh/mobile-zh），已检查移动归档/登录截图。修复旧登录/注册测试夹具与登录完成等待竞态，未重新开放旧接口。Biome遵循Git忽略并排除备份/生成Schema，保留备份。构建大块警告仍存在。准确命令、早期失败及修复见sessions/2026-09-17-009-project-archive-and-validation.md。

仍未完成：分类、多项目归属、统一AI Gateway/Manifest、周期任务、知识owned/linked、用户密度偏好、PG账户适配器、安全多凭据切换、Android图标与原生签名更新验收。下一步分类/多归属需先ADR、双库迁移及回填/备份恢复，不能把projectId字段当多归属。未部署/推送/发布/重建EXE/APK，生产最后记录038/SQLite9、本地包0.0.6/公开0.0.4不变。本批不是全路线图完成。

## 042 激活规则与项目层级（2026-09-17，本地完成，认领释放）

已打通四种激活策略的Domain/Application/HTTP/OpenAPI/双语编辑器：手动未激活不能开始/完成，立即激活规范化，依赖完成策略在状态/依赖边增删时事务内重新计算，按开始日期UTC派生可执行性。Ready/Focus过滤未激活工作，规划列表保留；页面每30秒及重新获得焦点刷新UTC日期。依赖联动版本/Activity/Outbox同事务，写失败整体回滚。

PROJECT可用现有projectId嵌套，校验同工作空间、有效父项目、自环/祖先环、并发成环；有子项不能删除，恢复时验证父级。编辑器区分上级项目，项目卡显示父级。不包含分类、多项目归属、继承归档/递归汇总；定时策略没有后台午夜事件。ADR0024，无新增迁移，SQLite12/PG4不变。

最终验证：22文件321单测通过（含既有真实原生Host夹具）；typecheck/build通过；中英桌面/mobile-zh项目编辑+账户回归6/6通过，HTTP验证持久字段/拒绝未知策略并查看移动截图；11文件Biome、架构边界、diff检查通过。pnpm check仍止于299项其他既有/生成文件格式诊断，未跑全量E2E或原生重建/真机。前几次E2E发现定位器问题及select可访问名称不明确，已修复后重跑通过。

未部署、推送、发布或更新EXE/APK；线上最后记录038/SQLite9，本地包0.0.6、公开0.0.4不变。下一批先分类/多项目归属及归档语义（ADR、双库迁移、备份恢复），再AI Gateway/计划导入；不要把本批当作整个路线图完成。准确命令见sessions/2026-09-17-008-work-activation-and-project-hierarchy.md。

### 042 开始时认领

认领Work领域/Application、HTTP输入/OpenAPI、任务编辑与项目视图、共享存储契约测试，先完成activation与项目层级纵向闭环，再按验证结果推进后续模型。保留既有未提交工作。无部署/推送/发布授权；不覆盖生产主副本。验证三适配器事务规则、HTTP、双语E2E/截图及全量check。

## 041 账户体验与隔离（2026-09-17，本地完成，认领释放）

已完成双语退出/重新登录切换、当前/其他会话及单个/全部撤销、最近账户元数据快捷入口和忘记入口（不存密码）。Runtime身份切换清空缓存/游标/幂等待重试、终止请求，拒绝跨身份的排队同步及延迟JSON响应；改密清理身份，退出/切换检查未保存编辑。原生GET/POST白名单已接入。浏览器退出失败保留界面以重试；原生离线退出清理身份并明确警告远端撤销未确认。

测试基线已修复：旧secret登录夹具改为可信离线建号+真实密码登录，保留禁用公开注册/secret登录断言；PG迁移断言使用当前版本。发现并修复非法Host配置先打开数据库导致Windows文件占用，现校验通过后才打开/迁移。没有重新开放旧登录接口。

验证：全量单测306/306通过（包含真实Rust/Host夹具）；Rust release 8通过/1夹具项默认忽略，该项已在全量单测内单独执行；typecheck/build通过；桌面en/zh与mobile-zh专项E2E9/9通过并检查移动截图；12文件Biome、架构边界、diff检查通过。pnpm check仍止于300项其他既有/生成文件lint错误，不宣称全量check通过。未运行全量E2E、Android构建/真机或新安装包签名验收。

未部署/推送/发布/更新安装包：线上仍最后记录038/SQLite9，本地安装包0.0.6、公开0.0.4不变。原生安全多凭据免密切换未完成（当前显式退出后重新登录）；PG账户适配器未实现，Android图标待办保留。下一批按GAP_ANALYSIS推进项目分类/层级/多项目归属及activation事务查询验证，先ADR与迁移备份恢复，不把前agent字段骨架视为完整功能。详见sessions/2026-09-17-007-account-transition-and-session-ui.md。

### 041 开始时认领

认领Web Runtime身份边界、Account/Login UI、双语资源、相关HTTP/浏览器验证和测试基线。保留此前所有未提交改动。实现会话管理和明确退出/重新登录切换，阻止旧请求污染新账号；不声称保存多份原生凭据的一键免密切换已完成。不部署/发布。

## 040 持久会话（2026-09-17，本地完成，认领释放）

已实现SQLite v12散列会话持久化，Host重启恢复、固定到期、PERMANENT空到期；退出/密码/状态变更撤销，以及账户隔离的会话列表和单个/全部撤销API。每账户32会话，登录发放与写操作均事务内复核。新增ADR0022/OpenAPI；修复异机备份Schema上限硬编码。31项专项、typecheck、Host构建和架构边界通过。全量仍有旧登录协议/PG迁移断言与既有lint问题，完整结果见sessions/2026-09-17-006-durable-login-sessions.md。

未部署/发布/原生重建，线上仍最后记录038/SQLite v9。PostgreSQL没有账户适配器，不支持本次持久鉴权；多账号安全切换及缓存隔离UI未完成。升级旧内存会话需重新登录一次；离线恢复备份后须清空恢复库login_session再开放流量，避免恢复已撤销会话。下一批完成账户切换纵向闭环及旧测试基线，再项目模型和AI Gateway。下方039内存会话说明已由本节取代。

认领Application账户端口、SQLite账户会话存储/追加迁移、Host鉴权与会话撤销、专项测试和文档。保留039及前agent UI/原生/activation改动。目标为Host重启恢复、散列凭据、固定到期及撤销；验证真实HTTP重启、改密码/禁用/退出、迁移备份恢复。无部署发布。

## 039 会话策略与改造审计（2026-09-17，本批完成，认领释放）

接续其他 agent 的未提交改动，认领 Host 会话策略、SQLite 设置事务、专项测试、OpenAPI 与审计文档。先修复策略修改不生效、非法枚举、幂等和事务内授权；不覆盖既有原生/UI/activation 工作，不部署或发布。永久会话跨重启、账户切换、项目领域与 AI Gateway 仍需后续批次，不将骨架标记为完成。

已修复：每次登录读取当前策略；旧会话原到期时间不变；严格枚举；设置写入/幂等收据/授权复核同事务，重放旧请求不覆盖后续配置。专项2/2、8包typecheck及根tsc、Host build、4文件Biome、架构边界、diff检查通过。全量check被304项lint诊断阻断；native transport专项缺夹具跳过，未跑全量测试/E2E/原生构建。无新迁移。

特别区分：此前agent已添加本地SQLite v10/v11、PG v3/v4、activation与SavedAccount骨架，不等于上线或完整可用；PERMANENT仍内存会话，Host重启失效。线上最后记录038/SQLite v9、本地安装包0.0.6、公开0.0.4，本轮均未改。下一批先完成持久可撤销会话与账号缓存隔离，再项目分类/层级/多项目任务，再AI Gateway和计划导入。详见GAP_ANALYSIS.md及sessions/2026-09-17-005-session-policy-correction.md。

## 038 服务端七天会话已部署（2026-09-16，认领完成释放）

18:04:43–18:04:44 CST仅重启arclattice-web；七天/604800秒策略已上线，原Web资源不变。033基线通过后只同步server.ts、session-lifetime.test.ts、ADR0020；新270文件基线source-038-final.sha256全部通过。SQLite v9备份及独立恢复验证通过。受限专项HTTP1项、typecheck、Host构建通过；check:server-safe仍被5项既有格式诊断阻断。公网/回环health正常、匿名session401，其他四服务PID不变、原站8088首页/health200。

用户需要重新登录一次；之后固定7天，非滑动续期，服务器重启仍使会话失效。现有EXE/APK无需重建；本地0.0.6及公开0.0.4状态未改变，未发布GitHub。没有生产应用账号，未验证真实用户登录Cookie；已验证隔离真实HTTP及部署产物。退出/切换账户UI、Android图标仍仅待办。部署细节见DEPLOYMENT.md及sessions/2026-09-16-038-seven-day-session-deploy.md。下方037/036的“线上8小时/仍033”是历史状态，由本节取代。用户末尾“并”未补充，不推断其他操作。

### 038 开始时认领

用户授权部署037七天会话；只更新Host server.ts、专项测试与ADR0020，保持线上Web/原生/其他服务不变。先核对033基线，备份与独立恢复，再受限构建和项目Host重启。账户切换/图标待办不动。

## 037 七天会话（2026-09-16，本地完成，认领释放）

Host固定会话改为7天/604800秒，Cookie与服务端共用常量，边界到期即拒绝；ADR0020。真实HTTP测试覆盖8小时后/第6天/7天前1ms有效、7天及之后401、主动退出提前撤销。typecheck/build、专项1项、Biome/架构边界通过；全量check仍295既有诊断。保留035/036工作。未部署/发布/重打包，线上仍旧8小时，需单独部署Host并重新登录；无需重建EXE/APK。服务器重启仍失效。

明确后续待办（用户要求本轮不改）：1. 应用缺少可用的退出登录/切换账户入口，需Windows/Android UI与会话清理验收，不要把已有底层logout能力当作入口已完成。2. Android图标显示不全，三星截图可见Orivane Atlas文字左右被裁切，后续检查adaptive icon安全区/缩放及多Launcher实测。记录见sessions/2026-09-16-037-seven-day-session.md。

## 036 原生会话保持与Windows托盘（2026-09-16，本地0.0.6）

- 已实现：Windows当前用户DPAPI、Android Keystore AES-GCM保存原生会话，不存密码、不暴露Cookie给JS；启动同服务器恢复后由/api/session验证。退出登录、切服、401清除，离线退出也清除。ADR0019。Windows关闭隐藏，托盘打开/退出；不自动开机启动。
- 已验证：typecheck/build；Rust8通过/1忽略（严格Host夹具另1通过）；Android Kotlin及JVM测试通过；专项E2E15通过并查看移动恢复截图；两包精确内嵌当前JS/CSS；APK v2签名/code6与原正式证书一致；Windows真实更新签名及篡改拒绝。Windows实际点击关闭后窗口消失且进程存活，托盘菜单恢复/退出尚未实测，测试进程已清理，用户旧进程未动。
- 本地成品：F:/Software/OrivaneAtlas/releases/v0.0.6/，EXE 7,090,318 bytes、APK 18,711,192 bytes及EXE.sig。未推送/发布/部署；公开版本仍034的0.0.4，服务器仍033。
- 边界：服务器当前8小时绝对会话且仅进程内；过期/服务器重启仍需重新登录，未实现多日refresh token。Android真机Keystore/重启/覆盖安装未测；Windows无Authenticode。全量check在既有295格式/生成诊断处停止，不宣称全绿。
- 036认领完成释放；下一步用户安装验收，按后续授权发布和独立规划长期会话。准确命令/哈希见sessions/2026-09-16-036-native-session-tray.md。

## 036 工作认领（2026-09-16，已完成释放；以下为开始时记录）

本轮认领原生系统安全会话存储、启动恢复、Windows托盘与相关测试/ADR。保留035未提交成果。不修改生产服务器或发布；服务器当前会话8小时且进程内，不能承诺永久免登录。验证本地Rust/Android编译、会话隔离退出、启动恢复及托盘生命周期。

## 035 原生登录与快速反馈（2026-09-16，本地0.0.5）

- 已实现：受限原生HTTPS传输，保留服务端Origin/CSRF鉴权；Cookie仅原生内存，切服清除并拒绝过期响应，禁止重定向。私有图片/备份共用鉴权通道。地址本地校验、native连接3秒/登录总计8秒；401/403/429/网络TLS/超时/无效响应中英分类，无自动密码重试。ADR0018。
- 已验证：typecheck/build、Rust5通过（另1由Host夹具执行）、真实严格Host联调1通过（错误密码/登录/会话/数据/图片上传读取/SQLite备份/CSRF/退出/切服）、登录UI3端3通过及移动截图、更新与图片回归9通过、Android JVM3通过、边界/diff。Rust超时真实等待8秒后重试通过。
- 已构建：F:/Software/OrivaneAtlas/releases/v0.0.5/ 下Windows EXE及.sig、Android arm64正式APK，versionCode5/原正式证书；真实签名验签、篡改拒绝、内嵌前端字节一致、Windows启动响应通过。Windows仍无Authenticode；没有真机Android或已安装客户端升级/真实账户验收。
- 未发布/未部署/未推送：公开版本仍034的0.0.4，线上仍033；无远端写操作或账户操作。本次native修复不需服务器Schema/CORS变更。Web同样新增反馈但线上Web尚未更新。全量pnpm check在295格式/生成文件错误停止，未运行全量单测/E2E，不宣称全绿。
- 035认领完成释放；下一步用户验收本地安装包，再按授权发布0.0.5和更新清单，必要时单独部署Web反馈。记录见sessions/2026-09-16-035-native-login-feedback.md。

## 035 工作认领（2026-09-16，已完成释放；以下为开始时记录）

原生登录与及时反馈：认领src-tauri受限HTTP传输、bootstrap/Login/私有图片加载、双语错误、ADR与测试。只读线上检查已确认health200、Tauri来源OPTIONS403；当前浏览器same-origin Cookie无法用于本地原生UI。保留服务器来源/CSRF策略，原生会话仅内存，不扩大远端IPC权限。登录连接3秒/总请求8秒，错误分型；不修改生产账户或服务器。本轮源码与本地验证，不将模拟测试称为真机验收。

## 034 签名与原生更新已发布（2026-09-16）

- 已实现并公开：v0.0.4（stable feed，早期0.x并非生产就绪认证），commit71cb556，发布于15:57:25 CST。GitHub https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v0.0.4 。Windows x64 EXE、Android arm64 release APK、EXE.sig、latest.json、android.json共5资产匿名下载回验SHA256/长度全部一致；/releases/latest指向本版。
- Windows内置公钥验证更新包，Android独立正式RSA4096密钥签名，同包dev.arclattice.app/code4；用户已接受旧debug版备份后迁移安装。登录/设置有中英更新入口、确认、失败重试；固定官方HTTPS更新源，窄IPC权限。Android系统权限和确认保留，非静默安装。
- 已验证：typecheck/build、6项更新UI浏览器测试（替代native bridge）、Android JVM策略3项、Windows release Rust1项、APK v2签名、EXE真实更新签名及篡改/截断拒绝、两包当前JS/CSS嵌入、Windows启动响应；手机最终截图已查看。更新包签名不是Authenticode，EXE仍NotSigned/未知发布者。
- 全量未绿：pnpm check在283格式/生成文件诊断停止；pnpm test253通过/38失败，其中37旧登录404、1并发超时，异机3项单独重跑通过。全量E2E3通过/3失败/1中断/44未跑，旧登录和品牌期望失效；debug Rust测试0xc0000139，release测试通过。不得把专项通过写成全量通过。
- 真机APK安装/迁移/权限、Windows已安装版跨版本升级重启未测；无adb设备。Android进度不定量。Windows受信任发布者证书仍需外部申请/审核，未申请、未购买、未获批；仅更新包签名已完成。签名密钥受限保存F盘，未公开；独立离线备份尚未创建，后续不能重新生成发布密钥。
- F盘成品目录F:/Software/OrivaneAtlas/releases/v0.0.4/。本轮未改服务器，保持033部署/SQLite v9，不可将此次本地公开源码提交当作服务器主副本已同步。
- 本轮034认领完成释放。准确命令/摘要/迁移和剩余项见sessions/2026-09-16-034-signed-native-updates.md。公开提交仅40项源码/公开文档；私有运维、接力、密钥未上传。旧历史内部资料残留仍待授权处理。

## 034 工作认领（2026-09-16，已完成释放；以下为开始时记录）

原生更新与签名：src-tauri、应用更新契约/适配器、bootstrap、更新UI、中英文、测试及发布文档。目标为固定可信发布源、Windows签名更新、Android系统确认安装；不改业务数据/服务器共享配置。本机证书库无代码签名证书，Android旧debug签名的迁移选择已询问用户；不擅自替换签名导致覆盖升级失效。以033为基线，现有工作树干净。

## 033 服务器与原生0.0.3更新完成（2026-09-16）

- 已部署032分块图片上传，SQLite v9；00:55:01–00:55:06 CST仅维护本项目web，公网HTTPS健康与新资源验证通过。升级前v8/升级后v9一致性备份和新文件恢复通过；其他服务PID未变。服务器268文件基线为uploads/source-033-final.sha256。
- GitHub v0.0.3-debug于00:57:52 CST公开，commit 0fa295965b64a311c6a685b283d0cb141bf987cc；Windows x64 EXE、Android arm64 APK均已上传且GitHub SHA256/长度一致。发布页 https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v0.0.3-debug 。F盘成品目录F:/Software/OrivaneAtlas/releases/v0.0.3-debug/。
- 两端版本0.0.3，Android versionCode3，同包标识/原debug签名/正式Logo；已核验包内分块前端、新.so、15张launcher与旧正确图标一致，无私人服务器IP。仅手动覆盖安装，一键更新和生产签名未实现。
- 本地typecheck/build、25专项测试、2图片HTTP（含21MiB传输/恢复）、3端图片E2E及截图、15文件Biome/边界/diff通过。pnpm check在151项格式/生成文件诊断停止。服务器typecheck通过，server-safe为218通过/37旧secret登录夹具404失败，整体check在5项格式问题停止。没有全量全绿声明。
- 公网只读验收通过，无业务写入；没有应用账号/连接Android设备，线上已登录粘贴和真机安装升级未测。图片无产品大小/工作区配额，Markdown文本限制及网页/HTTP异机备份64MiB限制未改。
- 本轮033认领已完成释放。准确命令、备份、哈希及剩余事项见sessions/2026-09-16-033-server-native-release.md；私有运维接力未推送。旧公开历史内部文档残留仍需单独处理。



## 033 工作认领（2026-09-16）

用户授权更新服务器及EXE/APK。本认领已完成释放；结果见顶部033。保留032成果并审计后提交，未改其他站点。

## 032 已完成：取消图片大小和工作区图片配额（2026-09-15，仅本地）

认领已完成释放：应用图片端口、SQLite分块存储/迁移、Host上传/下载、Web图片入口、中英文文案、OpenAPI及验证。无其他认领覆盖。

- 新客户端取消图片500,000 bytes限制及工作区约20MB图片配额；采用256KiB顺序分块，Host下载有背压逐块读取并重复鉴权，未把整个大图片装入服务端内存。保留PNG/JPEG/WebP签名验证。旧单请求接口保持传输上限兼容旧客户端，旧图片URL/数据不变。Markdown正文/导入限制未改。
- migration9新增上传状态/分块表，workspace+principal绑定，顺序版本及幂等，完成后才公开到工作区；每块与Activity/Outbox同事务。未完成上传24小时无活动后由下一次成功分块写入清理；已完成图片不自动删除。
- 已验证：21MiB+3bytes图片数据多块上传、逐字节下载比对、幂等回放/不重复完成事件、跨工作区/不同principal隔离、非法格式/顺序拒绝、父空间删除、中断过期清理、迁移8→9及独立回滚备份、新分块恢复。
- 实际通过：pnpm typecheck；pnpm build；25专项测试；SQLite/application测试44；图片HTTP专项2（38跳过）；3端图片E2E（700KB文件+粘贴/并发输入/失败重试，0页面错误，无横溢出）；15文件Biome、架构边界、git diff --check。桌面英文/手机中文实际截图已查看。
- pnpm check仍在lint阶段被145项格式/生成文件问题阻断；没有声称全量通过。本轮未运行全量host/浏览器测试、真机或生产验收。
- 尚未部署、推送、重打EXE/APK或发布；服务器保持030、已公开原生包保持031。部署需要另行授权，并先读DEPLOYMENT、核对服务器主副本、备份/恢复验证后迁移9；不能覆盖服务器其他改动。
- 大数据库的网页备份与HTTP加密异机助手仍限64MiB；需运维一致性SQLite快照安全转移，不得裸拷贝活动库。私有snapshot.mjs已兼容v9，线上脚本未更新。磁盘/数据库/网络/浏览器解码仍有物理边界；真机大图片、上传进度/断点续传、孤儿成品清理未实现。准确命令见sessions/2026-09-15-032-unlimited-image-uploads.md。

## 031 原生新版已发布（2026-09-15）

用户要求继续交付新版EXE/APK。本轮原生版本/构建/公开源码与GitHub预发布认领已完成释放；未改生产服务器或更新权限。

- v0.0.2-debug 于17:07:36 CST公开，draft=false、prerelease=true；发布页 https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v0.0.2-debug 。源码cd24c3a已推送main，25个审核过的功能/版本文件；私有文档/工具/服务器信息不在本次公开提交。
- 原生版本0.0.2，Android versionCode=2、dev.arclattice.app；沿用正式Logo、debug签名和可配置HTTPS服务器。EXE与APK均重新嵌入029前端。仅手动更新，一键更新/生产签名仍未完成。
- F盘成品 F:/Software/OrivaneAtlas/releases/v0.0.2-debug/：Orivane.Atlas_0.0.2-debug_x64-setup.exe（5479137 bytes，SHA256 9102AE8234766854C395E9CCF87A621C26FAFC898396CA5A37545AEA08CC9E8A）；Orivane.Atlas_0.0.2-debug_arm64.apk（134937851 bytes，SHA256 AA83399F0A6D04E662041B61C4391A702CE64BDB8BA156F110CCBC60C912364E）。GitHub资产长度/digest均一致，匿名读取确认公开。
- 验证通过：Windows NSIS构建；Android新Rust库编译、复制JNI后Gradle离线打包、APK v2签名；新JS的Brotli字节确实嵌入两个原生二进制、APK库与本轮编译库SHA一致；未嵌入私人服务器IP；typecheck、22专项单测/迁移/备份、1图片HTTP、3端图片E2E、边界/diff。桌面英文/手机中文截图已查看。
- pnpm check在141项格式/生成文件错误停止；未宣称全量通过。adb无连接设备，未做真机安装/升级/剪贴板；Windows未签名。Android CLI因既有Windows符号链接限制退出1后，用本轮新库复制打包成功，不是复用旧库。
- 准确命令与限制见sessions/2026-09-15-031-native-images-release.md。下一步：正式签名/更新链路、真机安装升级与剪贴板、旧登录夹具/格式；此前公开历史内部文档残留问题仍未处理。服务器仍以030部署基线为准，不可把此次公开Git提交当作远端工作区已同步。

## 030 部署完成（2026-09-15）

- 用户明确授权部署并提供SSH认证；凭据仅用于交互认证，未写入文件、参数、Git或记录。029现代上传卡片/剪贴板图片现已部署，SQLite v8。
- 服务器015基线核验只有Login/server两项已知漂移，逐项比对后保留账号登录安全行为；只同步28个审核文件，包括当前编辑器所需本地草稿和已验证的服务器地址/品牌配套。不覆盖原生工程、共享配置或其他远端文件，依赖无变化。
- 16:28:23–16:28:55 CST停止并启动本项目web；Host/Web受原wrapper构建成功。web PID4037473，https3851850、nginx3839234、class-manager-api2049871、zproject-api3033350均active，后三者及网关PID不变；原站8088首页与health均200。
- v7在线备份及新文件恢复通过，切换前另存pre-030-cutover-20260915.sqlite；v8备份post-030-ready-v8-20260915.sqlite及post-030-v8-restore-check.sqlite完整性/外键均通过。旧源码/产物保留于uploads/source-pre-030.tar.gz和artifacts-pre-030.tar.gz。
- 服务器typecheck通过；check:server-safe在Login.tsx一项既有格式错误停止。分开test:server-safe --testTimeout=15000为214通过/37旧登录夹具失败，与本地一致，不宣称全绿。没有在共享机运行PG或浏览器。
- 公网只读浏览器验收通过：可信HTTPS、健康200、匿名图片401、新版卡片/图片粘贴代码资源、登录服务器默认值、手机无横向溢出、0页面错误/0业务写入。登录页截图已查看；没有应用账号，线上已登录粘贴未实测，功能自动化沿用029本地与本轮服务器测试。
- 本轮认领已释放。未推送GitHub、未重打EXE/APK；已安装客户端不因此更新内置前端。剩余为旧测试夹具/格式、真实账号与真机验收、原生发布及既有后续项。准确路径与命令见DEPLOYMENT及sessions/2026-09-15-030-deploy-editor-images.md。

## 030 工作认领：部署029编辑器更新

用户授权部署。认领本项目备份、差异核对、受限构建、Web/Host切换与线上验收；不涉及GitHub发布/原生包或其他站点。服务器015基线仅Login.tsx/server.ts有漂移，已逐项核对：旧密钥入口关闭与本地一致，Host差异仅本轮spaceId变更。现已完成并释放认领，结果见顶部030。

## 029 编辑器上传与私有图片粘贴完成（2026-09-15，仅本地）

- 已实现现代文件选择卡片、笔记/日志/知识文档图片上传与剪贴板插入；中英提示、移动布局、失败重试、异步位置映射及快速输入保护。无需第三方图床，复用鉴权服务器存储。
- SQLite migration8支持显式null spaceId工作区图片，保留旧空间数据及权限；已更新OpenAPI、异机备份schema上限、ADR0016、自部署说明。本地迁移和新旧备份恢复通过，生产未迁移。
- 验证：typecheck/build、19文件Biome、架构边界、diff检查通过；专项单测23/23与图片HTTP测试通过；专项E2E重复9/9、最终3/3，桌面/手机截图已查看。
- 全量pnpm test最终250通过、37失败（旧secret登录夹具收到404）；pnpm check被137项既有格式错误阻断。全量E2E尝试1通过、2失败、1中断、41未运行，旧access-key登录夹具失效，不能声称全绿。
- 限制：一次一张PNG/JPEG/WebP、每张500,000 bytes以内；Markdown导出仅带私有引用，未打包图片；孤儿图片清理、真机剪贴板验收未完成。
- 未部署、推送、发布或重建原生包；线上与现有安装包未更新。部署须另行确认范围并先读DEPLOYMENT、对齐服务器主副本、备份后迁移。旧鉴权测试夹具需要独立更新。
- 本轮029认领已完成释放，包括备份schema兼容修复；文末原认领为历史记录。准确命令见sessions/2026-09-15-029-editor-images.md。

## 028 已发布图标修正版（2026-09-15）

- 用户明确授权发布；GitHub v0.0.1-debug.2 已公开，draft=false、prerelease=true。两份新 EXE/APK 均上传并由 GitHub digest 与本地 SHA256 一致验证。
- 发布页：https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v0.0.1-debug.2。产物哈希同 027，内部应用版本仍 0.0.1；要求手动安装，不声称软件内更新已完成。
- 公开源码 bb08bb2：正式图标与 README 更新；将 HANDOFF/PROJECT_STATUS/session026 移出 Git 跟踪，补全私有文件忽略规则，本地保留。远端当前树核验私有接力/运维条目为 0。
- 重要：发现 de9d272 已公开包含内部文档；本轮仅移除当前树，历史仍可能保留服务器等信息。未擅自改写历史，需用户决定历史清理与相关安全检查。
- 认领发布完成释放。未改服务器、未增加权限或运行大型测试。正式签名、真机安装、一键更新、既有 lint 问题仍待完成。

## 027 图标更新进行中（2026-09-15）

- 认领：README 品牌引用、已有原生图标修改与 EXE/APK 重打包核验；不修改服务器或业务层。
- 已查明 025 使用 assets/icon.svg 是旧图标；正确来源为 apps/web/public/orivane-atlas.png。现有未提交原生图标已由此图生成，本轮保留。
- EXE/NSIS 与 APK 资源重打包成功，认领释放；仍为 0.0.1，未发布 GitHub。
- EXE SHA256：87D36572A433312D3A2111C05D3D9F791868B145B112760DA29347076922CAE9。
- APK SHA256：FC79FCB26D85AB5F4C643E15A5494E2B6A70FE6777CC3CC7CB41573C615BD8F4。apksigner v2 通过；已提取并查看包内 launcher，确认为正式 Logo。
- pnpm check 在 lint 阶段报 139 项既有格式/生成文件错误；git diff --check 通过。真机、正式签名、一键更新、版本提升与发布待完成。准确命令见 sessions/2026-09-15-027-brand-icon-rebuild.md。

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

## 050 当前状态：导航与页面层级改进（2026-09-18）

- 已完成：移除 Workbench 各页面重复的大标题/说明区；新建操作移动到顶部操作栏。
- 已完成：桌面侧边栏收起/展开，状态保存在本机 UI 偏好中；折叠后保留图标导航。
- 已完成：导航项原生拖放排序并持久化，管理员入口仍按角色过滤，设置入口保持固定。
- 已完成：新增 docs/agent/project-plan-import.md 与 project-plan-schema.json，明确外部 AI 只能使用专用可撤销凭据、必须预览和人工确认；当前仍只支持向已有项目追加任务/依赖。
- 已验证：pnpm exec tsc -b --pretty false 通过。
- 未运行：pnpm check、E2E、Android/Windows 原生构建与真机验收；本轮未部署服务器或发布 GitHub。
- 未完成：移动端专用顶部栏抽屉交互、项目树创建入口/服务端层级限制、完整 AI Gateway 与新项目计划导入。

## 051 当前状态：项目树计划导入与层级限制（2026-09-18）

- 已完成：Manifest v1 扩展为可选 projects 数组，支持项目、子项目和任务通过 tempId 组成树；发布时按父子顺序原子创建。
- 已完成：项目树导入预览允许无目标项目（根项目树），仍保留预览与人工确认流程；旧版仅任务 Manifest 继续兼容。
- 已完成：项目树最大深度为 16（包含当前项目），服务端 WorkService 创建/更新项目时统一校验，防止仅靠前端绕过。
- 已验证：pnpm exec tsc -b --pretty false 通过。
- 未完成：项目树导入的专用 UI 可视化预览、E2E/领域测试、完整 AI Gateway 与真实新项目 API 文档发布。

## 052 当前状态：项目树可视化预览（2026-09-18）

- 已完成：WorkflowManager 对带 projects 的计划显示项目树、子项目、任务归属和项目/任务数量摘要。
- 已完成：根级任务与各项目节点内任务分层显示；继续使用现有预览、审阅和发布按钮。
- 已验证：pnpm exec tsc -b --pretty false、git diff --check 通过。
- 未运行：E2E、原生构建、真机验收和服务器部署。
# 029 工作认领：编辑器上传与图片粘贴（2026-09-15）

本轮认领 Web DocumentWorkspace/LiveMarkdown/文件选择样式、LibraryAsset 合约、SQLite 图片迁移、Host 上传与 OpenAPI、相关测试。仅本地实现与验证，不部署生产、不发布原生包。ADR 0016 记录工作区图片归属；完成后补齐实测与释放认领。

## 2026-09-17 Architecture review
- Audit artifacts: CURRENT_IMPLEMENTATION_AUDIT.md, GAP_ANALYSIS.md, MOBILE_ICON_ISSUE.md.
- No business code changed; existing uncommitted native session work preserved.
- Next: ADR/ERD and domain contract tests, then dual SQLite/PG migrations.
- Known pending: logout/switch UI, Android icon P2, full AI Gateway and ProjectPlan import.

## 2026-09-17 Batch 1 progress
- Session policy extraction implemented in packages/host/src/server.ts; default PERMANENT remains revocable and logout path unchanged.
- Git checkpoint blocked by .git write permission; file backup is .refactor-backup-20260917/.
- Next: add instance setting persistence and account switch/cache context, then Batch 2 project model.

## 2026-09-17 Batch 1 execute-first continuation
- Implemented SQLite migration 10 and PostgreSQL migration 3 for persistent instance_setting.session_lifetime_policy, seeded to PERMANENT.
- Host reads the persisted policy at startup; explicit HostOptions remains a test/bootstrap override. Existing sessions keep their captured expiry semantics.
- pnpm typecheck passed after the migration changes. Vitest still cannot be launched through pnpm in the current node_modules state.
- Batch 1 remains active: admin setting mutation/UI, saved accounts, account selector, secure account switching, stale request cancellation, and rolling permanent-cookie renewal are still being implemented.

## 2026-09-17 Current refactor status

- 已完成：Session lifetime 持久化与 Admin UI；Permanent 可撤销会话及基础 cookie rolling renewal；浏览器请求取消与旧响应保护；SavedAccount 初步 metadata；Task activation 基础；SQLite migrations 0010/0011、PostgreSQL migrations 0003/0004。
- 已验证：pnpm typecheck 8/8 packages；直接 Vitest session lifetime 测试 1/1 通过；git diff --check 无实质错误。
- Batch 1 尚未闭环：账户菜单、Add/Switch Account、Account Selector、native secure credential storage、完整 query/cache isolation、stream cleanup。
- Batch 2 尚未开始；Batch 3 仅完成 activation 底层起步；Batch 4–9 尚未实现。
- 后续按 Batch 1→9 连续推进，最后执行全量验证并修复失败。
- 尚未重新运行：full pnpm check、完整测试、E2E、真实 PostgreSQL 集成、原生构建与真机验收。
