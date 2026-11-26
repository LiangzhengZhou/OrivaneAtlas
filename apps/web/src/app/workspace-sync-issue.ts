import type { LocalWorkSyncStage } from "@arclattice/application";
import { DomainError } from "@arclattice/domain";

export type WorkspaceSyncIssue =
  | "localReadFailed"
  | "syncFailed"
  | "syncAuth"
  | "syncForbidden"
  | "syncConflict"
  | "syncNetwork";

/** Expose only known categories. Transport messages can contain private data. */
export function workspaceSyncIssue(cause: unknown): WorkspaceSyncIssue {
  switch (cause instanceof Error ? cause.message : "") {
    case "UNAUTHORIZED":
    case "SYNC_REQUEST_401":
      return "syncAuth";
    case "FORBIDDEN":
    case "SYNC_REQUEST_403":
      return "syncForbidden";
    case "VERSION_CONFLICT":
    case "SYNC_REQUEST_409":
      return "syncConflict";
    case "NETWORK_ERROR":
    case "LOGIN_TIMEOUT":
      return "syncNetwork";
    default:
      return "syncFailed";
  }
}

const stages = new WeakMap<Error, LocalWorkSyncStage>();
export function recordWorkspaceSyncStage(
  cause: unknown,
  stage: LocalWorkSyncStage,
) {
  if (cause instanceof Error) stages.set(cause, stage);
}
const safeCodes = new Set([
  "FORBIDDEN",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_SERVER",
  "INVALID_RESPONSE",
  "INVALID_WRITE",
  "VALIDATION_ERROR",
  "LOCAL_DATA_CORRUPT",
  "HASH_MISMATCH",
  "NETWORK_ERROR",
  "LOGIN_TIMEOUT",
  "SERVER_CHANGED",
  "LOCAL_FILE_BYTES_MISSING_OR_CORRUPT",
  "INVALID_FILE_CHUNK",
  "INVALID_FILE_TRANSFER_RESPONSE",
  "WIKI_BOOTSTRAP_UPGRADE_REQUIRED",
]);
export function workspaceSyncDiagnostic(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "";
  const httpError =
    /^(SYNC_REQUEST|FILE_TRANSFER|FILE_CHUNK)_([45]\d{2})$/.exec(message);
  const status = httpError
    ? Number(httpError[2])
    : cause instanceof DomainError
      ? cause.params.httpStatus
      : undefined;
  return {
    stage:
      (cause instanceof Error && stages.get(cause)) || ("unknown" as const),
    code: httpError?.[1] ?? (safeCodes.has(message) ? message : "UNKNOWN"),
    httpStatus:
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
        ? status
        : null,
  };
}
export type WorkspaceSyncDiagnostic = ReturnType<
  typeof workspaceSyncDiagnostic
>;
