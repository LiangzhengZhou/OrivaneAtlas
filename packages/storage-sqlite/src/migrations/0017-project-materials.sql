CREATE TABLE project_material (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), payload TEXT NOT NULL, content TEXT,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES work_item(workspace_id,id)
) STRICT;
CREATE TABLE project_material_activity (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL,
 material_id TEXT NOT NULL, principal_id TEXT NOT NULL, type TEXT NOT NULL, occurred_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,material_id) REFERENCES project_material(workspace_id,id),
 FOREIGN KEY(workspace_id,principal_id) REFERENCES workspace_principal(workspace_id,principal_id)
) STRICT;
CREATE TABLE project_material_outbox (
 workspace_id TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(workspace_id,event_id),
 FOREIGN KEY(workspace_id,event_id) REFERENCES project_material_activity(workspace_id,id)
) STRICT;
