SET search_path TO arclattice, public;
ALTER TABLE activity DROP CONSTRAINT activity_reason_check;
ALTER TABLE activity ADD CONSTRAINT activity_reason_check CHECK(reason IS NULL OR reason IN ('RECURRENCE_WINDOW_EXPIRED','RECURRENCE_USER_SKIPPED'));
