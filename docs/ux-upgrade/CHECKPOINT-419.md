# 419 · Windows 3.2.4 原机同步验证

工作分支 codex/note-folder-sync-effects，原机运行正式版 3.2.4；本地修复 d528816，格式校验修正 ae9cb95。正式安装路径未发生变化，安装器经发布哈希与更新签名校验、原位升级退出码 0。升级后的自动同步与手动重试均报「准备待同步修改 / VALIDATION_ERROR」。

用户授权执行一次同版本诊断。在原工作区正常同步抛出异常时，仅捕获前端编译资源的代码位置。定位到 3.2.4 的 local-organization-replay-request.ts 第 179 行，即 organization.apply 的 organizationEffects 校验。未记录用户条目、正文、标识符、凭据或队列负载。诊断客户端已退出，原安装路径的正式版已重新开启。现场确认到共用校验分支，无法从本次观测唯一反推该笔队列命令的具体子操作。

## 合成复现与修复

使用合成笔记，复现“将已有正文的笔记移入文件夹”在同一文件第 179 行返回相同错误。旧版要求变更集合为 organization；正文可用时领域服务实际更新 notes，使用笔记版本。正文延迟加载时，旧队列可能包含仅更新 organization 的意图。修复让客户端基于原命令与已记录变更匹配集合、实体及基线版本。服务端在同一鉴权、CAS、业务及回执事务中处理两类写入，回执覆盖整批。保留原命令和幂等键。已验证混合批次、重复提交、声明不完整、版本过期、正文保留。

本地合成浏览器测试经真实 HTTP、IndexedDB 重开、命令提交及回执确认，桌面中英文和移动中文 3/3。单独 Host 集成测试通过。复现输出 .artifacts/ux419/before.log，修复后的验证 .artifacts/ux419/folder-host.log 与 browser.log。完整 pnpm check 在 .artifacts/ux419/check-final.log、check-final.result。首轮 lint 发现上一轮发布证据的 JSON 缺末尾换行，已在 ae9cb95 修正。

原机是否恢复需以包含客户端和 Host 修复的正式版本重新验证。目前 3.2.4 正式版仍未恢复。
