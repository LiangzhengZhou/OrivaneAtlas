-- Preserve all existing token identities, hashes, expiry and revocation state.
CREATE TABLE api_credential_v6 (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id),
 principal_id TEXT NOT NULL REFERENCES principal(id), name TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('write','read-write')), hash TEXT NOT NULL UNIQUE,
 expires_at TEXT, revoked_at TEXT
) STRICT;
INSERT INTO api_credential_v6 SELECT * FROM api_credential;
DROP TABLE api_credential;
ALTER TABLE api_credential_v6 RENAME TO api_credential;
CREATE INDEX api_credential_account ON api_credential(account_id);
