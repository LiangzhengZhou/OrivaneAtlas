import { DomainError } from "@arclattice/domain";
import type { PoolClient } from "pg";

export class PostgresStorageError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PostgresStorageError";
  }
}
export const migrationLock = 1095910220;
export function pgCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}
export function translateError(error: unknown): unknown {
  if (pgCode(error) === "55P03")
    return new PostgresStorageError("LOCK_TIMEOUT");
  if (pgCode(error) === "57014")
    return new PostgresStorageError("STATEMENT_TIMEOUT");
  if (pgCode(error)?.startsWith("23"))
    return new DomainError("VALIDATION_ERROR", { field: "storage_constraint" });
  return error;
}
export async function begin(client: PoolClient, timeoutMs: number) {
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  await client.query(
    "SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', '30000', true)",
    [timeoutMs + "ms"],
  );
  // pg_catalog first prevents user functions shadowing built-ins. Migrations set
  // a different path only when creating objects in our fixed schema.
  await client.query("SET LOCAL search_path = pg_catalog, arclattice");
}
export async function sharedMigrationLock(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock_shared($1)", [
    migrationLock,
  ]);
}
export async function lockWorkspace(client: PoolClient, workspaceId: string) {
  const result = await client.query(
    "SELECT id FROM arclattice.workspace WHERE id=$1 FOR UPDATE",
    [workspaceId],
  );
  if (!result.rowCount) throw new DomainError("NOT_FOUND");
}
