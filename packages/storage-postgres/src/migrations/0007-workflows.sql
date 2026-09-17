CREATE TABLE arclattice.workflow_record (
 workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id), id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('PLAN','RECURRENCE','OCCURRENCE')),
 version INTEGER NOT NULL CHECK(version>0), created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, payload TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES arclattice.workspace_principal(workspace_id,principal_id),
 FOREIGN KEY(workspace_id,updated_by) REFERENCES arclattice.workspace_principal(workspace_id,principal_id)
);
CREATE TABLE arclattice.workflow_activity (
 workspace_id TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL, principal_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,record_id,version),
 FOREIGN KEY(workspace_id,record_id) REFERENCES arclattice.workflow_record(workspace_id,id),
 FOREIGN KEY(workspace_id,principal_id) REFERENCES arclattice.workspace_principal(workspace_id,principal_id)
);
CREATE TABLE arclattice.workflow_outbox (
 workspace_id TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,record_id,version),
 FOREIGN KEY(workspace_id,record_id,version) REFERENCES arclattice.workflow_activity(workspace_id,record_id,version)
);
