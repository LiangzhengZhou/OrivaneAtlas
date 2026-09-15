CREATE TABLE organization (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  kind TEXT NOT NULL CHECK(kind IN ('WORK','NOTE')),
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,kind,id)
);
CREATE TABLE organization_activity (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,id)
);
CREATE TABLE organization_outbox (
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type='ORGANIZATION_CHANGED'),
  PRIMARY KEY(workspace_id,event_id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES organization_activity(workspace_id,id)
);
