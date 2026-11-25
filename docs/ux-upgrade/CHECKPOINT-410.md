# 知识空间、文件库与文件夹整理

本地分支 `codex/resource-folders` 基于 `5b066f0`，含上一轮 HTML 笔记。涉及 Web 表示层、整理操作的本地事务重试及交互验证。现有桌面与移动客户端通过相同应用合同使用数据。发布、签名与部署独立于本次交付。

## 交互与取舍

| 入口 | 操作与用户收益 | 实现及兼容 | 验证 |
| --- | --- | --- | --- |
| 知识空间 | 首页显示空间卡片与讲义数量。当根目录有空间且有超过五个松散文件时，以总数及「查看全部文件」收起文件列表。筛选、搜索和空间内仍显示对应文件。 | 使用已有文件和空间视图；过滤只影响显示。 | 模拟有多个空间和重复扩展名的附件集合，从首页切换到全部文件。 |
| 文件库 | 项目超过三个时用一个可搜索的项目入口浏览，已有资源的项目靠前。常用类型、排序、上传和视图控制分行排列。成功上传的记录可以展开，失败项保留重试。 | 复用已有项目计数和过滤器。项目标题作为浏览条件，大量空项目仍能搜索。 | 用 44 个项目、12 张图片检验首屏、查找和键盘取消。 |
| 文件、文档及集合 | 行末归类按钮打开目的地。可搜索完整路径，可从搜索词新建根集合，再选择加入。在具体集合中的「移动」只转移当前关联。可多选后点移动或将选中行拖到移动按钮选择目的地。 | 使用 FolderLink 及带源版本、目标关联 ID 的 move 命令。已有目标去重、其他集合、原件和 Document.spaceId 均沿用 ADR 0151；批量失败显示完成数量。 | 单项归类后进入目标目录；混合多选、已有目标、第三个集合、点选、拖动、取消和键盘归焦。 |
| 笔记 | 笔记行「更多操作 → 移动到文件夹…」。多篇笔记通过「选择 → 移动所选」使用同一选择器。支持搜索、新建和移回未分组。 | 沿用 NOTE 范围的主文件夹、笔记版本及组织版本。 | 单条笔记与批量笔记移入目标文件夹，检查列表中的主文件夹。 |

无需数据迁移。回退前照常完成待同步的整理操作。回退界面后，已有文件夹、文件原件及笔记正文仍可从旧入口访问。

## 复验

对功能检查使用生成数据和临时宿主。验证快照与测试日志位于 `.artifacts/ux410/`。专项可通过以下命令复验。

```powershell
pnpm build
pnpm test:e2e --grep 'large project and attachment libraries|moves a mixed collection|organization selection archive delete|resource queue preserves|files page opens real documents'
pnpm check
pnpm test:e2e
```

## 布局复测

同一台 Windows 机器、同一份模拟数据（44 个项目、2 个空间、12 张图片），分别运行上一轮和本轮网页构建。关闭上传队列后，把页面滚回顶部，通过首个资源行的边界框读取 CSS 像素。

| 视口 | 首条文件起点（原版 → 本轮） | 首屏项目按钮（原版 → 本轮） | 知识空间首页逐条列出的散文件（原版 → 本轮） |
| --- | --- | --- | --- |
| 桌面 1280 × 720 | 579 → 334 px | 44 → 1 | 12 → 0 |
| 窄屏 412 × 839 | 1314 → 500 px | 44 → 1 | 12 → 0 |

桌面 [原文件库](evidence/session410/before-desktop-files.png) · [现文件库](evidence/session410/after-desktop-files.png) · [知识空间](evidence/session410/after-desktop-knowledge.png)。窄屏 [原文件库](evidence/session410/before-mobile-files.png) · [现文件库](evidence/session410/after-mobile-files.png)。[深色目标选择器](evidence/session410/mobile-folder-destination-dark.png)。原始读数保存于同目录的 geometry.json 文件。

## Windows 与构建

实现提交 `deebc82`。独立 Tauri fixture 分别嵌入 dist4 及最终重试修复版 dist6，两次通过。最终运行使用 WebView2 158.0.4370.33，视口 1280 × 840，DPR 1。通过本机应用导入 12 个合成文本文件，用 Enter 打开行末按钮、新建集合、键盘选择，再重载并确认集合内恰有目标文件。原生记录见 [result.json](evidence/session410/result.json) 与 [重载后的集合](evidence/session410/windows-collection.png)。行末中文按钮折行修正在 dist5 进入，桌面、移动对照截图来自 dist5，Windows 截图来自 dist6。Windows 安装包升级、讲述人实听和 Android 真机本轮未验。GitHub Release 与部署未变更。

本机 pnpm lint、pnpm typecheck、pnpm build 通过。环境日志为 .artifacts/ux410/verified-lint.log、verified-types.log 和 verified-build.log。全量浏览器调用的构建比最终 CSS 微调早，保留了对应失败和后续独立复跑记录。


## 批量上传后的整理冲突

最终专项的一次桌面中文运行在新建目标文件夹时失败，五次成功后再次复现。独立合成构建的诊断轨迹捕获 LocalStorageError（VERSION_CONFLICT、$local.workspace/revision）。后台确认上传推进了工作区版本，尚未提交的整理写入中止，界面当时只提示连接失败。提交 `ca61cc2` 将原有有界重试复用于新建文件夹、笔记移动与添加集合关联。只有整个本地写入已因工作区版本变化而中止才重新开始，原实体 CAS、目标约束及权限继续检查。新增 IndexedDB 双连接回归模拟每次连续三轮无关写入，核对各操作只留下一个待同步命令，并验证陈旧笔记组织版本被拒绝。该文件 2/2 通过。诊断构建和重放记录在 .artifacts/ux410/filing-diag2、contention.log 及 contention-browser.log。


## 浏览器回归结果

整套执行 870 个配置用例，865 通过、5 失败（48.4 分钟）。首轮桌面英文的虚拟触摸时钟、知识搜索选择器、文件打开按钮定位分别完成修正，并跨三种配置复验。桌面中文的上传后建文件夹竞争在最终构建的连续 18 项专项通过；移动中文 Markdown 断线重连用例曾在点击底部导航时超时，单独重放 2/2 通过。首次全量执行使用 dist3，后续修复有定向验证，没有将 865/870 记为单轮全绿。日志依次见 .artifacts/ux410/full.log、accepted.log、file-open.log、contention-browser.log 及 markdown-replay.log。

## 其他检查及接力

全量 pnpm check 的 Vitest 阶段 1593/1595。隔离宿主首次登录返回 500，PostgreSQL v29 备份恢复用例超时，二者单独复跑均通过。新增双连接回归所在文件 2/2。后续独立 lint、类型检查和构建均通过。浏览器全量 865/870，五项均已在专项重跑通过。首轮全量结果按原始记录保留。

本地日志 .artifacts/ux410/check.log、host-route.log、backup-replay.log。工作分支 codex/resource-folders，起点 5b066f0，主要界面 deebc82，事务处理 ca61cc2。本轮检查、临时浏览器宿主和隔离 Windows 应用已结束。复验竞争问题可执行以下命令。发布前设备验收可用合成文件在 Android 系统选择器上传图片、归类并杀进程重开，在 Windows 安装包上用讲述人核对目标名称、关闭后的焦点及重开结果。

```powershell
pnpm exec vitest run packages/storage-local/src/organization-metadata.test.ts
pnpm test:e2e -g 'large project and attachment libraries|moves a mixed collection' --repeat-each=3 --workers=2
```
