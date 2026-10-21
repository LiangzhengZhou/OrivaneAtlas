CREATE TABLE file_extraction_chunk (
  id INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  locator TEXT NOT NULL,
  text TEXT NOT NULL,
  title TEXT,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(workspace_id,file_id,locator),
  FOREIGN KEY(workspace_id,file_id) REFERENCES file_extraction(workspace_id,file_id) ON DELETE CASCADE
) STRICT;
CREATE VIRTUAL TABLE file_extraction_fts USING fts5(text,title,content='file_extraction_chunk',content_rowid='id',tokenize='unicode61');
CREATE TRIGGER file_extraction_fts_insert AFTER INSERT ON file_extraction_chunk BEGIN
  INSERT INTO file_extraction_fts(rowid,text,title) VALUES (new.id,new.text,new.title);
END;
CREATE TRIGGER file_extraction_fts_delete AFTER DELETE ON file_extraction_chunk BEGIN
  INSERT INTO file_extraction_fts(file_extraction_fts,rowid,text,title) VALUES ('delete',old.id,old.text,old.title);
END;
CREATE TRIGGER file_extraction_fts_update AFTER UPDATE ON file_extraction_chunk BEGIN
  INSERT INTO file_extraction_fts(file_extraction_fts,rowid,text,title) VALUES ('delete',old.id,old.text,old.title);
  INSERT INTO file_extraction_fts(rowid,text,title) VALUES (new.id,new.text,new.title);
END;
