CREATE TABLE workspace_owner (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspace(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  version BIGINT NOT NULL CHECK(version=1),
  created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id,principal_id) REFERENCES workspace_principal(workspace_id,principal_id)
);
CREATE INDEX workspace_owner_principal ON workspace_owner(principal_id,workspace_id);
