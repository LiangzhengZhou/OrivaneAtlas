# ADR 0008：隔离服务器开发工作区

- 日期：2026-09-14
- 状态：接受；实施结果见 DEPLOYMENT.md 和会话 006。

## 背景

用户明确建议直接在指定服务器上工作。该主机已有网站及两个业务后端，资源为 2 CPU / 约 2 GB RAM；不能把开发工作迁移理解为接管现有入口或发布未鉴权服务。

## 决策

1. /srv/arclattice/workspace 为后续服务器开发主副本，本地仓库保留接力/可恢复快照。切换主副本后，后续对话必须先读取服务器状态，不得盲目用本地覆盖远端。
2. 专用非登录 arclattice 系统账户，无 sudo；workspace、data、home、cache、toolchain 为项目所有。父目录、admin 和 uploads 由 root 管理。凭据不进入仓库或命令参数。
3. Node 24.20.0 / pnpm 11.19.0 仅安装在项目 toolchain，不改全局 PATH 或系统包。Node 下载与官方 HTTPS SHA256 清单核对，不声称独立签名验证。
4. 项目命令通过 root 管理的 transient systemd wrapper 降权运行：半个 CPU、512 MiB MemoryHigh、768 MiB MemoryMax、禁用该任务 swap、128 tasks、20 分钟任务期限；固定 unit 防止经此入口并发叠加。
5. 只允许项目目录写入；隐藏已知其他业务目录，不赋予 capabilities。此边界用于可信项目开发，不是完整不可信 Agent 沙箱，不限制网络出口，也不授权运行任意附件脚本。
6. 不修改 Nginx、已有 units、SSH/firewall；本轮不创建常驻服务或公网监听。后续预览仅回环绑定配合 SSH 隧道；正式域名/TLS/鉴权单独设计。
7. 共享线上主机不启动便携 PostgreSQL 测试集群。新增 test:server-safe / check:server-safe 显式排除 PG 集成测试，并限制 worker；Windows 仍执行完整 check。服务器通过不等于 PG Linux 验证。

## 风险和退出路径

- 独立账户和 cgroup 限制降低但不消除共享资源争用；变更前后检查原站 HTTP / API health 和 unit PID，异常时仅停止 arclattice-dev-job.service。
- 安装失败保留项目目录用于诊断，不回滚/删除其他目录，不重启系统。
- 工具链/cache/workspace 数据仍在同一磁盘；需检查容量，尚无项目磁盘 quota/异机备份。
- 本地 Codex 会话并未自动迁到远端宿主；通过已验证主机身份的 SSH 操作远端。现有 server-ipv4 别名不是本项目目标，不能复用。
- UI 仍是 Memory；本轮环境迁移不构成持久化宿主、Auth 或 Agent 功能交付。下一宿主 ADR 用 0009。
