CREATE TABLE knowledge_link (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id) REFERENCES workspace(id)
) STRICT;
CREATE TABLE agent_run (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id) REFERENCES workspace(id)
) STRICT;
CREATE TABLE connected_activity (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, entity_id TEXT NOT NULL,
  principal_id TEXT NOT NULL, type TEXT NOT NULL, version INTEGER NOT NULL, occurred_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,principal_id) REFERENCES workspace_principal(workspace_id,principal_id)
) STRICT;
CREATE TABLE connected_outbox (
  workspace_id TEXT NOT NULL, activity_id TEXT NOT NULL, type TEXT NOT NULL,
  PRIMARY KEY(workspace_id,activity_id), FOREIGN KEY(workspace_id,activity_id) REFERENCES connected_activity(workspace_id,id)
) STRICT;
CREATE TABLE audit_record (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, principal_id TEXT NOT NULL,
  entity_id TEXT NOT NULL, action TEXT NOT NULL, occurred_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,principal_id) REFERENCES workspace_principal(workspace_id,principal_id)
) STRICT;
