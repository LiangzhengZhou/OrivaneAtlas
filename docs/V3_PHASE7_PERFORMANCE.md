# Phase 7 interaction checkpoint

The unchanged `a9dc99a37486a191139c548a70150df2d20d6c67` production baseline
and current production build were measured in twenty alternating pairs. Both
disable Playwright trace serialization during this dedicated benchmark. Both
await the requested conversation's final message and its rendered Markdown,
rather than allowing previously displayed messages to satisfy settlement.
Typing uses identical trusted CDP input and checks saved Markdown.

All forty functional samples pass; all fourteen median performance gates meet
the maximum 10% regression budget. Conversation opening uses 32.264ms versus
23.5755ms of browser script time. The 100KB typing p95 medians are 6.9605ms
versus 4.1435ms. Every current sample has ten live task list rows and fourteen
board rows, with 1,500 tasks in the fixture. Exact sample names, ranges and
ratios are recorded in `benchmarks/v3-phase7-interaction.json`.

Previous failed cohorts and the interrupted dependency-interfered cohort remain
in local evidence. None were filtered into this comparison. Targeted history
tests additionally verify lazy offscreen Markdown and preserved scroll position
when loading earlier messages across three browser configurations.

This checkpoint does not establish whole-v3 completion. In particular, the
legacy mobile Atlas surface still requires its mandatory later-phase redesign;
Local Runtime wiring, Android native runtime, Files, notifications, sync and
the full visual/native acceptance matrix remain separate gates.
