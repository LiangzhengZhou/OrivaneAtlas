# v3.2.4 原生同步修复上线

北京时间 2026-11-27 01:25:15 完成服务器切换，01:25:42 发布 [v3.2.4 正式版](https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v3.2.4)。GitHub main 与附注标签均指向 f4e5c4d2e961879e793872d813c5d283dfb68636。实现提交 b09770d、d11a8b5，测试夹具修正 a1961e2。五个合法同步请求已补入原生客户端白名单，顶部提示可展开查看失败阶段、错误码与已知 HTTP 状态。[公开附件哈希和部署证据](evidence/session418/release.json)

## 客户端与验证

- 修复基线的完整本地检查 1606/1606，Playwright 873/873。发布提交重新构建 Web 与 Host，在最终构建上重跑同步重试、双会话草稿保留及原命令回执场景，桌面中英文和模拟移动中文共 9/9。[修复与基线记录](CHECKPOINT-417.md)
- [隔离 Windows 安装升级验证](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45867077496)使用正式签名包从 3.2.3 原位升级，检查 EXE 版本与合成应用数据标记。Windows 更新器验签通过并拒绝篡改包。Android ARM64 版本码 3002004，APK v2/v3 和既有证书一致，包内 JNI 与本次编译输出一致，7 项 JVM 测试通过。Windows 与 Android 均核对内嵌的 JS/CSS。[候选原生构建](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45866328442)
- 六个附件逐一公开下载并与本地逐字节比对，两份稳定通道清单均已核验。[公开签名工作流](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45867653032)成功。保存交付证据时 [main 全量 CI](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45867559708) 仍在运行。Android 真机升级及原用户设备的同步恢复情况待验证。

## 服务器、备份与回滚

服务器 v3.2.3 的 1790 个受跟踪文件与基线一致，目标 1797 个。应用 32 项变更后逐项复核，无漂移或缺失。生产预备备份、独立恢复副本与切换前备份均通过 SQLite 完整性及外键检查，schema 为 52，无迁移。先用隔离临时数据库验证候选 Host 和静态资源，再仅切换 arclattice-web，HTTPS 网关 PID 保持 3851850。公网首页和健康接口 200，浏览器页面错误 0。首页和主脚本与候选构建逐字节相同，旧版主脚本仍可完整读取。

回滚依据在 /srv/arclattice/uploads/release-324-f4e5c4d，包括 prepared.json、rollback/source、manifest.json。两个运行目录的 dist.before-324-f4e5c4d 保留切换前的 Web 和 Host 产物。需要回退时按本次差异恢复配套源码与运行目录，保留切换后新增的业务数据，复核旧首页哈希、健康接口及服务状态。

本地发布工作区 .artifacts/ux418，发布浏览器日志 release-browser.log，原生验证 native-parity.json，部署核对 server-source-audit.json、server-live.json，公网记录 public-before.json 和 public-after.json，附件校验 published.json。SSH 会话及本地打包、测试流程均已结束。
