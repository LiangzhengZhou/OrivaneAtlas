# Orivane Atlas 3.1.7 — project document delete and sync recovery

3.1.7 fixes two issues reported after 3.1.6.

## Fixes

- Project document rows no longer show a false "Moved to Trash" toast when the
  delete command fails. The menu action now reports failure and leaves the row
  visible.
- Offline/body-unavailable project document deletion now removes the project
  material and the document metadata tombstone without loading Markdown body.
  Markdown bytes are not rewritten and are hydrated after reconnect.
- A migration repair removes the 3.1.6 same-version workspace-change artifact
  created when legacy project archive flags were backfilled. This prevents
  clients from failing the whole sync with VERSION_CONFLICT.
- Existing manual repair rows are left untouched by the new migration.

## Compatibility

- SQLite schema 52 / PostgreSQL 47 (additive repair migration).
- Windows and Android signatures/versioning follow the 3.1.7 release.
- Production sync data and local drafts remain intact.

## Validation

- `pnpm check` and the full Playwright suite are run before publication.
