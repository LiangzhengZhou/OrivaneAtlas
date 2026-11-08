-- Independent project archive marker; does not reuse lifecycle or deletedAt.
ALTER TABLE work_item ADD COLUMN archived_at TEXT;
-- Preserve the legacy project archive before the new field becomes authoritative.
UPDATE work_item SET archived_at = updated_at
WHERE type = 'PROJECT' AND EXISTS (
  SELECT 1 FROM organization o WHERE o.workspace_id = work_item.workspace_id
    AND o.kind = 'WORK' AND o.id = work_item.id
    AND json_extract(o.payload, '$.archived') = 1
);
CREATE INDEX work_item_archived ON work_item(workspace_id, archived_at);
