CREATE TABLE arclattice.file_extraction_chunk (
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  locator TEXT NOT NULL,
  text TEXT NOT NULL,
  title TEXT,
  payload JSONB NOT NULL,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple',coalesce(title,'') || ' ' || text)) STORED,
  PRIMARY KEY(workspace_id,file_id,locator),
  FOREIGN KEY(workspace_id,file_id) REFERENCES arclattice.file_extraction(workspace_id,file_id) ON DELETE CASCADE
);
CREATE INDEX file_extraction_search ON arclattice.file_extraction_chunk USING GIN(search_vector);
