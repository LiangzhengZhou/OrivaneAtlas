# v3.2.1 正式发布与项目服务更新

2026-11-26。基线为 v3.2.0（f0a0e5b），本次候选提交为 a9861d4422adc0523a21adbabd1e63a9dae54e0a。范围为 HTML 笔记与导入、知识空间首页、文件库浏览、文件及笔记的文件夹整理，以及批量上传时的本地整理事务重试。工作区数据格式和依赖锁沿用上一版。展示改动见 [410 检查点](CHECKPOINT-410.md)。

## 构建及服务端准备

- Windows x64 NSIS 3.2.1 复用现有更新签名，内置公钥验证成功，篡改和截短样本均被拒绝。Android ARM64 APK 为 app.orivane.atlas，versionCode 3002001，v2/v3 验签及生产证书指纹核对成功，7 个 JVM 用例通过。
- 两个平台的原生二进制均含发布前端的 JS/CSS，APK 内 JNI 与实际发布构建一致。上轮已验证的前端和发布版各有 77 个文件，唯一变化为 openapi.json 的版本号。服务器压缩包 132 个 Host/Web 文件逐字节与本地构建一致。
- GitHub 草稿 ID 458720453 的六个资产已核对名称、字节数和 SHA-256。候选 CI 为 45712825049；原生验证为 45712825143，Android 首次获取 Maven 依赖返回 429。
- 服务端部署证据位于 /srv/arclattice/uploads/release-321-a9861d4。逐个核对 1736 个原路径、1774 个目标路径。62 项差异可直接应用，其余无漂移或缺失。SQLite schema 52 的在线备份及独立恢复文件均通过完整性与外键检查。隔离端口用新建数据库验证首页、JS 字节和健康接口。配置与 provider vault 的备份以 0600 保存在本次 rollback 目录中。
- 回退应使用同一组上版 Host/Web 与本次 source 差量备份。新版沿用原 schema，保全切换后产生的数据。确需恢复数据库时在新路径验证备份，再评估切换。其他服务和网关仅作只读检查。
- Windows 安装升级、Android 真机和讲述人实听仍待设备验收。隔离测试与公开首页核验均未读写用户业务内容。

最终切换、正式 Release 及公开更新清单以本文件末尾记录为准。

## 生产切换与发布

2026-11-26 06:33:47 +08:00 切换线上项目 Web 服务。06:34:23 发布 GitHub v3.2.1 正式版，main 和 tag 对应 a9861d4。源码差量 62/62 已应用，线上基线无漂移，网关进程 PID 3851850 保持一致。公网 health 和首页均 200，新首页与主 JS 的 SHA-256 与发布产物一致，旧版主 JS 仍可按原 URL 读取。SQLite schema 52，完整性 ok、外键违规 0。Windows 更新签名、APK v2/v3 生产签名、Android JVM 7/7、发布前端专项 12/12、六项公开附件和两个稳定更新清单均已验证。[正式版](https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v3.2.1) · [公开签名检查](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45714383555) · [发布证据](evidence/session411/release.json)

候选原生验证 45712825143 已通过，重跑 Android 后四项工作均成功。GitHub 公开签名验证 45714383555 成功。发布时常规完整 CI 仍在运行。可查看 [候选 CI](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45712825049) 和 [main CI](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45714255271)。本地同提交的 pnpm check 已通过 lint 和类型检查，Vitest 继续运行；进程自动把退出码写入 .artifacts/ux411/check.json，完整日志在 .artifacts/ux411/check.log。不要将运行中的完整回归计入通过数。
