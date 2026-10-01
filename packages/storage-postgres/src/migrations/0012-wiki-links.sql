CREATE TABLE arclattice.library_entry (
 workspace_id TEXT NOT NULL,
 id TEXT NOT NULL,
 version BIGINT NOT NULL CHECK(version>0),
 payload TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE arclattice.document_wiki_link (
 workspace_id TEXT NOT NULL,
 id TEXT NOT NULL,
 source_document_id TEXT NOT NULL,
 target_document_id TEXT,
 target_text TEXT NOT NULL CHECK(length(target_text)>0),
 alias TEXT,
 heading TEXT,
 version INTEGER NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,source_document_id) REFERENCES arclattice.library_entry(workspace_id,id),
 FOREIGN KEY(workspace_id,target_document_id) REFERENCES arclattice.library_entry(workspace_id,id)
);
CREATE INDEX document_wiki_link_target ON arclattice.document_wiki_link(workspace_id,target_document_id);
CREATE INDEX document_wiki_link_source ON arclattice.document_wiki_link(workspace_id,source_document_id);
