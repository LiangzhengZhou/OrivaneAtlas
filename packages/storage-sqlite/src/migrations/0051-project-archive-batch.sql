-- Recovery manifest for an atomic owned-resource trash batch.
ALTER TABLE work_item ADD COLUMN archive_batch_json TEXT;
