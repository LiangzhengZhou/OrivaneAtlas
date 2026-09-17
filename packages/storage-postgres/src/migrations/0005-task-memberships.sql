CREATE TABLE arclattice.task_project (
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (workspace_id, task_id, project_id),
  UNIQUE (workspace_id, task_id, position),
  FOREIGN KEY (workspace_id, task_id) REFERENCES arclattice.work_item(workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES arclattice.work_item(workspace_id, id)
);
CREATE INDEX task_project_by_project ON arclattice.task_project(workspace_id, project_id);
INSERT INTO arclattice.task_project SELECT workspace_id,id,project_id,0 FROM arclattice.work_item WHERE type = 'TASK' AND project_id IS NOT NULL;
