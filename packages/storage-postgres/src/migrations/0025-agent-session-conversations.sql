UPDATE arclattice.agent_session SET payload = (payload::jsonb || jsonb_build_object(
  'projectId', payload::jsonb->'projectId',
  'spaceId', payload::jsonb->'spaceId',
  'archivedAt', payload::jsonb->'archivedAt'))::text;
CREATE INDEX agent_session_conversation_order ON arclattice.agent_session
  (workspace_id, principal_id, (payload::jsonb->>'deletedAt'), (payload::jsonb->>'updatedAt') DESC);
