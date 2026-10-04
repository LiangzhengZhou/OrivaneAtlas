CREATE TABLE arclattice.organization_activity (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id),
  id TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY(workspace_id,id)
);
CREATE TABLE arclattice.organization_outbox (
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type='ORGANIZATION_CHANGED'),
  PRIMARY KEY(workspace_id,event_id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES arclattice.organization_activity(workspace_id,id)
);
