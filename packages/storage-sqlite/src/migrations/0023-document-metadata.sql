CREATE TABLE document_alias (
 workspace_id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 alias TEXT NOT NULL,
 normalized_alias TEXT NOT NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 PRIMARY KEY(workspace_id,normalized_alias),
 FOREIGN KEY(workspace_id,document_id) REFERENCES library_entry(workspace_id,id)
) STRICT;
CREATE TABLE document_hierarchy (
 workspace_id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 parent_document_id TEXT,
 PRIMARY KEY(workspace_id,document_id),
 FOREIGN KEY(workspace_id,document_id) REFERENCES library_entry(workspace_id,id),
 FOREIGN KEY(workspace_id,parent_document_id) REFERENCES library_entry(workspace_id,id),
 CHECK(document_id <> parent_document_id)
) STRICT;
