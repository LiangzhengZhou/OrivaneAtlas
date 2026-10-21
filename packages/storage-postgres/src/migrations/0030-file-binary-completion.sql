ALTER TABLE arclattice.file_blob_descriptor ADD COLUMN chunk_size INTEGER NOT NULL DEFAULT 262144 CHECK(chunk_size BETWEEN 1 AND 262144);
ALTER TABLE arclattice.file_blob_descriptor ADD COLUMN completed BOOLEAN NOT NULL DEFAULT FALSE;
