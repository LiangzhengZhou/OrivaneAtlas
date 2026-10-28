-- ADR0147: staged 3.1.0 folder primary location and reusable folder links.
-- This migration is additive: older application code keeps working while the
-- note primary location is backfilled from the legacy organization NOTE row.
ALTER TABLE notebook ADD COLUMN primary_folder_id TEXT;
UPDATE notebook SET primary_folder_id = (
  SELECT json_extract(o.payload,'$.folderId')
  FROM organization o
  WHERE o.workspace_id=notebook.workspace_id AND o.kind='NOTE' AND o.id=notebook.id
) WHERE primary_folder_id IS NULL AND EXISTS (
  SELECT 1 FROM organization o
  WHERE o.workspace_id=notebook.workspace_id AND o.kind='NOTE' AND o.id=notebook.id
    AND json_extract(o.payload,'$.folderId') IS NOT NULL
    AND json_extract(o.payload,'$.folderId') <> ''
);

ALTER TABLE organization ADD COLUMN scope TEXT NOT NULL DEFAULT 'NOTE'
  CHECK(scope IN ('NOTE','GENERAL'));

CREATE TABLE folder_link (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('NOTE','DOCUMENT','FILE','PROJECT','SPACE')),
  target_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  deleted_at TEXT,
  payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload)='object'),
  PRIMARY KEY(workspace_id,id)
) STRICT;
CREATE UNIQUE INDEX folder_link_active_target
  ON folder_link(workspace_id,folder_id,target_kind,target_id) WHERE deleted_at IS NULL;
CREATE INDEX folder_link_folder ON folder_link(workspace_id,folder_id);
CREATE INDEX folder_link_target ON folder_link(workspace_id,target_kind,target_id);

CREATE TABLE space_folder_link (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  deleted_at TEXT,
  payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload)='object'),
  PRIMARY KEY(workspace_id,id)
) STRICT;
CREATE UNIQUE INDEX space_folder_link_active
  ON space_folder_link(workspace_id,space_id,folder_id) WHERE deleted_at IS NULL;
CREATE INDEX space_folder_link_folder ON space_folder_link(workspace_id,folder_id);

CREATE TABLE project_folder_link (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  deleted_at TEXT,
  payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload)='object'),
  PRIMARY KEY(workspace_id,id)
) STRICT;
CREATE UNIQUE INDEX project_folder_link_active
  ON project_folder_link(workspace_id,project_id,folder_id) WHERE deleted_at IS NULL;
CREATE INDEX project_folder_link_folder ON project_folder_link(workspace_id,folder_id);

CREATE TRIGGER sync_folder_link_insert AFTER INSERT ON folder_link BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'folderLinks',NEW.id,'UPSERT',NEW.version);
END;
CREATE TRIGGER sync_folder_link_update AFTER UPDATE ON folder_link BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'folderLinks',NEW.id,'UPSERT',NEW.version);
END;
CREATE TRIGGER sync_folder_link_delete AFTER DELETE ON folder_link BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(OLD.workspace_id,'folderLinks',OLD.id,'DELETE',OLD.version);
END;

CREATE TRIGGER sync_space_folder_link_insert AFTER INSERT ON space_folder_link BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'spaceFolderLinks',NEW.id,'UPSERT',NEW.version);
END;
CREATE TRIGGER sync_space_folder_link_update AFTER UPDATE ON space_folder_link BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'spaceFolderLinks',NEW.id,'UPSERT',NEW.version);
END;
CREATE TRIGGER sync_space_folder_link_delete AFTER DELETE ON space_folder_link BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(OLD.workspace_id,'spaceFolderLinks',OLD.id,'DELETE',OLD.version);
END;

CREATE TRIGGER sync_project_folder_link_insert AFTER INSERT ON project_folder_link BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'projectFolderLinks',NEW.id,'UPSERT',NEW.version);
END;
CREATE TRIGGER sync_project_folder_link_update AFTER UPDATE ON project_folder_link BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'projectFolderLinks',NEW.id,'UPSERT',NEW.version);
END;
CREATE TRIGGER sync_project_folder_link_delete AFTER DELETE ON project_folder_link BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(OLD.workspace_id,'projectFolderLinks',OLD.id,'DELETE',OLD.version);
END;
