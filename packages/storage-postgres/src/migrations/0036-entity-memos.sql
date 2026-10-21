ALTER TABLE arclattice.workspace_change ADD COLUMN owner_principal_id TEXT;
CREATE TABLE arclattice.entity_memo (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('PROJECT','TASK','MILESTONE','FILE')),
  target_id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK(version>0 AND version<=9007199254740991),
  payload TEXT NOT NULL CHECK(jsonb_typeof(payload::jsonb)='object' AND payload::jsonb ?& ARRAY['workspaceId','id','ownerPrincipalId','targetKind','targetId','version','bodyMd']),
  PRIMARY KEY(workspace_id,id),
  UNIQUE(workspace_id,owner_principal_id,target_kind,target_id),
  FOREIGN KEY(workspace_id,owner_principal_id) REFERENCES arclattice.workspace_principal(workspace_id,principal_id),
  CHECK((payload::jsonb->>'workspaceId') IS NOT DISTINCT FROM workspace_id AND (payload::jsonb->>'id') IS NOT DISTINCT FROM id AND (payload::jsonb->>'ownerPrincipalId') IS NOT DISTINCT FROM owner_principal_id AND (payload::jsonb->>'targetKind') IS NOT DISTINCT FROM target_kind AND (payload::jsonb->>'targetId') IS NOT DISTINCT FROM target_id AND (payload::jsonb->>'version')::bigint IS NOT DISTINCT FROM version),
  CHECK(jsonb_typeof(payload::jsonb->'bodyMd')='string' AND length(payload::jsonb->>'bodyMd')<=100000)
);
CREATE TABLE arclattice.entity_memo_activity (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id),
  id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(payload::jsonb IS NOT NULL),
  PRIMARY KEY(workspace_id,id)
);
CREATE TABLE arclattice.entity_memo_outbox (
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY(workspace_id,event_id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES arclattice.entity_memo_activity(workspace_id,id)
);
CREATE FUNCTION arclattice.capture_entity_memo_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version,owner_principal_id)
    VALUES(OLD.workspace_id,'entityMemos',OLD.id,'DELETE',OLD.version,OLD.owner_principal_id);
    RETURN OLD;
  END IF;
  INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version,owner_principal_id)
  VALUES(NEW.workspace_id,'entityMemos',NEW.id,'UPSERT',NEW.version,NEW.owner_principal_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_entity_memo AFTER INSERT OR UPDATE OR DELETE ON arclattice.entity_memo FOR EACH ROW EXECUTE FUNCTION arclattice.capture_entity_memo_change();
