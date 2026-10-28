ALTER TABLE work_item ADD COLUMN timer_started_at TEXT;
ALTER TABLE work_item ADD COLUMN timer_accumulated_ms INTEGER NOT NULL DEFAULT 0;
