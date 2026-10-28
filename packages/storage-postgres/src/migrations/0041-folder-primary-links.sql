-- ADR0147: staged 3.1.0 folder primary location and reusable folder links.
ALTER TABLE arclattice.notebook ADD COLUMN primary_folder_id TEXT;
UPDATE arclattice.notebook n SET primary_folder_id = (
  SELECT o.payload::jsonb->>'folderId'
  FROM arclattice.organization o
  WHERE o.workspace_id=n.workspace_id AND o.kind='NOTE' AND o.id=n.id
) WHERE n.primary_folder_id IS NULL AND EXISTS (
  SELECT 1 FROM arclattice.organization o
  WHERE o.workspace_id=n.workspace_id AND o.kind='NOTE' AND o.id=n.id
    AND NULLIF(o.payload::jsonb->>'folderId','') IS NOT NULL
);

ALTER TABLE arclattice.organization ADD COLUMN scope TEXT NOT NULL DEFAULT 'NOTE'
  CHECK(scope IN ('NOTE','GENERAL'));

CREATE TABLE arclattice.folder_link (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id),
  id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('NOTE','DOCUMENT','FILE','PROJECT','SPACE')),
  target_id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK(version>0 AND version<=9007199254740991),
  deleted_at TEXT,
  payload TEXT NOT NULL CHECK(jsonb_typeof(payload::jsonb)='object'),
  PRIMARY KEY(workspace_id,id)
);
CREATE UNIQUE INDEX folder_link_active_target
  ON arclattice.folder_link(workspace_id,folder_id,target_kind,target_id) WHERE deleted_at IS NULL;
CREATE INDEX folder_link_folder ON arclattice.folder_link(workspace_id,folder_id);
CREATE INDEX folder_link_target ON arclattice.folder_link(workspace_id,target_kind,target_id);

CREATE TABLE arclattice.space_folder_link (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id),
  id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK(version>0 AND version<=9007199254740991),
  deleted_at TEXT,
  payload TEXT NOT NULL CHECK(jsonb_typeof(payload::jsonb)='object'),
  PRIMARY KEY(workspace_id,id)
);
CREATE UNIQUE INDEX space_folder_link_active
  ON arclattice.space_folder_link(workspace_id,space_id,folder_id) WHERE deleted_at IS NULL;
CREATE INDEX space_folder_link_folder ON arclattice.space_folder_link(workspace_id,folder_id);

CREATE TABLE arclattice.project_folder_link (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id),
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK(version>0 AND version<=9007199254740991),
  deleted_at TEXT,
  payload TEXT NOT NULL CHECK(jsonb_typeof(payload::jsonb)='object'),
  PRIMARY KEY(workspace_id,id)
);
CREATE UNIQUE INDEX project_folder_link_active
  ON arclattice.project_folder_link(workspace_id,project_id,folder_id) WHERE deleted_at IS NULL;
CREATE INDEX project_folder_link_folder ON arclattice.project_folder_link(workspace_id,folder_id);

CREATE FUNCTION arclattice.capture_folder_link_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version)
    VALUES(OLD.workspace_id,'folderLinks',OLD.id,'DELETE',OLD.version);
    RETURN OLD;
  END IF;
  INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'folderLinks',NEW.id,'UPSERT',NEW.version);
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_folder_link AFTER INSERT OR UPDATE OR DELETE ON arclattice.folder_link
  FOR EACH ROW EXECUTE FUNCTION arclattice.capture_folder_link_change();

CREATE FUNCTION arclattice.capture_space_folder_link_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version)
    VALUES(OLD.workspace_id,'spaceFolderLinks',OLD.id,'DELETE',OLD.version);
    RETURN OLD;
  END IF;
  INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'spaceFolderLinks',NEW.id,'UPSERT',NEW.version);
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_space_folder_link AFTER INSERT OR UPDATE OR DELETE ON arclattice.space_folder_link
  FOR EACH ROW EXECUTE FUNCTION arclattice.capture_space_folder_link_change();

CREATE FUNCTION arclattice.capture_project_folder_link_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version)
    VALUES(OLD.workspace_id,'projectFolderLinks',OLD.id,'DELETE',OLD.version);
    RETURN OLD;
  END IF;
  INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'projectFolderLinks',NEW.id,'UPSERT',NEW.version);
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_project_folder_link AFTER INSERT OR UPDATE OR DELETE ON arclattice.project_folder_link
  FOR EACH ROW EXECUTE FUNCTION arclattice.capture_project_folder_link_change();
