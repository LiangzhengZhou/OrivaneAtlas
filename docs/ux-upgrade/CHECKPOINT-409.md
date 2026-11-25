# HTML 笔记与直接导入

本地开发分支为 `codex/html-notes`，从 `3f674b2` 开始。公开版 v3.2.0 早于这项改动。本轮无生产操作、版本发布或 Schema 迁移。

## 使用

在「笔记」中点「导入 HTML」，选择一个 UTF-8 的 .html 或 .htm 文件，进入阅读页。标题优先使用 HTML title，其次使用文件名。新建空白笔记后，可在「Markdown ▾」菜单中选择「使用 HTML 编写」。已有笔记通过「··· → 导入、图片与修订 → 导入 HTML」导入时，覆盖非空正文前会显示确认。编辑后在「··· → 导出 → 导出 HTML 源文件」保存源码。

单文件上限 600,000 字节；正文连同格式标记不超过 200,000 个 UTF-16 代码单元。静态阅读支持段落、标题、表格、内联样式和嵌入的常见位图。阅读页不执行脚本，也不下载外部资源。带资源目录、依赖脚本或网络样式表的网页可能与浏览器独立打开时不同。

## 数据与回滚

详见 [ADR 0155](../adr/0155-html-note-bodies.md)。笔记仍由现有保存命令写入，沿用所有权、版本和同步合同。回退客户端后，旧版把 HTML 正文显示为带围栏的源码。使用「导出 HTML 源文件」可以独立保留可移植的 HTML 文件。原有 Markdown 笔记沿用原格式。

## 验证

- 独立浏览器与宿主使用合成数据。桌面英文、桌面中文、移动中文专项共 9/9，覆盖直接导入、保存、重开、源码导出、错误文件、从零编写 HTML，以及既有 Markdown 修订和导出。源码往返覆盖 UTF-8 BOM。移动端首次运行发现错误提示挡住新建按钮，修正后同场景通过。历史与最终专项日志分别为 `.artifacts/ux409/focus.log` 和 `.artifacts/ux409/tested-focus.log`。
- 已验证前端生产构建、`pnpm lint`、`pnpm typecheck`。构建日志在 `.artifacts/ux409/tested-build.log`。
- [桌面中文截图](evidence/session409/desktop-zh.png) · [桌面英文截图](evidence/session409/desktop-en.png) · [移动中文截图](evidence/session409/mobile-zh.png)。
- Android 实机和实际安装包升级本轮未验证。原生 Windows 验证使用独立无签名夹具、独立用户配置和本机回环更新地址。

## 本地交付与复验

功能提交 `9df9061`，覆盖替换确认的测试提交 `a29e5a3`。对已有正文先取消、再确认替换的补充场景，桌面中英文和移动中文均通过，日志在 `.artifacts/ux409/replace-focus.log`。

`pnpm check` 已通过，包含 309 个 Vitest 文件、1,595 个用例和生产构建。三端专项测试和实际 Windows 客户端均使用独立样例，不包含用户笔记。Windows 夹具运行于 WebView2 158.0.4370.33，视口 1280 × 840，DPR 1。由客户端打开 HTML 文件，确认标题、表格、自带样式、沙箱和编辑保存，然后刷新并重新打开。文件选择通过自动化控件完成。[Windows 阅读页](evidence/session409/windows.png) · [运行环境](evidence/session409/windows.json)。

```powershell
pnpm check
pnpm test:e2e --grep 'HTML note imports directly|HTML authoring starts|notes, safe reading'
pnpm test:e2e --project desktop-en
pnpm test:e2e --project desktop-zh
pnpm test:e2e --project mobile-zh
```

原生 WebView2 验证脚本见 [windows-html-note.mjs](evidence/session409/windows-html-note.mjs)。对已构建的本地验收夹具，向脚本传入新的目录和隔离可执行文件位置。全量单测使用现有的独立原生测试夹具，通过 `ATLAS_NATIVE_TEST_EXE` 指定。所有完整浏览器回归使用独立端口和临时资料库。

桌面中文全量回归的一次 200 ms 延迟重启测试收到静态首页 404，随后登录控件等待超时。轨迹记录请求时间为 23:35:49.348，`pnpm check` 重建的 `apps/web/dist/index.html` 写入时间为 23:35:49.703。复跑使用固定构建目录 `ATLAS_UI_FIXTURE_DIST=.artifacts/ux409/tested-dist` 隔离并发构建。不要在回归运行中重建它所服务的目录。

固定构建复跑首次仍未通过，失败发生在测试数据的同步游标达到目标之前。测试通过宿主数据库直接写入大量样例，测试客户端当时已经启动。提交 `8d40d6d` 在准备阶段重载一次，再等待原有游标检查；计时从准备完成后的下一次重启开始，原断言、延迟及预算保持一致。专项覆盖 150、200、800 ms 和三种浏览器配置。

## 最终结果

| 配置 | 结果 |
| --- | --- |
| 桌面英文全量 | 289/289 |
| 桌面中文全量 | 288/289；200 ms 延迟重启用例修正准备步骤后通过 |
| 移动中文全量 | 289/289 |
| 重启专项 | 三种平台配置 × 三个延迟，9/9 |

867 个浏览器配置用例均有通过记录。桌面中文的完整单次运行保留上述一次失败，另有固定构建上的单项复跑未通过准备阶段；修正后未重复整套桌面中文测试。移动中文结果取自固定构建的 `.artifacts/ux409/mobile-concurrent.log`，旧顺序启动器重复启动的第二个移动进程已停止，未计入通过。桌面日志为 `.artifacts/ux409/full-desktop-en.log` 和 `.artifacts/ux409/full-desktop-zh.log`，修正后专项为 `.artifacts/ux409/restart-ready.log`。详见[验证汇总](evidence/session409/gates.json)。

HTML 开发与验证在本机隔离环境完成。个人笔记导入通过用户电脑上已登录客户端的正常保存和同步功能单独完成。测试和截图使用独立合成内容。尚未验证 Android 实机文件选择与 Windows 安装包升级。
