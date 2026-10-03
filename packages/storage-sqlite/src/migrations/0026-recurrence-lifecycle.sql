ALTER TABLE activity ADD COLUMN reason TEXT CHECK(reason IS NULL OR reason = 'RECURRENCE_WINDOW_EXPIRED');
UPDATE workflow_record SET payload=json_set(payload,'$.state',COALESCE(json_extract(payload,'$.state'),CASE WHEN deleted_at IS NOT NULL THEN 'PAUSED' ELSE 'ACTIVE' END),'$.closePolicy',COALESCE(json_extract(payload,'$.closePolicy'),'END_OF_DAY'),'$.closeIncomplete',json(CASE WHEN json_type(payload,'$.closeIncomplete')='false' THEN 'false' ELSE 'true' END)) WHERE kind='RECURRENCE';
UPDATE workflow_record SET deleted_at=NULL WHERE kind='RECURRENCE' AND json_extract(payload,'$.state')='PAUSED';
UPDATE workflow_record SET payload=json_set(payload,'$.status','OPEN') WHERE kind='OCCURRENCE' AND json_extract(payload,'$.status')='CREATED';
