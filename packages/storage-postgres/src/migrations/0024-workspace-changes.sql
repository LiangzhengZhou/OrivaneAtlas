CREATE TABLE arclattice.workspace_sync_state (id INTEGER PRIMARY KEY CHECK(id=1), epoch TEXT NOT NULL);
INSERT INTO arclattice.workspace_sync_state VALUES (1, md5(random()::text || clock_timestamp()::text));
CREATE TABLE arclattice.workspace_change (seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id TEXT NOT NULL,collection TEXT NOT NULL,entity_id TEXT NOT NULL,op TEXT NOT NULL CHECK(op IN ('UPSERT','DELETE')),version BIGINT NOT NULL CHECK(version>=0));
CREATE INDEX workspace_change_cursor ON arclattice.workspace_change(workspace_id,seq);
CREATE FUNCTION arclattice.record_workspace_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity JSONB; entity_key TEXT; parent_version BIGINT;
BEGIN
  IF TG_OP='DELETE' THEN entity=to_jsonb(OLD); ELSE entity=to_jsonb(NEW); END IF;
  IF TG_ARGV[0]='items-membership' THEN
    SELECT version INTO parent_version FROM arclattice.work_item WHERE workspace_id=entity->>'workspace_id' AND id=entity->>'task_id';
    IF parent_version IS NOT NULL THEN INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version) VALUES(entity->>'workspace_id','items',entity->>'task_id','UPSERT',parent_version); END IF;
  ELSIF TG_ARGV[0]='library-alias' THEN
    SELECT version INTO parent_version FROM arclattice.library_entry WHERE workspace_id=entity->>'workspace_id' AND id=entity->>'document_id';
    IF parent_version IS NOT NULL THEN INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version) VALUES(entity->>'workspace_id','library',entity->>'document_id','UPSERT',parent_version); END IF;
  ELSIF TG_ARGV[0]='materials-binding' THEN
    SELECT version INTO parent_version FROM arclattice.project_material WHERE workspace_id=entity->>'workspace_id' AND id=entity->>'id';
    IF parent_version IS NOT NULL THEN INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version) VALUES(entity->>'workspace_id','projectMaterials',entity->>'id','UPSERT',parent_version); END IF;
  ELSE
    entity_key=CASE WHEN TG_ARGV[0]='navigationPreference' THEN entity->>'principal_id' WHEN TG_ARGV[0]='calendarSettings' THEN 'workspace' WHEN TG_ARGV[0]='organization' THEN (entity->>'kind') || ':' || (entity->>'id') ELSE entity->>'id' END;
    INSERT INTO arclattice.workspace_change(workspace_id,collection,entity_id,op,version) VALUES(entity->>'workspace_id',TG_ARGV[0],entity_key,CASE WHEN TG_OP='DELETE' THEN 'DELETE' ELSE 'UPSERT' END,COALESCE((entity->>'version')::bigint,1));
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER sync_work_item AFTER INSERT OR UPDATE OR DELETE ON arclattice.work_item FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('items');
CREATE TRIGGER sync_work_edge AFTER INSERT OR UPDATE OR DELETE ON arclattice.work_edge FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('edges');
CREATE TRIGGER sync_notebook AFTER INSERT OR UPDATE OR DELETE ON arclattice.notebook FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('notes');
CREATE TRIGGER sync_knowledge_link AFTER INSERT OR UPDATE OR DELETE ON arclattice.knowledge_link FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('links');
CREATE TRIGGER sync_library_entry AFTER INSERT OR UPDATE OR DELETE ON arclattice.library_entry FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('library');
CREATE TRIGGER sync_organization AFTER INSERT OR UPDATE OR DELETE ON arclattice.organization FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('organization');
CREATE TRIGGER sync_project_category AFTER INSERT OR UPDATE OR DELETE ON arclattice.project_category FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('categories');
CREATE TRIGGER sync_workflow_record AFTER INSERT OR UPDATE OR DELETE ON arclattice.workflow_record FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('workflows');
CREATE TRIGGER sync_document_wiki_link AFTER INSERT OR UPDATE OR DELETE ON arclattice.document_wiki_link FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('wikiLinks');
CREATE TRIGGER sync_project_material AFTER INSERT OR UPDATE OR DELETE ON arclattice.project_material FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('projectMaterials');
CREATE TRIGGER sync_reminder AFTER INSERT OR UPDATE OR DELETE ON arclattice.reminder FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('reminders');
CREATE TRIGGER sync_user_navigation AFTER INSERT OR UPDATE OR DELETE ON arclattice.user_navigation FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('navigationPreference');
CREATE TRIGGER sync_workspace_calendar AFTER INSERT OR UPDATE OR DELETE ON arclattice.workspace_calendar FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('calendarSettings');
CREATE TRIGGER sync_task_project AFTER INSERT OR UPDATE OR DELETE ON arclattice.task_project FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('items-membership');
CREATE TRIGGER sync_project_knowledge_binding AFTER INSERT OR UPDATE OR DELETE ON arclattice.project_knowledge_binding FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('materials-binding');
CREATE TRIGGER sync_document_alias AFTER INSERT OR UPDATE OR DELETE ON arclattice.document_alias FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('library-alias');
CREATE TRIGGER sync_document_hierarchy AFTER INSERT OR UPDATE OR DELETE ON arclattice.document_hierarchy FOR EACH ROW EXECUTE FUNCTION arclattice.record_workspace_change('library-alias');
CREATE INDEX workspace_link_from ON arclattice.knowledge_link(workspace_id,(payload::jsonb->'from'->>'kind'),(payload::jsonb->'from'->>'id'));
CREATE INDEX workspace_link_to ON arclattice.knowledge_link(workspace_id,(payload::jsonb->'to'->>'kind'),(payload::jsonb->'to'->>'id'));
