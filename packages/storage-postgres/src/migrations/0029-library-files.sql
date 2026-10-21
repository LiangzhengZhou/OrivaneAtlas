CREATE TABLE arclattice.library_file (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id),
  id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK(version > 0),
  payload JSONB NOT NULL,
  PRIMARY KEY(workspace_id,id)
);
CREATE INDEX library_file_space ON arclattice.library_file(workspace_id,(payload->>'spaceId'));
CREATE TABLE arclattice.file_activity (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id),
  id TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY(workspace_id,id)
);
CREATE TABLE arclattice.file_outbox (
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type='FILE_CHANGED'),
  PRIMARY KEY(workspace_id,event_id),
  FOREIGN KEY(workspace_id,event_id) REFERENCES arclattice.file_activity(workspace_id,id)
);
CREATE TABLE arclattice.file_blob_descriptor (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  size BIGINT NOT NULL CHECK(size>=0),
  mime TEXT NOT NULL,
  PRIMARY KEY(workspace_id,content_hash)
);
CREATE TABLE arclattice.file_blob_chunk (
  workspace_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),
  chunk_hash TEXT NOT NULL CHECK(length(chunk_hash)=64),
  size INTEGER NOT NULL CHECK(size>=0 AND size<=262144),
  bytes BYTEA NOT NULL CHECK(octet_length(bytes)=size),
  PRIMARY KEY(workspace_id,content_hash,chunk_index),
  FOREIGN KEY(workspace_id,content_hash) REFERENCES arclattice.file_blob_descriptor(workspace_id,content_hash)
);
CREATE TRIGGER sync_library_file AFTER INSERT OR UPDATE OR DELETE
ON arclattice.library_file FOR EACH ROW
EXECUTE FUNCTION arclattice.record_workspace_change('files');
