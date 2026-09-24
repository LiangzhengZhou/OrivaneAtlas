INSERT INTO task_project (workspace_id, task_id, project_id, position)
SELECT w.workspace_id, w.id, w.project_id,
  COALESCE((SELECT MAX(position) + 1 FROM task_project t WHERE t.workspace_id=w.workspace_id AND t.task_id=w.id), 0)
FROM work_item w WHERE w.type='TASK' AND w.project_id IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM task_project t WHERE t.workspace_id=w.workspace_id AND t.task_id=w.id AND t.project_id=w.project_id);
UPDATE work_item SET project_id=NULL WHERE type='TASK';
ALTER TABLE work_item RENAME COLUMN project_id TO parent_project_id;
ALTER TABLE work_item ADD COLUMN lifecycle TEXT CHECK(lifecycle IN ('PLANNED','ACTIVE','PAUSED','COMPLETED','CANCELED'));
ALTER TABLE work_item ADD COLUMN category_id TEXT;
UPDATE work_item SET lifecycle=CASE status WHEN 'DONE' THEN 'COMPLETED' WHEN 'CANCELED' THEN 'CANCELED' WHEN 'IN_PROGRESS' THEN CASE activation_state WHEN 'INACTIVE' THEN 'PAUSED' ELSE 'ACTIVE' END ELSE 'PLANNED' END WHERE type='PROJECT';
UPDATE work_item SET category_id=(SELECT m.category_id FROM project_category_member m JOIN project_category c ON c.workspace_id=m.workspace_id AND c.id=m.category_id WHERE m.workspace_id=work_item.workspace_id AND m.project_id=work_item.id AND c.deleted_at IS NULL ORDER BY c.position,c.id LIMIT 1) WHERE type='PROJECT';
DROP TABLE project_category_member;
