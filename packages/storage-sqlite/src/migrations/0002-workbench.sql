CREATE TABLE request_receipt (
  workspace_id TEXT NOT NULL, principal_id TEXT NOT NULL, key TEXT NOT NULL,
  digest TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, principal_id, key),
  FOREIGN KEY (workspace_id, principal_id) REFERENCES workspace_principal(workspace_id, principal_id)
) STRICT;
CREATE TABLE notebook (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
  kind TEXT NOT NULL CHECK(kind IN ('NOTE','JOURNAL')), day TEXT, deleted_at TEXT, payload TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id), FOREIGN KEY (workspace_id) REFERENCES workspace(id)
) STRICT;
CREATE UNIQUE INDEX notebook_journal_day ON notebook(workspace_id, day) WHERE kind='JOURNAL' AND deleted_at IS NULL;
CREATE TABLE notebook_revision (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(workspace_id,id,version), FOREIGN KEY(workspace_id,id) REFERENCES notebook(workspace_id,id)
) STRICT;
CREATE TABLE notebook_activity (
  workspace_id TEXT NOT NULL, id TEXT NOT NULL, entity_id TEXT NOT NULL, principal_id TEXT NOT NULL,
  version INTEGER NOT NULL, occurred_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,principal_id) REFERENCES workspace_principal(workspace_id,principal_id)
) STRICT;
CREATE TABLE notebook_outbox (
  workspace_id TEXT NOT NULL, activity_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type='NOTE_CHANGED'),
  PRIMARY KEY(workspace_id,activity_id), FOREIGN KEY(workspace_id,activity_id) REFERENCES notebook_activity(workspace_id,id)
) STRICT;
