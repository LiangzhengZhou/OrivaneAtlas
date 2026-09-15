CREATE TABLE library_asset_v8 (
 workspace_id TEXT NOT NULL REFERENCES workspace(id), id TEXT NOT NULL, space_id TEXT, name TEXT NOT NULL,
 mime TEXT NOT NULL, base64 TEXT NOT NULL, PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,space_id) REFERENCES library_entry(workspace_id,id)
) STRICT;
INSERT INTO library_asset_v8 SELECT workspace_id,id,space_id,name,mime,base64 FROM library_asset;
DROP TABLE library_asset;
ALTER TABLE library_asset_v8 RENAME TO library_asset;
