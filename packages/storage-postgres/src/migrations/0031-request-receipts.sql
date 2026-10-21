CREATE TABLE request_receipt (
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  key TEXT NOT NULL,
  digest TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  device_id TEXT CHECK(device_id IS NULL OR length(device_id) > 0),
  PRIMARY KEY(workspace_id, principal_id, key),
  FOREIGN KEY(workspace_id, principal_id) REFERENCES workspace_principal(workspace_id, principal_id)
);
