CREATE TABLE reminder (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  day TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,id)
);
CREATE INDEX reminder_day ON reminder(workspace_id,day);
CREATE TABLE reminder_activity (
  workspace_id TEXT NOT NULL REFERENCES workspace(id), id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(workspace_id,id)
);
CREATE TABLE reminder_outbox (
  workspace_id TEXT NOT NULL, event_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type='REMINDER_CHANGED'), PRIMARY KEY(workspace_id,event_id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES reminder_activity(workspace_id,id)
);
