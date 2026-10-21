# API credential authorization matrix

Both `/api` and `/api/v1` aliases use the normalized route. Granular credentials never fall back to the legacy allowlist. Null durable grants identify legacy credentials; explicit arrays must be nonempty and valid. Legacy credentials retain only their historical allowlist. Cookie writes additionally require CSRF. Unknown routes deny bearer access.

The table is generated from actual Host route literals and the shared route grants map. HUMAN means bearer denied regardless of grants, retaining existing human approval/private-owner boundaries. Login/health are pre-authentication routes; their own validation still applies.

| Route (both aliases) | Granular bearer required grants | Legacy profile | Trusted check |
|---|---|---|---|
| `/api/account/claim` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/account/password` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/account/sessions` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/account/sessions/revoke` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/activity` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/admin` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/admin/session-policy` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/admin/status` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/apply` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/capability` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/configuration` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/configuration/save` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/connections/models` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/connections/test` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/decide` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/events` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/events/stream` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/harness/decide` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/harness/stop` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/propose` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/providers` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/providers/remove` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/providers/save` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/run` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/sessions` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/sessions/create` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/sessions/messages` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/sessions/profile` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/sessions/promote` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/sessions/update` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/trusted-endpoints` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/ai/trusted-endpoints/save` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/backup` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/bootstrap` | workspace:read, tasks:read, projects:read, knowledge:read, files:read | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/categories/reorder` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/categories/save` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/document/body` | knowledge:read | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/document/note-backlinks` | knowledge:read | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/edge/create` | tasks:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/edge/delete` | tasks:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/files/binary/begin` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/files/binary/chunk` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/files/binary/complete` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/files/binary/status` | files:read | bearer denied | request + transaction recheck; Application scope/version checks |
| `/api/files/bytes` | files:read, files:content | bearer denied | request + transaction recheck; Application scope/version checks |
| `/api/files/delete` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/files/extraction` | files:read, files:content | bearer denied | request + transaction recheck; Application scope/version checks |
| `/api/files/metadata` | files:read | bearer denied | request + transaction recheck; Application scope/version checks |
| `/api/files/policy` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/files/register` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/files/rename` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/health` | Dedicated login/health contract | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/library` | knowledge:read | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/library/asset` | knowledge:read, files:content | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/library/delete` | knowledge:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/library/move` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/library/purge` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/library/rebuild-index` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/library/revisions` | knowledge:read | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/library/save` | knowledge:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/library/search` | knowledge:read | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/library/upload` | knowledge:write, files:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/library/upload-chunk` | knowledge:write, files:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/link/create` | knowledge:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/link/delete` | knowledge:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/logout` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/manual-orders/move` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/manual-orders/sequence` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/mcp` | capabilities:execute | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/memo` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/memo/save` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/note/delete` | knowledge:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/note/link-space` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/note/promote` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/note/purge` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/note/save` | knowledge:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/notes/search` | knowledge:read | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/openapi.json` | HUMAN / bearer denied | GET: read-write only | dedicated handler + default-deny bearer gate |
| `/api/organize` | tasks:write, projects:write, knowledge:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/plans/preview` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/plans/publish` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/projects/activity` | projects:read | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/projects/delete` | projects:write, knowledge:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/projects/document` | projects:write, knowledge:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/projects/document/create` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/projects/file` | projects:read, files:content | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/projects/link` | projects:write, knowledge:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/projects/space/create` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/projects/space/link` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/projects/space/unlink` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/projects/spaces` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/projects/upload` | projects:write, files:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/recurrences/backfill` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/recurrences/generate` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/recurrences/save` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/recurrences/skip` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/recurrences/task` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/register` | Dedicated login/health contract | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/reminders/save` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/revisions` | knowledge:read | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/session` | Dedicated login/health contract | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/snapshot` | workspace:read, tasks:read, projects:read, knowledge:read, files:read, files:content | GET: read-write only | request + transaction recheck; Application scope/version checks |
| `/api/sync` | HUMAN / bearer denied | GET: read-write only | dedicated handler + default-deny bearer gate |
| `/api/sync/receipt` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/tokens` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/tokens/create` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/tokens/revoke` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/work/calendar-settings` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/work/create` | tasks:write, projects:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/work/delete` | tasks:write, projects:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/work/navigation-move` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/work/navigation-preference` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/work/purge` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/work/update` | tasks:write, projects:write | POST: write/read-write | request + transaction recheck; Application scope/version checks |
| `/api/workspace-import/receipt` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/workspace/events` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/workspaces` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |
| `/api/workspaces/create` | HUMAN / bearer denied | bearer denied | dedicated handler + default-deny bearer gate |

MCP `tools/call` additionally requires CapabilityDefinition.requiredScopes inside the transaction. Special tools: workspace_snapshot requires capabilities:execute + workspace:read + tasks:read + projects:read + knowledge:read; plan_preview requires capabilities:execute + plans:propose + proposals:write; project_document_create requires capabilities:execute + projects:write + knowledge:write. Atlas/Memo approval and Apply remain human-only, with owner/content policy/version revalidation at approval and execution. Merely declaring a grant never grants a human-only route.

PostgreSQL v37 is a business-schema compatibility marker: this backend has no AccountStore/api_credential table. Credential persistence, legacy upgrade, revocation and restore are validated on the actual SQLite Host token store; PG fresh/upgrade and physical backup restore remain independently tested.
