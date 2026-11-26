# 417 · Windows 工作区同步

分支 `codex/native-sync-replay-fix`，基线 `08d0993`，产品修复提交 `b09770d`、`d11a8b5`，测试端口修正 `a1961e2`。本轮处理已认证账户工作区顶部的同步失败反馈。

## 复现与实现

- 对 3.2.3 的 Windows 原生请求策略执行新增回归测试，五个合法 POST 均在客户端返回 `INVALID_SERVER`。服务端健康和会话探测可以同时成功。原始失败输出保存在本地 `.artifacts/ux417/before.log`。实际用户设备上阻塞的命令未确定。
- 在 Tauri 的方法与路径白名单中补齐 `/api/v1/memo/save`、`/api/v1/library/move` 和 work、note、library 三个 v1 purge 路径。仍按原工作区、原命令和幂等键走现有回执流程。原生回归逐条验证 POST 保留原始目标路径、GET 被拒绝。
- 后台同步失败时，点顶部状态可查看失败阶段、经过筛选的错误码，以及已知的 HTTP 错误状态。信息仅保留在本次客户端运行内，恢复后隐藏。原异常继续走原有冲突与回执处理。通过 React 浮层和既有中英文资源提供键盘操作。
- 本次无数据库迁移和生产操作。回滚本次产品提交即可恢复此前客户端行为。退回旧版会再次遇到原生白名单缺项。交互验收使用合成账户及独立临时工作区。

## 验证

| 检查 | 结果 |
| --- | --- |
| Windows GNU 工具链，`cargo test --release --offline --locked --manifest-path src-tauri/Cargo.toml --lib` | 35 通过，5 项默认忽略。其中 Host 契约由下一项独立执行，其余 4 项依赖 Windows 交互式通知环境。 |
| 设置 `ATLAS_NATIVE_TEST_EXE` 指向上述 Rust 测试程序后，执行 `pnpm exec vitest run packages/host/src/native-transport.test.ts` | 1/1 通过。认证原生客户端用原命令提交两次移动，回执相同，重新读取的文档属于目标空间，Markdown 正文保持一致。 |
| 同步协调器、账户边界及错误分类专项 Vitest | 最终 39/39 通过。覆盖拉取/应用失败、原生字符串错误携带阶段、原异常对象保留、重试恢复及仅显示安全诊断字段。 |
| 固定提交 `a1961e2` 上的 `pnpm check` | 退出 0；架构、lint、类型、310 个测试文件中的 1606 项测试及构建通过。含 Windows 原生传输与临时 Host 的契约联测。 |
| 完整 `pnpm test:e2e` | 873/873 通过，耗时 54.7 分钟。桌面英文、桌面中文、移动中文各 291 项。全量运行开始后还细化了错误诊断，因此又在最终构建上重跑诊断与重试、双会话草稿保留、真实 Cookie/CSRF 命令与 IndexedDB 回执三个场景，9/9 通过。 |
| `pnpm exec tauri build --config src-tauri/tauri.connected.conf.json --no-bundle --no-sign --ci` | Windows GNU release 构建退出 0，逐一确认生成的 EXE 内含当前 HTML 所引用的 4 个 JS/CSS 资源文件名。验证产物位于本地构建目录，未安装到真实设备。 |
| `pnpm test:e2e -g '@workspace-sync\|two independent sessions sync updates'` | 6/6 通过，覆盖桌面中英文和移动中文。最终浮层样式与阶段文案另跑 `-g '@workspace-sync'`，3/3 通过。 |

[桌面中文详情](evidence/session417/sync-detail-desktop-zh.png) · [移动中文详情](evidence/session417/sync-detail-mobile-zh.png)。截图为临时测试工作区的模拟 403，用户设备的该次失败无对应 HTTP 证据。

## 全量回归与恢复

本地日志位于 `.artifacts/ux417/`。首轮 `pnpm check` 为 1604/1606，一项是测试夹具分到 Fetch 拒绝的临时端口，另一项是运行期间 Vitest 已载入旧同步实现，随后读取到了新增的字符串错误断言。会话用例单独复跑 3/3；更新测试夹具后，额外注入拒绝端口验证重新分配成功。固定提交的完整重跑写入 `check-final.log`、`check-final.result`。浏览器全量命令为 `pnpm test:e2e --output .artifacts/ux417/e2e-results --reporter=list`，结果见 `e2e.log`、`e2e.result`。浏览器使用隔离测试宿主；恢复前先检查进程、Git 状态与当前 HEAD。Windows 已安装版本仍需通过修复版现场验证。

上述检查及测试宿主已结束。最终构建上的浏览器复验结果为 `pinned-sync-browser.log`。可用 `pnpm test:e2e -g '@workspace-sync|two independent sessions sync updates|real cookie/CSRF Work replay'` 复跑。后续交付需要发布包含原生修复的客户端；只有新版设备自然同步成功，才可判定该设备恢复。
