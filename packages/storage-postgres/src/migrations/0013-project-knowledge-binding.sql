CREATE TABLE arclattice.project_knowledge_binding (
 workspace_id TEXT NOT NULL,
 id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 space_id TEXT NOT NULL,
 ownership TEXT NOT NULL CHECK(ownership IN ('OWNED','LINKED')),
 role TEXT NOT NULL CHECK(role IN ('PRIMARY','SUPPORTING','REFERENCE')),
 inherit_to_children BOOLEAN NOT NULL DEFAULT FALSE,
 version BIGINT NOT NULL CHECK(version>0),
 created_by TEXT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE INDEX project_knowledge_binding_project ON arclattice.project_knowledge_binding(workspace_id,project_id);
