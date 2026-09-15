CREATE TABLE account (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 verifier TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspace(id),
 principal_id TEXT NOT NULL REFERENCES principal(id), role TEXT NOT NULL CHECK(role IN ('ADMIN','USER')),
 status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','DISABLED')), version INTEGER NOT NULL,
 created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX account_admin ON account(role) WHERE role='ADMIN';
CREATE TABLE api_credential (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id),
 principal_id TEXT NOT NULL REFERENCES principal(id), name TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('write','read-write')), hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL, revoked_at TEXT
) STRICT;
CREATE INDEX api_credential_account ON api_credential(account_id);
CREATE TABLE library_entry (
 workspace_id TEXT NOT NULL REFERENCES workspace(id), id TEXT NOT NULL,
 version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(workspace_id,id)
) STRICT;
CREATE TABLE library_revision (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(workspace_id,id,version), FOREIGN KEY(workspace_id,id) REFERENCES library_entry(workspace_id,id)
) STRICT;
CREATE TABLE library_asset (
 workspace_id TEXT NOT NULL, id TEXT NOT NULL, space_id TEXT NOT NULL, name TEXT NOT NULL,
 mime TEXT NOT NULL, base64 TEXT NOT NULL, PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,space_id) REFERENCES library_entry(workspace_id,id)
) STRICT;
