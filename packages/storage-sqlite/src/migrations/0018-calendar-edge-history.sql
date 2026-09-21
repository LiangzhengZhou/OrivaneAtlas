CREATE TABLE workspace_calendar (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id),
  version INTEGER NOT NULL CHECK(version > 0 AND version <= 9007199254740991),
  timezone TEXT
) STRICT;
CREATE TABLE activity_next (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL CHECK(length(id) > 0),
  principal_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('WORK_ITEM_CREATED','WORK_ITEM_UPDATED','WORK_ITEM_DELETED','WORK_ITEM_RESTORED','WORK_EDGE_ADDED','WORK_EDGE_REMOVED','WORKSPACE_SETTINGS_UPDATED')),
  occurred_at TEXT NOT NULL,
  from_id TEXT,
  to_id TEXT,
  edge_type TEXT,
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,principal_id) REFERENCES workspace_principal(workspace_id,principal_id)
) STRICT;
INSERT INTO activity_next (workspace_id,id,principal_id,entity_id,type,occurred_at)
SELECT workspace_id,id,principal_id,entity_id,type,occurred_at FROM activity;
CREATE TABLE outbox_next (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL CHECK(length(id) > 0),
  activity_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type = 'WORK_CHANGED'),
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,activity_id) REFERENCES activity_next(workspace_id,id)
) STRICT;
INSERT INTO outbox_next SELECT * FROM outbox;
DROP TABLE outbox;
DROP TABLE activity;
ALTER TABLE activity_next RENAME TO activity;
ALTER TABLE outbox_next RENAME TO outbox;
