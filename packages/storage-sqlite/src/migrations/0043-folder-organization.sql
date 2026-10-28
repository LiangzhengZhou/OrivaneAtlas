-- ADR0138: organization.kind gains FOLDER for stable note folders.
-- SQLite cannot alter a CHECK constraint in place, so rebuild the table and
-- recreate the workspace-change triggers that migration 0030 attached to it.
CREATE TABLE organization_next (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  kind TEXT NOT NULL CHECK(kind IN ('WORK','NOTE','FOLDER')),
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,kind,id)
);
INSERT INTO organization_next (workspace_id,kind,id,version,payload)
  SELECT workspace_id,kind,id,version,payload FROM organization;
DROP TABLE organization;
ALTER TABLE organization_next RENAME TO organization;
CREATE TRIGGER sync_organization_insert AFTER INSERT ON organization BEGIN INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version) VALUES (NEW.workspace_id,'organization',NEW.kind || ':' || NEW.id,'UPSERT',NEW.version); END;
CREATE TRIGGER sync_organization_update AFTER UPDATE ON organization BEGIN INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version) VALUES (NEW.workspace_id,'organization',NEW.kind || ':' || NEW.id,'UPSERT',NEW.version); END;
CREATE TRIGGER sync_organization_delete AFTER DELETE ON organization BEGIN INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version) VALUES (OLD.workspace_id,'organization',OLD.kind || ':' || OLD.id,'DELETE',OLD.version); END;
