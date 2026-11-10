-- See SQLite migration 0052. Only repair rows that still carry the 0050
-- marker (archived_at = updated_at), not manually repaired/new archive batches.
CREATE TEMP TABLE project_archive_backfill_repair ON COMMIT DROP AS
SELECT w.id, w.version
FROM arclattice.work_item w
WHERE w.type = 'PROJECT'
  AND w.archived_at IS NOT NULL
  AND w.archive_batch_json IS NULL
  AND w.archived_at = w.updated_at
  AND EXISTS (
    SELECT 1 FROM arclattice.workspace_change c
    WHERE c.collection = 'items' AND c.entity_id = w.id
      AND c.version = w.version
  );
DELETE FROM arclattice.workspace_change c
USING project_archive_backfill_repair r
WHERE c.collection = 'items' AND c.entity_id = r.id AND c.version = r.version;
UPDATE arclattice.work_item w
SET version = w.version + 1,
    updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE w.id IN (SELECT id FROM project_archive_backfill_repair);
