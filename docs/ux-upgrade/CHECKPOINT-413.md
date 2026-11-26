# v3.2.2 设置页更新

本次发布基于 GitHub 正式版 v3.2.1（a9861d4），目标提交 66cbde8a76cf8a1931f6ae2edb380216fe851f0f。适配桌面和窄屏设置导航、外观选项与明暗配色预览。交互对照图见 [设置页改版记录](CHECKPOINT-412.md)。

- 发布前本地完整 pnpm check 通过，309 个测试文件，1596 个用例。浏览器首次全量为 867/870；两项设置回归使用滚动修正前的构建，另有一项导入后的状态断言失败。最终设置构建专项 12/12、位置加测 3/3。发布构建再次执行设置导航、偏好持久化与文件重命名后继续导入，桌面英文、中文与移动中文共 9/9 通过，包含首次失败的三个用例。
- 发布构建的 lint、架构检查与类型检查通过。前端 77 个文件与最后通过设置专项的构建逐个比对，仅 openapi.json 的版本号改变。发送到服务器的 132 个 Host/Web 文件逐一比对一致。
- 服务器既有版本为 3.2.1，基线 1774 个路径，目标 1784 个路径，24 项差异核对均无漂移。部署目录为 /srv/arclattice/uploads/release-322-66cbde8。准备阶段建立 SQLite 在线备份和独立恢复副本，schema 52，完整性与外键检查均通过；配置和 vault 快照位于服务器该目录的 rollback/config-vault.tgz。新建合成数据库的隔离宿主通过首页、JS 与健康验证。
- 回退时用配套的 dist.before-322-66cbde8 及 rollback/source 差量，保全切换后新增的数据。需要恢复数据库时先恢复到新路径。设备上的草稿、原件与待同步操作需继续保留。

## 上线结果

北京时间 2026-11-26 19:17:37 服务器完成差量切换，19:18:15 正式发布 v3.2.2。main 和标签指向 66cbde8。公网首页及健康接口 200，主脚本与发布构建逐字节一致，旧版主脚本仍可读取。线上 24/24 项差异已应用，SQLite schema 52，完整性与外键检查通过。仅重启 arclattice-web，网关 PID 保持 3851850。Windows 更新签名、Android v2/v3 签名、APK 内 JNI、7 项 JVM 测试、6 个公开附件及两份稳定更新清单均已核验。

候选原生构建与[公开签名检查](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45809358996)通过；交付时本次 [main 完整 CI](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45809231673) 仍在运行。Windows 覆盖安装及 Android 真机升级待设备验收。生产 SSH 会话已结束。

[正式版](https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v3.2.2) · [产物校验](evidence/session413/release.json)
