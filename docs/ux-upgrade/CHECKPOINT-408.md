# v3.2.0 发布检查点

**最终状态：v3.2.0 已上线。** 下文按发生顺序保留发布过程，最新结论见「生产切换与公开发布」。[验证结果](evidence/session408/release.json)


2026-11-25，候选提交 `f0a0e5b1b6c4da66880bd62851b7666a6c0e9c4c`，代码基线 `485324a`。GitHub 上一个正式版本为 v3.1.14，main 为 `0f0595a`。本次授权覆盖正式版、现有签名流程与核验后的同项目部署。

- 本地 Windows NSIS 的产品和文件版本均为 3.2.0。安装包的更新签名通过内置公钥验证，修改和截断样本被拒绝。
- ARM64 APK 的包名为 app.orivane.atlas，versionCode 3002000，v2/v3 验签通过，证书与 3.1.14 相同。JVM 用例 7/7。APK 内 JNI 与本次构建相同。两个平台的二进制均含当前 JS 和 CSS。
- GitHub 候选分支 codex/release-3.2.0 已推送。Release 暂存六个资产，逐项核对远端字节数和 SHA-256。本地记录在 .artifacts/ux408/draft-check.json。
- 服务器原主目录没有提交。比对 v3.1.14 的 1474 个 Git 路径与目标 1736 个路径，458 条差异均可直接应用，无缺失和冲突。其他未纳入发布清单的本机文件保留。
- 项目数据实际为 SQLite schema 52。在线一致快照与独立恢复副本均通过 application_id、schema、完整性和外键检查，位置为服务器 data/backups/pre-320-f0a0e5b.sqlite 及 restore-320-f0a0e5b.sqlite。数据未离开原服务器。
- 新版 Host 在隔离回环端口和新建的合成数据库完成健康、首页与 JS 校验。为已打开的旧标签保留了四个上一版按内容命名的静态文件。原件、草稿、Outbox、账户及真实工作区未被当作测试夹具。
- 发布前公网 HTTPS 健康与首页 200，首页 SHA-256 为 07a0e3e9a376b5b53874913c39c488280fe20a074afb9e7c7cbb65d7fb1d96d6。线上仍为 3.1.14。本地版本全检、云端 CI、生产切换和稳定版推广结果见后续收尾记录。Windows/Android 真实安装升级、Android 真机及讲述人仍待单独验收。
- 恢复先查本地 git status、.artifacts/ux408/check.log 和 draft-check.json，运行 node .artifacts/ux408/ci.mjs。服务器发布记录仅在 /srv/arclattice/uploads/release-320-f0a0e5b，prepared.json、probe-ok、live.json 分别表示准备、隔离验证和实际切换。切换前复验文件与服务基线，保持同一数据库，仅操作 arclattice-web。回滚使用原 Host/Web 配套产物与原源码差量，数据库恢复至新路径另行评估；已有客户端待同步工作必须保全。
## 已结束的本地与原生门禁

- 发布提交的 `pnpm check` 退出 0，309 个测试文件、1595 个测试通过，11 个包类型检查及两项构建通过。`pnpm test:e2e --project=desktop-zh`、`desktop-en`、`mobile-zh` 各 287/287，三个命令均退出 0。日志在 .artifacts/ux408。与上批实测前端的 77 个文件比对，仅 openapi.json 的版本号改变。
- 本次 GNU Rust 测试二进制直接启动遇到 Windows 加载错误。产品 EXE 已内嵌 Common Controls v6 清单；独立测试副本补上相同依赖后 34 通过、5 忽略。带当前测试副本的 Host/native-transport 集成测试另通过 1/1。构建产生的平台专用 ACL 已留在本地证据目录。
- GitHub Native validation 已通过，包括 Windows/Android 构建。候选 CI 的 pnpm check 步骤成功，完整浏览器步骤在运行。服务器使用新建数据库验证部署运行时；共享机未运行全量测试，也未将生产数据用于交互测试。GitHub 草稿尚未切换稳定更新通道。
## 云端浏览器结论与发布状态（22:25 +08:00）

GitHub CI 45613007586 在同一候选提交结束，pnpm check 通过，完整浏览器 855/861，六项失败。Native validation 45613007905 通过。GitHub v3.2.0 目前是草稿；main 和线上仍为 v3.1.14，未开始生产切换。复核前不要执行 cutover 或提升稳定更新通道。

|配置|失败场景|已确认的现象|
|---|---|---|
|桌面英文|项目关联已有知识空间|关联后的标题没有出现，页面显示服务暂时不可用。|
|桌面英文|笔记修订历史|切换到修订工具后等待历史条目超时。|
|桌面英文|批量回收与恢复文件|恢复后立即打开原件，元数据请求返回 404；此后 32 毫秒另一个文件状态写请求才开始。尚未证明原件丢失。|
|桌面中文|笔记文件夹|创建第二个文件夹时未显示目标行，页面显示连接错误。|
|桌面中文|1440×900 深色矩阵|Chromium 加载 JavaScript 记录 ERR_NO_BUFFER_SPACE，页面未进入登录交互。|
|移动中文|选择本机顺序后继续导入|模拟连接中断后，恢复界面未进入「内容已导入」状态。|

六项使用对应本地项目各重复两次（桌面英文 6、桌面中文 4、移动中文 2），12/12 通过。此回放不能替代失败的云端门禁，也不足以把其余五项归为网络缓冲区耗尽。浏览器轨迹与快照在 .artifacts/ux408/cloud/，原始云端日志在 .artifacts/ux408/cloud-e2e.txt。未从生产读取真实用户记录或原件。

## 生产切换与公开发布

用户明确接受上述六项云端失败并要求立即推广已签名候选。本地再次为切换建立独立 SQLite 快照，随后仅停止和启动 arclattice-web。切换后 458 项差异均已应用，原始基线无漂移，服务端源码与 f0a0e5b 对齐。生产数据库保持 schema 52，完整性 ok、外键违规 0。网关 PID 3851850 保持不变。线上仍可按原 SHA-256 读取上一版 JS，配套旧 Host 和 Web 在各自的 dist.before-320-f0a0e5b 目录。

22:32:07 +08:00 服务器切换完成。公网健康和首页 200，首页及主 JS 的公开字节与本地相同。22:33:44 +08:00 发布 GitHub stable。六项附件全部通过匿名下载和逐字节校验；latest/download 下的两份更新清单也验证成功。[Release](https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v3.2.0) · [公开签名验证成功](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45635413144)。main/tag 的重复 CI 为新运行，与这里披露的候选 CI 分别记账。

独立隔离用例先等待三份原件上传的持久化回执，然后延迟文件恢复请求，成功复现 404。v3.2.0 用户可以在同步完成后选「重新检查」。本地后续修复 4e986ba 在同工作区、同主体、同文件存在待同步变更时显示同步中并重新鉴权，原件仅在权限核验后显示。含等待/放行断言的桌面中英文和移动中文测试 3/3；类型检查、lint 通过。补丁保留在独立分支，未更改已发布附件。
