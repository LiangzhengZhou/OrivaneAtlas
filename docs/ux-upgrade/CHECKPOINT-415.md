# v3.2.3 同步修复版上线

2026-11-26，北京时间 22:14:46 完成服务器切换，22:15:48 发布 [v3.2.3 正式版](https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v3.2.3)。GitHub main 和附注标签均指向 3d7ed10005e1e8f3b62a0afb65ed95f720c7df5f。关键提交为 73dda58（会话恢复、同步重试及双语反馈）、4c4ab89（版本、客户端配置及发布说明）、3d7ed10（更新过期测试文案）。[附件摘要、部署状态与验证证据](evidence/session415/release.json)

## 回归与交付验证

- 最终提交在本地通过 pnpm check，共 310 个测试文件、1603 个用例，包含真实 Windows 传输夹具。Rust 34 项通过、5 项忽略。浏览器全量 pnpm test:e2e 首轮 872/873；英文用例仍等待旧提示。轨迹中实际显示了网络中断提示。更新文案断言后，在桌面中英及移动中文复跑同一草稿保护场景，3/3 通过。完整日志 .artifacts/ux414/e2e.log，修正复测 .artifacts/ux415/draft-preservation.log。
- Windows 与 Android 均嵌入经核验的发布 Web 资源。打包过程中首份候选二进制未包含主脚本文件名，校验拦截后改用标准前端目录，重新打包并签名；只有重建后通过核验的产物进入正式版。Android ARM64 版本码 3002003，v2/v3 与既有证书一致，JNI 校验及 7 项 JVM 测试通过。Android 真机升级仍待验证。
- 隔离 Windows 上用两个正式签名的 NSIS 包先安装 3.2.2，再原位安装 3.2.3。两次实际 EXE 版本与目标相符，主窗口可响应，测试用应用数据标记保留。托管 Windows 上调试端口不可连接，未在该安装测试中操作应用内的重试按钮；按钮走浏览器三配置专项验证。[Windows 安装升级记录](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45831552308)
- 六个公开下载附件与本地发布文件逐字节相同，稳定通道的 Windows、Android 清单一致。[公开签名工作流](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45837228267)及[候选原生验证](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45829387230)成功。记录交付时 [main 完整 CI](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/45837020569) 仍运行。

## 部署、兼容与回退

服务器原有 1784 个受跟踪路径，目标 1790 个，27 项差异零漂移；上线后 27 项全部核对一致。隔离宿主用合成数据库验证健康、首页和主脚本。切换前已做 SQLite 在线备份、独立恢复副本和切换备份，均经过完整性、外键及 schema 52 核验。版本沿用 v3.2.2 的数据格式。仅切换项目 Web 服务，网关 PID 3851850 保持。公网首页与健康 200、主 JS 与本地构建逐字节一致、浏览器页面错误 0；旧版主脚本仍可访问。公网截图 .artifacts/ux415/public-before.png、public-after.png。生产 SSH 会话已结束。

部署目录 /srv/arclattice/uploads/release-323-3d7ed10。需要回退时对照 prepared.json、rollback/source 和两套 dist.before-323-3d7ed10，在短维护窗口恢复对应程序文件并验证旧首页与健康接口。保全上线后新增数据与设备上的草稿和待同步修改。数据库如需恢复应先使用独立新路径验证。

恢复核对可运行 git status --short --branch、git ls-remote origin refs/heads/main 'refs/tags/v3.2.3^{}'。当前正式版已发布，无待执行的生产命令。
