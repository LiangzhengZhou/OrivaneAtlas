CREATE TABLE arclattice.wiki_index_state (
 workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES arclattice.workspace(id),
 index_version INTEGER NOT NULL CHECK(index_version>=0),
 dirty INTEGER NOT NULL CHECK(dirty IN (0,1))
);
INSERT INTO arclattice.wiki_index_state SELECT id,0,1 FROM arclattice.workspace;
CREATE FUNCTION arclattice.mark_wiki_index_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_workspace TEXT;
BEGIN
 IF TG_OP='DELETE' THEN affected_workspace=OLD.workspace_id; ELSE affected_workspace=NEW.workspace_id; END IF;
 INSERT INTO arclattice.wiki_index_state VALUES (affected_workspace,0,1) ON CONFLICT(workspace_id) DO UPDATE SET dirty=1;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER wiki_index_dirty AFTER INSERT OR UPDATE OR DELETE ON arclattice.library_entry FOR EACH ROW EXECUTE FUNCTION arclattice.mark_wiki_index_dirty();
CREATE TRIGGER wiki_alias_dirty AFTER INSERT OR UPDATE OR DELETE ON arclattice.document_alias FOR EACH ROW EXECUTE FUNCTION arclattice.mark_wiki_index_dirty();
