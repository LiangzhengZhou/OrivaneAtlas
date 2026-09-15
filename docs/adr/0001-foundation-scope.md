# ADR 0001 — 第一轮采用 Foundation + 可执行任务切片

日期：2026-09-13。状态：Accepted（阶段性实现决策）。

## 背景

初始工作目录为空，用户请求查看架构并开始构建，同时支持跨对话持续推进。原始架构覆盖 M0–M14，不应将一个可打开页面误标为完整 v0。

## 决策

1. 建立 pnpm/Turborepo、React/TypeScript/Vite、纯 Domain、异步 Application Ports、Memory Adapter、双语 UI、测试、CI 配置与 Tauri 入口。
2. 以 WorkItem 创建/更新、依赖关系、软删除作为验证边界的纵向切片，提前试验 M3–M5 的少量行为，但不跳过 M1。
3. 内存适配器仅供演示/契约验证，持续显示刷新丢失数据提示。正式 LOCAL 仍是 SQLite，REMOTE 仍是服务端持久化，不以 localStorage 取代它们。
4. 只引入实际使用的依赖。TanStack Router/Query、Zustand、Tailwind/shadcn/Base UI 等在产生真实需要时逐步接入；当前组件 CSS 和 view state 不是这些子系统的最终设计。
5. 不初始化远程仓库、不推送、不发布、不选择许可证、不安装大型原生工具链。

## 后果

现在可以验证关键层次与行为，但 M0 仍缺原生构建证明，M1 的 SQLite/PostgreSQL/Migration 必须继续推进。当前 UI 仅是早期交互基础，依赖列表不是 React Flow 图编辑器。

归档架构文档保持不变；本文解释阶段性偏差，不代表放弃长期需求。
