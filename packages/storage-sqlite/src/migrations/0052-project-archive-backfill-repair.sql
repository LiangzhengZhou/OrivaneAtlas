-- Migration 0050 sets archived_at from updated_at for legacy project archive flags.
-- The work_item trigger also emitted a workspace change at the unchanged version.
-- Repair that migration artifact before clients consume it: delete the
-- same-version delta and bump only rows that still carry the 0050 marker
-- (archived_at = updated_at). Manually repaired/new archive batches have a
-- different updated_at and are not touched.
CREATE TEMP TABLE project_archive_backfill_repair AS
SELECT w.id, w.version
FROM work_item w
WHERE w.type = 'PROJECT'
  AND w.archived_at IS NOT NULL
  AND w.archive_batch_json IS NULL
  AND w.archived_at = w.updated_at
  AND EXISTS (
    SELECT 1 FROM workspace_change c
    WHERE c.collection = 'items' AND c.entity_id = w.id
      AND c.version = w.version
  );
DELETE FROM workspace_change
WHERE collection = 'items'
  AND EXISTS (
    SELECT 1 FROM project_archive_backfill_repair r
    WHERE r.id = workspace_change.entity_id
      AND r.version = workspace_change.version
  );
UPDATE work_item
SET version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (SELECT id FROM project_archive_backfill_repair);
DROP TABLE project_archive_backfill_repair;
