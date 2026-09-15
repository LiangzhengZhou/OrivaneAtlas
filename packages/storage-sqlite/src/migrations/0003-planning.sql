ALTER TABLE work_item ADD COLUMN project_id TEXT;
ALTER TABLE work_item ADD COLUMN start_date TEXT;
ALTER TABLE work_item ADD COLUMN due_date TEXT;
CREATE INDEX work_item_project ON work_item(workspace_id, project_id) WHERE deleted_at IS NULL;
