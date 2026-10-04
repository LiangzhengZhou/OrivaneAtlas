CREATE TABLE arclattice.reminder (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id),
  id TEXT NOT NULL, version BIGINT NOT NULL CHECK(version>0), day TEXT NOT NULL,
  payload JSONB NOT NULL, PRIMARY KEY(workspace_id,id)
);
CREATE INDEX reminder_day ON arclattice.reminder(workspace_id,day);
CREATE TABLE arclattice.reminder_activity (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id), id TEXT NOT NULL,
  payload JSONB NOT NULL, PRIMARY KEY(workspace_id,id)
);
CREATE TABLE arclattice.reminder_outbox (
  workspace_id TEXT NOT NULL, event_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type='REMINDER_CHANGED'), PRIMARY KEY(workspace_id,event_id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES arclattice.reminder_activity(workspace_id,id)
);
