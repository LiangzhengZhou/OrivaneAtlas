SET search_path TO arclattice;
CREATE TABLE agent_run (
 workspace_id TEXT NOT NULL REFERENCES workspace(id), id TEXT NOT NULL,
 version BIGINT NOT NULL CHECK(version > 0 AND version <= 9007199254740991),
 payload TEXT NOT NULL CHECK(jsonb_typeof(payload::jsonb) = 'object'),
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE connected_activity (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, entity_id TEXT NOT NULL,
 principal_id TEXT NOT NULL, type TEXT NOT NULL,
 version BIGINT NOT NULL CHECK(version > 0), occurred_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,principal_id) REFERENCES workspace_principal(workspace_id,principal_id)
);
CREATE TABLE connected_outbox (
 workspace_id TEXT NOT NULL, activity_id TEXT NOT NULL, type TEXT NOT NULL,
 PRIMARY KEY(workspace_id,activity_id),
 FOREIGN KEY(workspace_id,activity_id) REFERENCES connected_activity(workspace_id,id)
);
