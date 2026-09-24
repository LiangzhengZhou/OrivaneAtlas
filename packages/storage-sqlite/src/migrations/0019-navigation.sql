CREATE TABLE user_navigation (
  workspace_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  preference_json TEXT NOT NULL CHECK(json_valid(preference_json)),
  PRIMARY KEY(workspace_id, principal_id)
) STRICT;
