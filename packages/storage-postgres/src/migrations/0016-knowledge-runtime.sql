CREATE TABLE arclattice.library_revision (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, version BIGINT NOT NULL CHECK(version>0), payload TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id,version), FOREIGN KEY(workspace_id,id) REFERENCES arclattice.library_entry(workspace_id,id)
);
CREATE TABLE arclattice.library_asset (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, space_id TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, base64 TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,space_id) REFERENCES arclattice.library_entry(workspace_id,id)
);
CREATE TABLE arclattice.project_material (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL, version BIGINT NOT NULL CHECK(version>0), payload TEXT NOT NULL, content TEXT,
 PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,project_id) REFERENCES arclattice.work_item(workspace_id,id)
);
INSERT INTO arclattice.project_material (workspace_id,id,project_id,version,payload)
SELECT b.workspace_id,b.id,b.project_id,b.version,
 jsonb_build_object('id',b.id,'workspaceId',b.workspace_id,'projectId',b.project_id,
 'kind','SPACE','ownership',b.ownership,'targetId',b.space_id,
 'title',s.payload::jsonb->>'title','mime',NULL,'size',0,'version',b.version,
 'updatedBy',b.created_by,'updatedAt',b.updated_at,'deletedAt',NULL,
 'role',b.role,'inheritToChildren',b.inherit_to_children)::text
FROM arclattice.project_knowledge_binding b
JOIN arclattice.work_item p ON p.workspace_id=b.workspace_id AND p.id=b.project_id AND p.type='PROJECT'
JOIN arclattice.library_entry s ON s.workspace_id=b.workspace_id AND s.id=b.space_id
WHERE s.payload::jsonb->>'kind'='SPACE';
CREATE TABLE arclattice.knowledge_activity (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, entity_id TEXT NOT NULL, principal_id TEXT NOT NULL, type TEXT NOT NULL, version BIGINT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE arclattice.knowledge_outbox (
 workspace_id TEXT NOT NULL, activity_id TEXT NOT NULL, type TEXT NOT NULL,
 PRIMARY KEY(workspace_id,activity_id), FOREIGN KEY(workspace_id,activity_id) REFERENCES arclattice.knowledge_activity(workspace_id,id)
);
CREATE TABLE arclattice.project_material_activity (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL, material_id TEXT NOT NULL, principal_id TEXT NOT NULL, type TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE arclattice.project_material_outbox (
 workspace_id TEXT NOT NULL, activity_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,activity_id), FOREIGN KEY(workspace_id,activity_id) REFERENCES arclattice.project_material_activity(workspace_id,id)
);
CREATE TABLE arclattice.library_asset_upload (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, principal_id TEXT NOT NULL, space_id TEXT, name TEXT NOT NULL, mime TEXT NOT NULL,
 next_index INTEGER NOT NULL, complete BOOLEAN NOT NULL, updated_at BIGINT NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE arclattice.library_asset_chunk (
 workspace_id TEXT NOT NULL, upload_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, base64 TEXT NOT NULL,
 PRIMARY KEY(workspace_id,upload_id,chunk_index), FOREIGN KEY(workspace_id,upload_id) REFERENCES arclattice.library_asset_upload(workspace_id,id) ON DELETE CASCADE
);
