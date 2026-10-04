CREATE TABLE arclattice.agent_session_metadata (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  message_count INTEGER NOT NULL CHECK(message_count >= 0),
  metadata JSONB NOT NULL,
  summary JSONB NOT NULL,
  PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id,id) REFERENCES arclattice.agent_session(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX agent_session_metadata_list ON arclattice.agent_session_metadata(workspace_id,principal_id,deleted_at,updated_at DESC,id);
CREATE TABLE arclattice.agent_session_message (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  payload JSONB NOT NULL,
  PRIMARY KEY(workspace_id,session_id,ordinal),
  FOREIGN KEY(workspace_id,session_id) REFERENCES arclattice.agent_session(workspace_id,id) ON DELETE CASCADE
);
INSERT INTO arclattice.agent_session_metadata
SELECT workspace_id,id,principal_id,payload::jsonb->>'updatedAt',payload::jsonb->>'deletedAt',jsonb_array_length(payload::jsonb->'messages'),payload::jsonb-'messages',
jsonb_build_object('id',id,'title',payload::jsonb->>'title','updatedAt',payload::jsonb->>'updatedAt','projectId',payload::jsonb->>'projectId','spaceId',payload::jsonb->>'spaceId','archivedAt',payload::jsonb->>'archivedAt','messageCount',jsonb_array_length(payload::jsonb->'messages'),'preview',left(COALESCE(payload::jsonb->'messages'->-1->>'text',''),160)) FROM arclattice.agent_session;
INSERT INTO arclattice.agent_session_message SELECT workspace_id,id,(position-1)::integer,message FROM arclattice.agent_session,jsonb_array_elements(payload::jsonb->'messages') WITH ORDINALITY AS messages(message,position);
