CREATE TABLE library_file (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,id)
);
CREATE INDEX library_file_space ON library_file(workspace_id,json_extract(payload,'$.spaceId'));
CREATE TABLE file_activity (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,id)
);
CREATE TABLE file_outbox (
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type='FILE_CHANGED'),
  PRIMARY KEY(workspace_id,event_id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES file_activity(workspace_id,id)
);
CREATE TABLE file_blob_descriptor (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  size INTEGER NOT NULL CHECK(size>=0),
  mime TEXT NOT NULL,
  PRIMARY KEY(workspace_id,content_hash)
);
CREATE TABLE file_blob_chunk (
  workspace_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),
  chunk_hash TEXT NOT NULL CHECK(length(chunk_hash)=64),
  size INTEGER NOT NULL CHECK(size>=0 AND size<=262144),
  bytes BLOB NOT NULL CHECK(length(bytes)=size),
  PRIMARY KEY(workspace_id,content_hash,chunk_index),
  FOREIGN KEY(workspace_id,content_hash) REFERENCES file_blob_descriptor(workspace_id,content_hash)
);
CREATE TRIGGER sync_library_file_insert AFTER INSERT ON library_file BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'files',NEW.id,'UPSERT',NEW.version);
END;
CREATE TRIGGER sync_library_file_update AFTER UPDATE ON library_file BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'files',NEW.id,'UPSERT',NEW.version);
END;
CREATE TRIGGER sync_library_file_delete AFTER DELETE ON library_file BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(OLD.workspace_id,'files',OLD.id,'DELETE',OLD.version);
END;
