# Project categories, reviewed plans and recurrence

These features are available in the local development implementation. They do not imply that an existing public installer or hosted instance has been upgraded.

## Categories

Open **Projects → Manage project categories**. Create a name and select projects. A project can belong to multiple categories. The category filter changes the project list; it does not change task ownership or permissions. Deleting a category preserves its associations so it can be restored.

## Import a reviewed plan

Open **Projects → Import a reviewed plan**, select an existing project and paste Manifest v1 JSON:

```json
{
  "version": 1,
  "tasks": [
    {
      "tempId": "research",
      "title": "Review requirements",
      "descriptionMd": "Keep the original **Markdown**."
    },
    {
      "tempId": "implement",
      "title": "Implement the reviewed design",
      "dependsOn": ["research"]
    }
  ]
}
```

Validate and preview, inspect every task and dependency, then explicitly publish. Preview does not create tasks. Publishing only adds tasks; it never edits/deletes existing work or interprets Markdown checkboxes as formal tasks. Up to 100 tasks are supported per manifest. Optional `startDate` and `dueDate` use `YYYY-MM-DD`. Dependency references must name tasks in the same manifest and cannot form cycles.

If workspace work changes after preview, publication is rejected. Create a fresh preview and review it again. A repeated publication request cannot duplicate the same proposal's tasks.

## Recurring tasks

Open **Projects → Recurring tasks**. Set a title, first occurrence, IANA timezone (for example `Asia/Shanghai`), daily/weekly/monthly frequency and interval. Project membership is optional.

**Generate through today** processes a bounded calendar window (at most 366 days). It creates a task only for today's due occurrence; earlier dates become missed records instead of flooding the task list. Repeating generation does not duplicate occurrences. Monthly rules skip months without the selected day, rather than moving that occurrence to another date.

Backfill a missed occurrence explicitly when appropriate. An optional historical completion time is stored separately from the time the backfill was recorded. New occurrences retain their original rule snapshot, so later edits do not change historical backfills. Legacy occurrences without a snapshot still require the original definition version. Pause/restore affects the definition; it does not remove already generated tasks.

The server checks active accounts' recurring definitions at startup and every minute, without an open browser or login session. Each tick processes at most 366 calendar days per definition and transactionally saves its progress. Restarts and overlapping manual generation do not duplicate occurrences. Disabled creators are skipped. The server must remain running; mobile background execution is not provided. Full RRULE expressions are not supported.

## AI context permission

Notes and library entries default to **Deny / Local only / Private**. In the document editor, expand **AI data permission** to change these settings. Cloud proposals require an explicit permitted boundary; every run still requires review. Documents and their parent spaces must both allow processing. Approval cannot override Deny, Secret or a location restriction. Integration tokens cannot change these policies, and AI-produced edits preserve existing policy.

Each approved send obtains a durable reservation before contacting a provider. Unknown outcomes are never automatically retried. The run displays its input size, output limit and provider-reported token counters when available. Missing counters mean unknown; counters are not a billing invoice. Multi-provider fallback, a full provider registry and monetary budgets are not yet supported.

## Upgrade and recovery

These features require SQLite migrations 14–15 or PostgreSQL migrations 6–7. Follow the deployment and backup guide before upgrading. Database migrations do not mean PostgreSQL supports the complete hosted account subsystem. Independent SQLite pre-upgrade and post-upgrade backup restoration is covered by local tests; production deployment and native-device acceptance remain separate steps.
