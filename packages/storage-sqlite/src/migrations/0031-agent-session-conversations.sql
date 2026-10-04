UPDATE agent_session SET payload = json_set(payload,
  '$.projectId', json_extract(payload, '$.projectId'),
  '$.spaceId', json_extract(payload, '$.spaceId'),
  '$.archivedAt', json_extract(payload, '$.archivedAt'));
CREATE INDEX agent_session_conversation_order ON agent_session
  (workspace_id, principal_id, json_extract(payload, '$.deletedAt'), json_extract(payload, '$.updatedAt') DESC);
