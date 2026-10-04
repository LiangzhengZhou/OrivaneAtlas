CREATE TABLE agent_session_metadata (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  message_count INTEGER NOT NULL CHECK(message_count >= 0),
  metadata TEXT NOT NULL CHECK(json_valid(metadata)),
  summary TEXT NOT NULL CHECK(json_valid(summary)),
  PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id,id) REFERENCES agent_session(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX agent_session_metadata_list ON agent_session_metadata(workspace_id,principal_id,deleted_at,updated_at DESC,id);
CREATE TABLE agent_session_message (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,session_id,ordinal),
  FOREIGN KEY(workspace_id,session_id) REFERENCES agent_session(workspace_id,id) ON DELETE CASCADE
);
INSERT INTO agent_session_metadata
SELECT workspace_id,id,principal_id,json_extract(payload,'$.updatedAt'),json_extract(payload,'$.deletedAt'),json_array_length(payload,'$.messages'),json_remove(payload,'$.messages'),
json_object('id',id,'title',json_extract(payload,'$.title'),'updatedAt',json_extract(payload,'$.updatedAt'),'projectId',json_extract(payload,'$.projectId'),'spaceId',json_extract(payload,'$.spaceId'),'archivedAt',json_extract(payload,'$.archivedAt'),'messageCount',json_array_length(payload,'$.messages'),'preview',substr(COALESCE(json_extract(payload,'$.messages[#-1].text'),''),1,160))
FROM agent_session;
INSERT INTO agent_session_message SELECT agent_session.workspace_id,agent_session.id,CAST(messages.key AS INTEGER),messages.value FROM agent_session,json_each(agent_session.payload,'$.messages') AS messages;
