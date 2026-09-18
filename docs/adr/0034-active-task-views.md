# ADR0034 — Activation and execution views

Accepted 2026-09-18. Extends ADR0024/0033.

Activation is orthogonal to TODO / IN_PROGRESS / DONE / CANCELED. Global Tasks and Board include only live TASKs satisfying Domain isExecutionActive with the current UTC day, regardless of search, status, project or archive filters. This preserves active terminal work for explicit history queries and board terminal columns. Task list defaults to unfinished (TODO/IN_PROGRESS); Board defaults to all execution statuses. Returning via navigation, hash or reload restores each view's default.

Task planning is a separate navigation destination containing active and inactive tasks, including unassigned tasks, with an activation filter. Future scheduled tasks count as inactive until their UTC start date. Dependency-driven activation follows existing transactional Domain/Application rules; blocked manual-active tasks remain visible. Activation is not readiness, archive, deletion or execution status. Project task planning and dependency inspection keep inactive work discoverable.

UI uses the existing Domain activation projection and existing authenticated mutations; there is no schema, API or permission change. Counts reflect the visible filtered set. All new UI labels are bilingual. The native desktop client embeds the same Web build; fresh signed packaging and real-device validation are separate from Web checks.
