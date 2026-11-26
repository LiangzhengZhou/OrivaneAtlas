# Orivane Atlas 3.2.3

- 修复启动时网络短暂中断后，服务器连接检查成功、工作区同步仍无法恢复的问题。网络恢复后，客户端会重新获取会话并核对账户与工作区绑定。
- 点击顶部「重试」会立即发起工作区同步。提示会区分本机读取失败、网络中断、权限及工作区版本问题。
- 沿用 v3.2.2 的数据格式，无需迁移。建议有未同步修改的用户先保存当前编辑，再安装更新。

Workspace sync can now recover after a temporary startup connection failure. Retry starts a sync round immediately and checks the bound account and workspace before reading changes.
