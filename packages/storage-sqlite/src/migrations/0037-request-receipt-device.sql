ALTER TABLE request_receipt ADD COLUMN device_id TEXT CHECK(device_id IS NULL OR length(device_id) > 0);
