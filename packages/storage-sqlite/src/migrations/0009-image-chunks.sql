CREATE TABLE library_asset_upload (
 workspace_id TEXT NOT NULL REFERENCES workspace(id),
 id TEXT NOT NULL, principal_id TEXT NOT NULL, space_id TEXT,
 name TEXT NOT NULL, mime TEXT NOT NULL, next_index INTEGER NOT NULL DEFAULT 0,
 complete INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
 PRIMARY KEY (workspace_id,id),
 FOREIGN KEY (workspace_id,space_id) REFERENCES library_entry(workspace_id,id)
) STRICT;
CREATE TABLE library_asset_chunk (
 workspace_id TEXT NOT NULL, upload_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
 base64 TEXT NOT NULL, PRIMARY KEY (workspace_id,upload_id,chunk_index),
 FOREIGN KEY (workspace_id,upload_id) REFERENCES library_asset_upload(workspace_id,id) ON DELETE CASCADE
) STRICT;
CREATE INDEX library_asset_upload_expiry ON library_asset_upload(workspace_id,complete,updated_at);
