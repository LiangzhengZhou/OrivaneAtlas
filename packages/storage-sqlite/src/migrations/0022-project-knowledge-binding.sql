CREATE TABLE project_knowledge_binding (
 workspace_id TEXT NOT NULL,
 id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 space_id TEXT NOT NULL,
 ownership TEXT NOT NULL CHECK(ownership IN ('OWNED','LINKED')),
 role TEXT NOT NULL CHECK(role IN ('PRIMARY','SUPPORTING','REFERENCE')),
 inherit_to_children INTEGER NOT NULL CHECK(inherit_to_children IN (0,1)),
 version INTEGER NOT NULL CHECK(version>0),
 created_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,id) REFERENCES project_material(workspace_id,id)
) STRICT;
INSERT INTO project_knowledge_binding
SELECT workspace_id, id, project_id, json_extract(payload,'$.targetId'),
 json_extract(payload,'$.ownership'),
 COALESCE(json_extract(payload,'$.role'), CASE json_extract(payload,'$.ownership') WHEN 'OWNED' THEN 'PRIMARY' ELSE 'REFERENCE' END),
 COALESCE(json_extract(payload,'$.inheritToChildren'),0), version,
 json_extract(payload,'$.updatedBy'), json_extract(payload,'$.updatedAt')
FROM project_material
WHERE json_extract(payload,'$.kind')='SPACE' AND json_extract(payload,'$.targetId') IS NOT NULL AND json_extract(payload,'$.deletedAt') IS NULL;
