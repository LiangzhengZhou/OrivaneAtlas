CREATE TABLE login_session (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
 account_id TEXT NOT NULL REFERENCES account(id),
 account_version INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER CHECK(expires_at IS NULL OR expires_at > created_at)
) STRICT;
CREATE INDEX login_session_account ON login_session(account_id);
