-- Independent project archive marker; does not reuse lifecycle or deletedAt.
ALTER TABLE arclattice.work_item ADD COLUMN archived_at TEXT;
-- Preserve the legacy project archive before the new field becomes authoritative.
UPDATE arclattice.work_item w SET archived_at = w.updated_at
WHERE w.type = 'PROJECT' AND EXISTS (
  SELECT 1 FROM arclattice.organization o WHERE o.workspace_id = w.workspace_id
    AND o.kind = 'WORK' AND o.id = w.id
    AND (o.payload::jsonb ->> 'archived') = 'true'
);
CREATE INDEX work_item_archived ON arclattice.work_item(workspace_id, archived_at);
