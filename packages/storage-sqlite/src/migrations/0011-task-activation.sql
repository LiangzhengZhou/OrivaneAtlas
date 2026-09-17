ALTER TABLE work_item ADD COLUMN activation_state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(activation_state IN ('ACTIVE','INACTIVE','SCHEDULED'));
ALTER TABLE work_item ADD COLUMN activation_policy TEXT NOT NULL DEFAULT 'MANUAL' CHECK(activation_policy IN ('MANUAL','IMMEDIATE','WHEN_DEPENDENCIES_COMPLETED','AT_SCHEDULED_TIME'));
CREATE INDEX work_item_activation ON work_item(workspace_id, activation_state, deleted_at);
