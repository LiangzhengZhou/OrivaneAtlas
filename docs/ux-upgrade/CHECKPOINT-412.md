# 设置页布局与主题预览

2026-11-26。分支 codex/settings-layout，自 1552f3a 开始。布局与预览提交 979b593，滚动时同步目录提交 ddc57f3。变更限于 Web 设置视图、配色预览、样式和交互测试，尚未发布。

桌面保留可通过键盘访问的分组目录，并在滚动时标示所在分区。窄屏目录改为单行可横向滑动。显示模式、密度和语言采用一致的标签及控件列。配色预览随系统实际生效的明暗模式变化，选中项有勾选标记。账户与 API 在进入时显示；应用更新入口遵循客户端更新能力。复用原有保存与账户合同，无 Schema 迁移。回退可恢复上版界面。

在相同的中文 1280 × 720 和 412 × 839 浏览器视口检查首屏，数据来自隔离工作区。桌面 [原版](evidence/session412/before-desktop.png) · [新版](evidence/session412/after-desktop.png) · [深色](evidence/session412/dark-desktop.png)。窄屏 [原版](evidence/session412/before-mobile.png) · [新版](evidence/session412/after-mobile.png) · [深色](evidence/session412/dark-mobile.png)。

最终构建的设置专项 12/12，额外验证滚回页首后当前分类的桌面中英与移动中文 3/3；均通过。检查包括账户和 API 按需加载、日历跳转后焦点、保存时区、语言与外观控件渲染、密度及主题重开、配色对比度、导航键盘排序与草稿保护。原先针对整张外壳的边框断言在首次执行失败，已更新为检查新的分区卡片边框，并保留内层 fieldset 无边框的检查。最终 lint、架构边界、类型检查和 Vite 构建通过，详见 .artifacts/ux412 下的 lint-final.log、types-final.log、scroll-build.log、scroll.log、location.log。未验证 Windows 原生外壳或 Android 实机。

全量 pnpm check 与 870 项 Playwright 在最终配色和滚动修正前启动，交付检查点时仍在执行，进程可继续运行。查看 .artifacts/ux412/check-final.json 与 full.json 的退出码，以及 check-final.log 和 full.log 的汇总。若有失败，用同一配置和用例名在最终构建复跑。运行专项时设置 ATLAS_UI_FIXTURE_DIST 指向 .artifacts/ux412/scroll-dist，执行 pnpm test:e2e -g "settings preferences are separated|palette text and actions|workspace timezone appearance density|hardening editors outside click retain"。本轮无需服务器操作。
