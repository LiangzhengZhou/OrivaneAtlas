CREATE TABLE wiki_index_state (
 workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspace(id),
 index_version INTEGER NOT NULL CHECK(index_version>=0),
 dirty INTEGER NOT NULL CHECK(dirty IN (0,1))
) STRICT;
INSERT INTO wiki_index_state SELECT id,0,1 FROM workspace;
CREATE TRIGGER wiki_index_dirty_insert AFTER INSERT ON library_entry BEGIN
 INSERT INTO wiki_index_state VALUES (NEW.workspace_id,0,1) ON CONFLICT(workspace_id) DO UPDATE SET dirty=1;
END;
CREATE TRIGGER wiki_index_dirty_update AFTER UPDATE ON library_entry BEGIN
 INSERT INTO wiki_index_state VALUES (NEW.workspace_id,0,1) ON CONFLICT(workspace_id) DO UPDATE SET dirty=1;
END;
CREATE TRIGGER wiki_index_dirty_delete AFTER DELETE ON library_entry BEGIN
 INSERT INTO wiki_index_state VALUES (OLD.workspace_id,0,1) ON CONFLICT(workspace_id) DO UPDATE SET dirty=1;
END;
CREATE TRIGGER wiki_alias_dirty_insert AFTER INSERT ON document_alias BEGIN
 INSERT INTO wiki_index_state VALUES (NEW.workspace_id,0,1) ON CONFLICT(workspace_id) DO UPDATE SET dirty=1;
END;
CREATE TRIGGER wiki_alias_dirty_update AFTER UPDATE ON document_alias BEGIN
 INSERT INTO wiki_index_state VALUES (NEW.workspace_id,0,1) ON CONFLICT(workspace_id) DO UPDATE SET dirty=1;
END;
CREATE TRIGGER wiki_alias_dirty_delete AFTER DELETE ON document_alias BEGIN
 INSERT INTO wiki_index_state VALUES (OLD.workspace_id,0,1) ON CONFLICT(workspace_id) DO UPDATE SET dirty=1;
END;
