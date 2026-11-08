# Offline capability matrix

Status: 2026-11-06. This matrix describes the intended local-first behavior of
the current code. It is a governance document, not a claim that every path has
an end-to-end conflict UI.

Legend:

- **LOCAL+REPLAY**: writes locally, creates an outbox command, and replays to
  the Host with receipt/ACK handling.
- **LOCAL-ONLY**: writes the local replica but is not yet carried by the
  outbox protocol (or is a derived projection).
- **ONLINE**: intentionally requires the Host/account/network.
- **PROJECTION**: read-only/derived; rebuilt from an authoritative store.

| Capability | Offline behavior | Sync / replay | Notes |
| --- | --- | --- | --- |
| Create/update/delete task or project | LOCAL+REPLAY | work command + receipt | version/CAS required |
| Project lifecycle change | LOCAL+REPLAY | work update | project-specific validation |
| Project archive/recovery batch | LOCAL+REPLAY with required bodies cached | work update (`archived`) and exact multi-collection receipt | atomic owned-resource Trash batch; online hydration for missing bodies; no partial offline write |
| Task timer start/pause/stop | LOCAL+REPLAY | work update | timestamps derived from stored instants |
| Task dependencies / prerequisites | LOCAL+REPLAY | work update + graph effects | stale graph edits rejected |
| Note create/save | LOCAL+REPLAY | note command + body | body lazy availability |
| Note delete/restore | LOCAL+REPLAY | note command | soft delete, explicit purge |
| Note folder move | LOCAL+REPLAY | notebook/organize command | primary folder; legacy row compatibility |
| Library document/space save/delete | LOCAL+REPLAY | library command | soft delete |
| File upload and bytes | LOCAL+REPLAY | binary begin/chunk/complete/register | original bytes retained |
| Folder create/rename/move/delete | LOCAL+REPLAY | organization command | GENERAL/NOTE scope |
| Project material link/unlink/delete | LOCAL+REPLAY | project knowledge command | owned document delete is server-guarded |
| Project document create | LOCAL+REPLAY | project knowledge command | resolver selects/reuses PRIMARY space |
| FolderLink (note/document/file) | LOCAL+REPLAY | folderLinks collection | new PROJECT/SPACE writes rejected |
| SpaceFolderLink / ProjectFolderLink | LOCAL+REPLAY | dedicated command/effect collections | runtime records create/delete commands; replay request tests exist; full conflict UX audit remains separate |
| Note markdown wiki references | PROJECTION | rebuilt from Markdown | not a second authored relation |
| Project knowledge scope | PROJECTION | derived from ProjectMaterial | shared resolver |
| Trash list / restore | LOCAL+REPLAY | delete/restore commands | purge is separate |
| Import/merge review | LOCAL-ONLY workflow | no cross-device command contract | import files and review state stay local |
| AI conversation/settings | ONLINE for model calls; local transcript | account/provider vault | no credentials in local DB |
| Account workspace switching | ONLINE | account API | local replica scoped per workspace |
| Notifications | local + ONLINE for server-seeded events | notification store | read/snooze local |

## Rules

1. A new business write must choose LOCAL+REPLAY before it is treated as
   multi-device safe.
2. LOCAL-ONLY paths must be listed here and must not be described as
   "synchronized".
3. Replay effects and ACK canonical validation must be added together with the
   command; never add a write to one side only.
4. Conflict UI is required for commands that can fail CAS after reconnect.
5. Derived projections never become a second writable source.

## Known gaps

- FolderLink local creation outbox/replay coverage still needs a dedicated
  verification pass.
- Project archive/recovery now commits one batch; cached bodies are required offline.
- Legacy organization-based project archive clients need a compatibility review before deployment; the new UI uses work.update.
- Import/merge review is not a cross-device command protocol.
