CREATE TABLE project_category (
 workspace_id TEXT NOT NULL REFERENCES workspace(id), id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 240), version INTEGER NOT NULL CHECK(version > 0),
 created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES workspace_principal(workspace_id,principal_id),
 FOREIGN KEY(workspace_id,updated_by) REFERENCES workspace_principal(workspace_id,principal_id)
) STRICT;
CREATE TABLE project_category_member (
 workspace_id TEXT NOT NULL, category_id TEXT NOT NULL, project_id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0),
 PRIMARY KEY(workspace_id,category_id,project_id), UNIQUE(workspace_id,category_id,position),
 FOREIGN KEY(workspace_id,category_id) REFERENCES project_category(workspace_id,id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES work_item(workspace_id,id)
) STRICT;
CREATE TABLE category_activity (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, principal_id TEXT NOT NULL, category_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0), occurred_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,principal_id) REFERENCES workspace_principal(workspace_id,principal_id),
 FOREIGN KEY(workspace_id,category_id) REFERENCES project_category(workspace_id,id)
) STRICT;
CREATE TABLE category_outbox (
 workspace_id TEXT NOT NULL, activity_id TEXT NOT NULL, PRIMARY KEY(workspace_id,activity_id),
 FOREIGN KEY(workspace_id,activity_id) REFERENCES category_activity(workspace_id,id)
) STRICT;
