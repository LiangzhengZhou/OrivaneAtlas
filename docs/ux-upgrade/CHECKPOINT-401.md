# Session 401 · 撤权与大 PDF 原件

## 1. 执行摘要

从 `codex/ux-upgrade` 的 `4595838` 恢复，先核对检查点留存的两个浏览器回归与含原生程序的完整检查。三者全部通过。原件与撤权实现为 `54a6f07`，会话复核为 `24f1df3`，主动退出返回原本机工作区为 `4d4ecfc`，撤权后整页集合恢复为 `60553a4`。超过 16 MiB 的 PDF 可以按页读图；远端会话已撤销时，已打开的工作区要求原所有者重新登录。

## 2. 范围

本轮处理 §13 第 5、13–18 项中的文件原件、会话撤销、平台验证与兼容。全产品其余项目沿用[验收表](ACCEPTANCE.md)。

## 3. 品牌与设计系统

使用既有双语登录页、文件详情、原件页码、错误提示与对话框控件。复核期间提供状态反馈，撤权时移走可操作的原工作区，重新认证保留设备上的草稿。

## 4. 模块体验

已绑定账户在前台核对会话，恢复窗口焦点时立即复查。确认失效时暂停工作区，搜索、详情、下载、打开的预览及后台订阅随之隐藏或停止。当前标签记住已确认的锁定；刷新或打开旧文件入口仍须重新认证。服务端在恢复时检查预期工作区和 principal。全新浏览器标签会独立复核。主动退出从当前账户返回独立的本机工作区，账户副本可在同一所有者重新认证后再打开。独立任务编辑夹具验证重新认证后仍能看到未提交的标题，而且服务端标题没有被改写。[草稿结果](evidence/session401/revoked-draft.json)

## 5. 资源中心

在线查看已同步原件时，客户端使用当前工作区和强 ETag 获取最多 256 KiB 的单段。先验证 206、Content-Range、长度和原件标识，再交给 PDF.js。英文桌面、中文桌面和中文移动浏览器均显示了红色第一页与蓝色第二页，关闭挂起请求产生实际取消事件，重开成功。已授予文件元数据和内容读取权限的凭据被所有者撤销后，元数据、摘录和后续字节请求返回 401，所有者仍能读取原件。设备原件通过现有哈希验证后在 Blob 上按段取页。单张 Markdown 图片读取失败时，原文档仍可重试及切换读写模式。[区间明细](evidence/session401/remote-ranges.json)

60 项混合集合整理另有三次中断恢复实测。服务端提交第一项后暂扣响应，另一会话撤权。锁定时服务端仅有 1 项到达目标。原所有者重登、核对回执、重开工作区后可完成其余移动。每次均核对 30 篇笔记、30 篇文档、原文、spaceId、关联版本和独立第三集合。每个关联只前进一个版本。复验使用 `ATLAS_BENCH_REVOKE_MOVE=1` 和 Session 400 的整页夹具。 [三次恢复原始结果](evidence/session401/interrupted-collection.json)

## 6. 架构与代码

应用层定义半开字节区间与来源接口。bootstrap 组装本机或远端来源并校验身份；前端解析器仅消费受权数据。Tauri 将分段请求绑定到当前 WebView 的资源句柄；关闭句柄会丢弃正在等待响应的 Rust future。文件列表继续使用既有业务契约。关键文件为 `apps/web/src/bootstrap.ts`、`apps/web/src/App.tsx`、`apps/web/src/features/files/PdfOriginalPreview.tsx`、`packages/application/src/file-page-source.ts`、`packages/file-parsers/src/pdf-page-view.ts`、`src-tauri/src/transport.rs`。[ADR0153](../adr/0153-scoped-original-page-reads.md)

[逐文件变更清单](CHANGES-401.md) 可用 `git diff --name-status 4595838..60553a4` 核对。原生 IPC、ACL、查看器、文件授权及真实 Host 测试都包含在内。

## 7. 数据与同步

沿用原有 schema、Outbox、Receipt、文件所有权、存储哈希及授权模型。公开 HTTP 接口沿用单区间 GET；新增 Tauri 命令及 ACL 需与 Web 资产一起构建。私有凭据、真实用户资料及生产迁移均未参与验证。

## 8. 性能与环境

本地 Windows 11 x64（10.0.26300），Intel Core i5-12500H，12 核／16 逻辑处理器，系统可见内存约 15.8 GiB，Chromium 153.0.8010.12。两页合成 PDF 为 18,875,129 字节，三种配置各用三次 GET，共 525,049 字节。该结果取决于页面引用的数据分布。另一份 18,874,810 字节的单页 PDF 复用了 Session 400 的同一原件，以前仅有下载按钮，本轮离线首屏单次 2,928 ms，下载哈希一致；主渲染线程 backing storage 采样最高 97,735,191 字节。当前 Host 每段仍会校验完整原件摘要。[离线样本](evidence/session401/offline-large-pdf.json)

## 9. 质量门禁

撤销时保留的同步回执与后续移动曾在本地工作区 revision 上连续竞争，实测出现仅完成 5 项。60553a4 对已中止的工作区修订冲突有限退避，继续传递原实体版本和目标前提；服务端与数据层的 CAS 合同沿用原实现。12/12 组合验证覆盖自愿退出、图片拒绝后重试、双身份选择器与大 PDF 权限。

原检查点 `browser-57cdd9e.log` 为 837/837（57.5 分钟），`browser-eeef72c.log` 为 840/840（48.4 分钟），`check-3b84038-native.log` 为 307/307 文件、1588/1588 测试和 2/2 构建。[门禁日志摘要及 SHA-256](evidence/session401/gates.json) 收录通过、失败、已替换的运行；本地原始日志分别在 .artifacts/ux400、.artifacts/ux401。新候选进程及终态另见 [PROGRESS.md](PROGRESS.md)。

本轮专项用 `pnpm exec playwright test tests/e2e/work.spec.ts --grep 'large PDF originals'` 验证三个配置。含账户切换、收藏、原件与重新认证的先行组合 9/9。新加入实际取消断言后的三配置 3/3。Web 区间/取消合同 2/2；完整授权夹具 1 项通过（125 项被过滤）。Rust 优化版测试 34 通过，5 项忽略。Android ARM64 构建已核对 ELF64/AArch64 和 JNI；本轮未在 Android 系统中运行应用。[Android 构建](evidence/session401/android-ranges.json)

Windows 未签名独立标识的 Tauri 构建耗时 8 分 55 秒。真实 WebView2 158.0.4370.33 从文件选择器导入 18,875,129 字节，核对两页画布像素和关闭后按钮焦点。深色英文桌面及中文移动同样完成在线翻页、关闭请求和撤权专项（2/2）。[Windows 实窗结果](evidence/session401/windows-large-pdf.json)

## 10. 交互证据

[升级前同一离线大文件的详情](evidence/session400/large-pdf.png) · [桌面第二页](evidence/session401/large-pdf-page-two-desktop.png) · [中文移动第二页](evidence/session401/large-pdf-page-two-mobile.png) · [桌面撤权](evidence/session401/revoked-detail-desktop.png) · [中文移动撤权](evidence/session401/revoked-detail-mobile.png)

[Windows 原生第二页](evidence/session401/windows-large-page.png) · [深色桌面撤权](evidence/session401/revoked-dark-desktop.png) · [深色移动撤权](evidence/session401/revoked-dark-mobile.png)

## 11. 发布、迁移与回退

原件服务须先具备强 ETag 单段响应，原生壳和前端资产需配套升级。遇到不匹配或不支持的响应时停止预览，用户可通过授权下载取得原件。回退为上一组匹配的前端、原生壳与服务，保留原件、工作区副本和未同步命令。本机未推送或发布。

## 12. 未完成项与风险

服务支持所有者账户和可撤销的细粒度集成凭据。独立人类账号加入同一空间的委派政策沿用 ADR0108 的所有权边界，尚无多用户共享验收。不能远程收回已经合法下载的字节。低端设备内存、完整 PDF 辅助技术、Android 真机及其他 §13 项目继续记录在 [ISSUES.md](ISSUES.md)。

## 13. 运维影响

撤销服务端会话后，在线窗口在重新聚焦或下次前台复查时识别结果；单一资源返回 401 会触发会话复核，只有作用域内会话确认失效或身份不符才锁定。网络中断本身不会判为撤销。应保留设备副本，使用原工作区所有者重新认证。追查预览故障时可核对授权、响应状态、区间和 ETag，不需要记录文档内容。
