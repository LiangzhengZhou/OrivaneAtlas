ALTER TABLE workspace_change ADD COLUMN owner_principal_id TEXT;
CREATE TABLE entity_memo (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('PROJECT','TASK','MILESTONE','FILE')),
  target_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0 AND version<=9007199254740991),
  payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload)='object'),
  PRIMARY KEY(workspace_id,id),
  UNIQUE(workspace_id,owner_principal_id,target_kind,target_id),
  FOREIGN KEY(workspace_id,owner_principal_id) REFERENCES workspace_principal(workspace_id,principal_id),
  CHECK(json_extract(payload,'$.workspaceId') IS workspace_id AND json_extract(payload,'$.id') IS id AND json_extract(payload,'$.ownerPrincipalId') IS owner_principal_id AND json_extract(payload,'$.targetKind') IS target_kind AND json_extract(payload,'$.targetId') IS target_id AND json_extract(payload,'$.version') IS version),
  CHECK(json_type(payload,'$.bodyMd') IS 'text' AND length(json_extract(payload,'$.bodyMd'))<=100000)
) STRICT;
CREATE TABLE entity_memo_activity (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,id)
) STRICT;
CREATE TABLE entity_memo_outbox (
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY(workspace_id,event_id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES entity_memo_activity(workspace_id,id)
) STRICT;
CREATE TRIGGER sync_entity_memo_insert AFTER INSERT ON entity_memo BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version,owner_principal_id)
  VALUES(NEW.workspace_id,'entityMemos',NEW.id,'UPSERT',NEW.version,NEW.owner_principal_id);
END;
CREATE TRIGGER sync_entity_memo_update AFTER UPDATE ON entity_memo BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version,owner_principal_id)
  VALUES(NEW.workspace_id,'entityMemos',NEW.id,'UPSERT',NEW.version,NEW.owner_principal_id);
END;
CREATE TRIGGER sync_entity_memo_delete AFTER DELETE ON entity_memo BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version,owner_principal_id)
  VALUES(OLD.workspace_id,'entityMemos',OLD.id,'DELETE',OLD.version,OLD.owner_principal_id);
END;
