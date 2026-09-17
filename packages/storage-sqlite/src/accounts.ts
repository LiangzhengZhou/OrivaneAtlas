import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  Account,
  AccountStore,
  AccountVerifier,
  ApiCredential,
  LoginSession,
} from "@arclattice/application";
import { DomainError } from "@arclattice/domain";

const accountFields =
  "id,username,workspace_id AS workspaceId,principal_id AS principalId,role,status,version,created_at AS createdAt";
const tokenFields =
  "id,account_id AS accountId,principal_id AS principalId,name,scope,expires_at AS expiresAt,revoked_at AS revokedAt";
const sessionFields =
  "id,account_id AS accountId,account_version AS accountVersion,created_at AS createdAt,expires_at AS expiresAt";
export function accountStore(
  db: DatabaseSync,
  guard: () => void,
): AccountStore {
  const get = (id: string) => {
    guard();
    return (
      (db
        .prepare("SELECT " + accountFields + " FROM account WHERE id=?")
        .get(id) as unknown as Account) ?? null
    );
  };
  return {
    session(hash, now) {
      guard();
      const session = db
        .prepare(
          "SELECT " +
            sessionFields +
            " FROM login_session WHERE token_hash=? AND (expires_at IS NULL OR expires_at>?)",
        )
        .get(hash, now) as unknown as LoginSession | undefined;
      if (!session) return null;
      const account = get(session.accountId);
      return account?.status === "ACTIVE" &&
        account.version === session.accountVersion
        ? session
        : null;
    },
    createSession(
      accountId,
      accountVersion,
      hash,
      expiresAt,
      now,
      replaceHash,
    ) {
      guard();
      const account = get(accountId);
      if (account?.status !== "ACTIVE" || account.version !== accountVersion)
        throw new DomainError("FORBIDDEN");
      db.prepare(
        "DELETE FROM login_session WHERE account_id=? AND ((expires_at IS NOT NULL AND expires_at<=?) OR account_version!=? OR token_hash=?)",
      ).run(accountId, now, accountVersion, replaceHash);
      if (
        Number(
          db
            .prepare("SELECT count(*) n FROM login_session WHERE account_id=?")
            .get(accountId)?.n,
        ) >= 32
      )
        throw new DomainError("RATE_LIMITED");
      db.prepare("INSERT INTO login_session VALUES (?,?,?,?,?,?)").run(
        randomUUID(),
        hash,
        accountId,
        accountVersion,
        now,
        expiresAt,
      );
    },
    sessions(accountId, now) {
      guard();
      const account = get(accountId);
      if (account?.status !== "ACTIVE") return [];
      return db
        .prepare(
          "SELECT " +
            sessionFields +
            " FROM login_session WHERE account_id=? AND account_version=? AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC, id",
        )
        .all(accountId, account.version, now) as unknown as LoginSession[];
    },
    revokeSession(accountId, id) {
      guard();
      db.prepare("DELETE FROM login_session WHERE account_id=? AND id=?").run(
        accountId,
        id,
      );
    },
    revokeSessions(accountId) {
      guard();
      db.prepare("DELETE FROM login_session WHERE account_id=?").run(accountId);
    },
    get,
    find(username) {
      guard();
      return (
        (db
          .prepare(
            "SELECT " +
              accountFields +
              ",verifier FROM account WHERE username=? COLLATE NOCASE",
          )
          .get(username) as unknown as AccountVerifier) ?? null
      );
    },
    list() {
      guard();
      return db
        .prepare(
          "SELECT " + accountFields + " FROM account ORDER BY created_at",
        )
        .all() as unknown as Account[];
    },
    register(username, verifier, claim) {
      guard();
      if (
        Number(
          db.prepare("SELECT count(*) n FROM account WHERE role='USER'").get()
            ?.n,
        ) >= 99 &&
        !claim
      )
        throw new DomainError("FORBIDDEN");
      if (claim && db.prepare("SELECT 1 FROM account WHERE role='ADMIN'").get())
        throw new DomainError("FORBIDDEN");
      const id = randomUUID(),
        workspaceId = claim ? "arclattice-personal" : randomUUID(),
        principalId = claim ? "arclattice-owner" : randomUUID();
      if (!claim) {
        db.prepare("INSERT INTO workspace VALUES (?,?)").run(
          workspaceId,
          username,
        );
        db.prepare("INSERT INTO principal VALUES (?,'USER',?)").run(
          principalId,
          username,
        );
        db.prepare("INSERT INTO workspace_principal VALUES (?,?)").run(
          workspaceId,
          principalId,
        );
      }
      db.prepare("INSERT INTO account VALUES (?,?,?,?,?,?,?,1,?)").run(
        id,
        username,
        verifier,
        workspaceId,
        principalId,
        claim ? "ADMIN" : "USER",
        claim ? "ACTIVE" : "PENDING",
        new Date().toISOString(),
      );
      return get(id)!;
    },
    status(id, version, status) {
      guard();
      if (
        db
          .prepare(
            "UPDATE account SET status=?,version=version+1 WHERE id=? AND version=? AND role!='ADMIN'",
          )
          .run(status, id, version).changes !== 1
      )
        throw new DomainError("VERSION_CONFLICT");
      if (status === "DISABLED")
        db.prepare(
          "UPDATE api_credential SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL",
        ).run(new Date().toISOString(), id);
      db.prepare("DELETE FROM login_session WHERE account_id=?").run(id);
      return get(id)!;
    },
    password(id, verifier) {
      guard();
      db.prepare(
        "UPDATE account SET verifier=?,version=version+1 WHERE id=?",
      ).run(verifier, id);
      db.prepare("DELETE FROM login_session WHERE account_id=?").run(id);
      db.prepare(
        "UPDATE api_credential SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL",
      ).run(new Date().toISOString(), id);
    },
    tokens(accountId) {
      guard();
      return db
        .prepare(
          "SELECT " +
            tokenFields +
            " FROM api_credential WHERE account_id=? ORDER BY expires_at DESC",
        )
        .all(accountId) as unknown as ApiCredential[];
    },
    issue(accountId, name, scope, hash, days = 30) {
      if (days !== null && ![30, 90, 365].includes(days))
        throw new DomainError("VALIDATION_ERROR");
      const account = get(accountId);
      if (!account || account.status !== "ACTIVE")
        throw new DomainError("FORBIDDEN");
      if (
        Number(
          db
            .prepare(
              "SELECT count(*) n FROM api_credential WHERE account_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
            )
            .get(accountId, new Date().toISOString())?.n,
        ) >= 20
      )
        throw new DomainError("FORBIDDEN");
      const id = randomUUID(),
        principalId = randomUUID(),
        expiresAt =
          days === null
            ? null
            : new Date(Date.now() + days * 86400000).toISOString();
      db.prepare("INSERT INTO principal VALUES (?,'AGENT',?)").run(
        principalId,
        name,
      );
      db.prepare("INSERT INTO workspace_principal VALUES (?,?)").run(
        account.workspaceId,
        principalId,
      );
      db.prepare("INSERT INTO api_credential VALUES (?,?,?,?,?,?,?,NULL)").run(
        id,
        accountId,
        principalId,
        name,
        scope,
        hash,
        expiresAt,
      );
      return {
        id,
        accountId,
        principalId,
        name,
        scope,
        expiresAt,
        revokedAt: null,
      };
    },
    resolve(hash) {
      guard();
      const credential = db
        .prepare(
          "SELECT " +
            tokenFields +
            " FROM api_credential WHERE hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
        )
        .get(hash, new Date().toISOString()) as unknown as
        | ApiCredential
        | undefined;
      if (!credential) return null;
      const account = get(credential.accountId);
      return account?.status === "ACTIVE" ? { account, credential } : null;
    },
    revoke(accountId, id) {
      guard();
      if (
        db
          .prepare(
            "UPDATE api_credential SET revoked_at=coalesce(revoked_at,?) WHERE account_id=? AND id=?",
          )
          .run(new Date().toISOString(), accountId, id).changes !== 1
      )
        throw new DomainError("NOT_FOUND");
    },
  };
}
