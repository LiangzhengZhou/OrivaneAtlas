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
