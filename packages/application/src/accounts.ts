import type { ActorContext } from "@arclattice/domain";

export interface Account extends ActorContext {
  id: string;
  username: string;
  role: "ADMIN" | "USER";
  status: "PENDING" | "ACTIVE" | "DISABLED";
  version: number;
  createdAt: string;
}
export interface AccountVerifier extends Account {
  verifier: string;
}
export interface ApiCredential {
  id: string;
  accountId: string;
  principalId: string;
  name: string;
  scope: "write" | "read-write";
  expiresAt: string | null;
  revokedAt: string | null;
}
/** Host-only authentication port. Never expose verifiers to the web contract. */
export interface LoginSession {
  id: string;
  accountId: string;
  accountVersion: number;
  createdAt: number;
  expiresAt: number | null;
}

/** Safe account-facing session summary: no token or token digest. */
export interface AccountSession {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  current: boolean;
}

export interface AccountStore {
  session(hash: string, now: number): LoginSession | null;
  createSession(
    accountId: string,
    accountVersion: number,
    hash: string,
    expiresAt: number | null,
    now: number,
    replaceHash: string,
  ): void;
  sessions(accountId: string, now: number): LoginSession[];
  revokeSession(accountId: string, id: string): void;
  revokeSessions(accountId: string): void;
  find(username: string): AccountVerifier | null;
  get(id: string): Account | null;
  list(): Account[];
  register(username: string, verifier: string, claim: boolean): Account;
  status(id: string, version: number, status: "ACTIVE" | "DISABLED"): Account;
  password(id: string, verifier: string): void;
  tokens(accountId: string): ApiCredential[];
  issue(
    accountId: string,
    name: string,
    scope: ApiCredential["scope"],
    hash: string,
    days?: 30 | 90 | 365 | null,
  ): ApiCredential;
  resolve(hash: string): { account: Account; credential: ApiCredential } | null;
  revoke(accountId: string, id: string): void;
}
