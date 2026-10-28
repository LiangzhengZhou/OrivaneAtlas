# ADR0146 — Folder recovery and direct workspace resource browsing

2026-10-27. Implemented; integration acceptance in progress.

Folder recovery reuses organization.apply action unarchive for FOLDER. It accepts the deleted row's current version, retains its id/name/icon/parentId, requires an active original parent, and saves archived=false in the existing transaction with Outbox and receipt replay. Other folder operations continue to target active rows. No schema change or alternate mutation path. UI lists deleted folders with explicit recovery actions.

The Files route now includes actual DOCUMENT and FILE snapshot metadata, supports title/location filtering and name/update sorting, and opens original entities through existing navigation. Upload uses runtime.uploadFile with workspace-root placement and opens FileDetail. It does not hydrate bodies for listing. Note folder membership remains separate from existing Document/Space and File parent relationships; this is not a migration of all resource types into Note folders.

Validation: restore identity/version unit case plus existing folder browser lifecycle extended with recovery. Resource browser uses real document creation, original file upload and restart persistence. No production operations.