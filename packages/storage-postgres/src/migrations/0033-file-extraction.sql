CREATE TABLE arclattice.file_extraction (
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  file_version BIGINT NOT NULL CHECK(file_version > 0),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  index_version INTEGER NOT NULL CHECK(index_version > 0),
  payload JSONB NOT NULL,
  PRIMARY KEY(workspace_id,file_id),
  FOREIGN KEY(workspace_id,file_id) REFERENCES arclattice.library_file(workspace_id,id) ON DELETE CASCADE
);
