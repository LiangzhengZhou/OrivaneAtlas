CREATE TABLE arclattice.agent_session (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, principal_id TEXT NOT NULL, version BIGINT NOT NULL CHECK(version>0), payload TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,principal_id) REFERENCES arclattice.workspace_principal(workspace_id,principal_id)
);
