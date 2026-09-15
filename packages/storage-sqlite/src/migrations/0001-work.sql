CREATE TABLE workspace (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0)
) STRICT;
CREATE TABLE principal (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
  kind TEXT NOT NULL CHECK(kind IN ('USER','AGENT','SERVICE')),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) > 0)
) STRICT;
CREATE TABLE workspace_principal (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  principal_id TEXT NOT NULL REFERENCES principal(id),
  PRIMARY KEY (workspace_id, principal_id)
) STRICT;
CREATE TABLE work_item (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL CHECK(length(id) > 0),
  type TEXT NOT NULL CHECK(type IN ('GOAL','PROJECT','EPIC','TASK','MILESTONE','DECISION','AI_JOB','REMINDER')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 240),
  description_md TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('TODO','IN_PROGRESS','DONE','CANCELED')),
  priority TEXT NOT NULL CHECK(priority IN ('LOW','MEDIUM','HIGH','URGENT')),
  execution_mode TEXT NOT NULL CHECK(execution_mode IN ('MANUAL','AI','AUTOMATIC','HYBRID')),
  assignee_principal_id TEXT,
  version INTEGER NOT NULL CHECK(version > 0 AND version <= 9007199254740991),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  deleted_at TEXT,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, created_by) REFERENCES workspace_principal(workspace_id, principal_id),
  FOREIGN KEY (workspace_id, updated_by) REFERENCES workspace_principal(workspace_id, principal_id),
  FOREIGN KEY (workspace_id, assignee_principal_id) REFERENCES workspace_principal(workspace_id, principal_id)
) STRICT;
CREATE INDEX work_item_active ON work_item(workspace_id, deleted_at, status);
CREATE TABLE work_edge (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL CHECK(length(id) > 0),
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('BLOCKS','REQUIRES','CONTAINS','RELATED','PRODUCES','DERIVED_FROM')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, from_id, to_id, type),
  CHECK(from_id <> to_id),
  FOREIGN KEY (workspace_id, from_id) REFERENCES work_item(workspace_id, id),
  FOREIGN KEY (workspace_id, to_id) REFERENCES work_item(workspace_id, id),
  FOREIGN KEY (workspace_id, created_by) REFERENCES workspace_principal(workspace_id, principal_id)
) STRICT;
CREATE UNIQUE INDEX work_edge_dependency ON work_edge(
  workspace_id,
  CASE type WHEN 'BLOCKS' THEN from_id ELSE to_id END,
  CASE type WHEN 'BLOCKS' THEN to_id ELSE from_id END
) WHERE type IN ('BLOCKS','REQUIRES');
CREATE INDEX work_edge_target ON work_edge(workspace_id, to_id);
CREATE TABLE activity (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL CHECK(length(id) > 0),
  principal_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('WORK_ITEM_CREATED','WORK_ITEM_UPDATED','WORK_ITEM_DELETED','WORK_ITEM_RESTORED','WORK_EDGE_ADDED','WORK_EDGE_REMOVED')),
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, principal_id) REFERENCES workspace_principal(workspace_id, principal_id)
) STRICT;
CREATE TABLE outbox (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL CHECK(length(id) > 0),
  activity_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type = 'WORK_CHANGED'),
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, activity_id) REFERENCES activity(workspace_id, id)
) STRICT;
