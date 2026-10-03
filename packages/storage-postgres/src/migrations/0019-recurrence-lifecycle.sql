SET search_path TO arclattice, public;
ALTER TABLE activity ADD COLUMN reason TEXT CHECK(reason IS NULL OR reason = 'RECURRENCE_WINDOW_EXPIRED');
UPDATE workflow_record SET payload=(jsonb_build_object('state',CASE WHEN deleted_at IS NOT NULL THEN 'PAUSED' ELSE 'ACTIVE' END,'closePolicy','END_OF_DAY','closeIncomplete',true) || payload::jsonb)::text WHERE kind='RECURRENCE';
UPDATE workflow_record SET deleted_at=NULL WHERE kind='RECURRENCE' AND payload::jsonb->>'state'='PAUSED';
UPDATE workflow_record SET payload=jsonb_set(payload::jsonb,'{status}','"OPEN"')::text WHERE kind='OCCURRENCE' AND payload::jsonb->>'status'='CREATED';
