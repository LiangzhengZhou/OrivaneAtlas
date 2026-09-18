# 2026-09-18 0.0.8 构建与发布

## 范围

- 用户授权构建 EXE/APK、部署并重启指定服务器、发布 GitHub。

## 已完成

- `src-tauri` 与 Cargo/Android 版本升级为 `0.0.8` / Android code `8`。
- Windows NSIS 安装包构建成功；updater 签名及篡改/截断拒绝验证通过。
- Android arm64 release APK 构建成功；Android unit tests 通过，APK v2/RSA4096 签名通过，当前 Web JS/CSS 资源嵌入核对通过。
- `pnpm check` 通过：40 个测试文件、417 项通过、1 项跳过；完整 E2E 复跑 91/96 后发现 5 个旧定位器问题，修复后分类/密度/Gateway 三端专项 6/6 通过，项目与账户等专项通过。PostgreSQL 并发测试单独通过。
- 提交 `bd58198` 已推送 `main`；GitHub `v0.0.8` latest 发布，Windows/签名/APK/latest.json/android.json/SHA256SUMS 共六附件公开 URL 下载校验通过。

## 未完成与阻断

- SSH 已核对主机指纹，但 `root@123.207.179.150` 使用本轮提供密码认证连续返回 `Permission denied (publickey,password)`。因此未运行远端盘点、未做 v15→v17 数据库备份/恢复验证、未上传源码、未构建服务器端、未重启 `arclattice-web.service`，也未触碰其他服务。
- 未做实体 Android 设备安装/升级和 Windows 安装实测。APK 文件下载仍使用浏览器 Blob 路径，未做 Android 真机保存验证。

## 发布产物

- 本地发布目录：`F:/Software/OrivaneAtlas/releases/v0.0.8/`。
- GitHub：`https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v0.0.8`。
- 服务器继续前需提供可用 SSH 私钥/密码或修复 root SSH 认证；认证恢复后先读取 `DEPLOYMENT.md`、核对 `source-051-final.sha256`，再只操作本项目服务。
