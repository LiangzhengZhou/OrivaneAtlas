ALTER TABLE arclattice.work_item ADD COLUMN timer_started_at TEXT;
ALTER TABLE arclattice.work_item ADD COLUMN timer_accumulated_ms BIGINT NOT NULL DEFAULT 0 CHECK (timer_accumulated_ms >= 0);
