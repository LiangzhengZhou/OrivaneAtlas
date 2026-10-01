CREATE TABLE document_wiki_link (
 workspace_id TEXT NOT NULL,
 id TEXT NOT NULL,
 source_document_id TEXT NOT NULL,
 target_document_id TEXT,
 target_text TEXT NOT NULL CHECK(length(target_text)>0),
 alias TEXT,
 heading TEXT,
 version INTEGER NOT NULL CHECK(version>0),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,source_document_id) REFERENCES library_entry(workspace_id,id),
 FOREIGN KEY(workspace_id,target_document_id) REFERENCES library_entry(workspace_id,id)
) STRICT;
CREATE INDEX document_wiki_link_target ON document_wiki_link(workspace_id,target_document_id);
CREATE INDEX document_wiki_link_source ON document_wiki_link(workspace_id,source_document_id);
