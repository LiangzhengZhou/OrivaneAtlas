# 工作区显示同步失败而服务器连接检查成功

2026-11-26。正式版 v3.2.2，客户端报告 20:57:47 认证成功、HTTP 200、102 ms。公开首页与 /api/health 分别返回 200。连接检测访问 /api/health 和 /api/account/sessions，工作区同步另外读取绑定、会话及增量。客户端当次同步异常的具体响应未知。

## 重现与修复

在全新的内存 IndexedDB 测试库内建立绑定，模拟首次 /api/session 短暂断网，然后将服务器设置为正常。发布版的实现缓存了失败初始化的 Promise，后续即使探测成功，绑定同步也无法重新建立会话。两种合成身份测试均在修改前失败，证据位于 .artifacts/ux414/repro.log。另核实旧版顶部“重试”调用了快照刷新，未唤醒网络轮次。

本地分支 codex/sync-retry-322，产品提交 73dda58，基线 80b7d3d。新逻辑仅在同一身份代次重试暂时失败的初始化。原账户恢复增量读取，另一账户在工作区请求前被拒绝，原绑定保留。顶部按钮刷新快照并唤醒现有受保护的同步协调器。界面区分本地读取、网络、权限、会话、版本及其他失败；实时事件流单独断开时继续通过常规同步检查可用性。实现范围为客户端组合根、Shell 和双语文案。无 Schema 及服务端变更。

## 验证与恢复

- 账户边界、协调器及提示分类 35/35，日志 .artifacts/ux414/sync.log。重现用例修复后 2/2，日志 .artifacts/ux414/recovery.log。
- 冻结自动重试时钟后，真实浏览器键盘激活“重试”，断言第二次同步立即发起、成功后提示消失。桌面中英与移动中文 3/3，日志 .artifacts/ux414/browser.log，截图 .artifacts/ux414/report/data/。此处权限错误为合成样本。
- 本地构建成功，日志 .artifacts/ux414/build.log。全量 pnpm check 与 pnpm test:e2e 运行于本地隔离环境，输出 .artifacts/ux414/check-verified.log 和 .artifacts/ux414/e2e.log，终态文件分别为 check-verified.result 和 e2e.result。
- 未发布或部署本修复。保留真实工作区与草稿，未执行清理或更改绑定。在用户设备上确认提示是否消失及同步是否恢复仍待观察。

恢复时先 git status --short --branch 与 git log -2 --oneline，检查上述两份终态与日志；未结束的门禁继续等候。用 pnpm exec vitest run apps/web/src/account-boundary.test.ts -t "recovers a bound replica" 及 pnpm test:e2e tests/e2e/interaction-primitives.spec.ts -g "@workspace-sync" 可重跑本次专项。

21:13 检查时，pnpm check 已完成 lint 与类型检查，进入 Vitest；端到端全量共 873 个用例，已进入桌面英文工作场景。保留 Vitest 和 Playwright 本地进程，避免并行启动占用同一临时端口的第二套浏览器测试。两套命令会分别写出最终退出状态。用户设备上仍运行正式版 3.2.2，故新代码不能直接证明该设备已恢复。
