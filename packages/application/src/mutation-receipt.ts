import { type ActorContext, DomainError } from "@arclattice/domain";

/** Authenticated, read-only lookup. Missing or foreign-device receipts are indistinguishable. */
export interface MutationReceiptReader {
  lookupMutationReceipt(
    actor: ActorContext,
    commandId: string,
    deviceId: string,
  ): Promise<unknown | null>;
}

export interface MutationReceipt {
  readonly key: string;
  readonly digest: string;
  readonly deviceId?: string;
  readonly workspacePrecondition?: WorkspaceMutationPrecondition;
}

export interface WorkspaceMutationPrecondition {
  readonly epoch: string;
  readonly cursor: number;
}
export function requireWorkspaceMutationPrecondition(
  input: unknown,
): WorkspaceMutationPrecondition {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR", {
      field: "workspacePrecondition",
    });
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !["epoch", "cursor"].includes(key)) ||
    typeof value.epoch !== "string" ||
    !value.epoch ||
    value.epoch.length > 240 ||
    typeof value.cursor !== "number" ||
    !Number.isSafeInteger(value.cursor) ||
    value.cursor < 0
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "workspacePrecondition",
    });
  return { epoch: value.epoch, cursor: value.cursor };
}

/** Binding the review to the receipt prevents retries changing its precondition. */
export function mutationReceiptDigest(receipt: MutationReceipt): string {
  const guard = receipt.workspacePrecondition;
  return guard
    ? JSON.stringify([receipt.digest, guard.epoch, guard.cursor])
    : receipt.digest;
}

/** Call under the existing workspace mutation transaction/lock, after cached receipt lookup. */
export async function assertWorkspaceMutationPrecondition(
  transaction: Pick<import("./index").WorkTransaction, "workspaceChanges">,
  input: WorkspaceMutationPrecondition,
): Promise<void> {
  const expected = requireWorkspaceMutationPrecondition(input);
  const actual = await transaction.workspaceChanges(
    expected.cursor,
    expected.epoch,
  );
  if (
    actual.recovery ||
    actual.epoch !== expected.epoch ||
    actual.cursor !== expected.cursor ||
    actual.changes.length !== 0 ||
    actual.hasMore
  )
    throw new DomainError("VERSION_CONFLICT", {
      field: "workspacePrecondition",
    });
}

/** Capture the committed step's exact head under the same transaction as its receipt. */
export async function reviewedWorkspaceMutationResult<T>(
  transaction: Pick<import("./index").WorkTransaction, "workspaceChanges">,
  expected: WorkspaceMutationPrecondition,
  result: T,
): Promise<{ result: T; workspaceRevision: WorkspaceMutationPrecondition }> {
  let cursor = expected.cursor;
  for (;;) {
    const page = await transaction.workspaceChanges(cursor, expected.epoch);
    if (
      page.recovery ||
      page.epoch !== expected.epoch ||
      page.cursor < cursor ||
      (page.hasMore && page.cursor === cursor)
    )
      throw new DomainError("VERSION_CONFLICT", {
        field: "workspacePrecondition",
      });
    cursor = page.cursor;
    if (!page.hasMore)
      return { result, workspaceRevision: { epoch: page.epoch, cursor } };
  }
}

export const stableUuidPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const stableUuid = new RegExp(stableUuidPattern);

export function requireStableUuid(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !stableUuid.test(value))
    throw new DomainError("VALIDATION_ERROR", { field });
  return value;
}

export function requireMutationReceipt(receipt: MutationReceipt): void {
  if (
    typeof receipt.key !== "string" ||
    !receipt.key.length ||
    receipt.key.length > 80 ||
    typeof receipt.digest !== "string" ||
    !receipt.digest.length ||
    receipt.digest.length > 128
  )
    throw new DomainError("VALIDATION_ERROR", { field: "receipt" });
  if (receipt.deviceId !== undefined)
    requireStableUuid(receipt.deviceId, "deviceId");
  if (receipt.workspacePrecondition !== undefined)
    requireWorkspaceMutationPrecondition(receipt.workspacePrecondition);
}

/** Exact operation proof; never broadens ordinary device-scoped receipt visibility. */
export function requireReviewedMutationReceiptProof(input: unknown): string {
  if (typeof input !== "string" || input.length > 1024)
    throw new DomainError("VALIDATION_ERROR");
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new DomainError("VALIDATION_ERROR");
  }
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    typeof value[0] !== "string" ||
    !/^[a-f0-9]{64}$/.test(value[0])
  )
    throw new DomainError("VALIDATION_ERROR");
  requireWorkspaceMutationPrecondition({ epoch: value[1], cursor: value[2] });
  if (JSON.stringify(value) !== input)
    throw new DomainError("VALIDATION_ERROR");
  return input;
}
