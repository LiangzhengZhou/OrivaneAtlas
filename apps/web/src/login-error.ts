/** Shared user-facing authentication feedback; never includes server payloads. */
export function loginErrorKey(cause: unknown): string {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String(cause.code)
      : cause instanceof Error
        ? cause.message
        : String(cause);
  const messages: Record<string, string> = {
    INVALID_SERVER: "loginInvalidServer",
    VALIDATION_ERROR: "loginInvalidInput",
    UNAUTHORIZED: "loginCredentials",
    ACCOUNT_MISMATCH: "loginCredentials",
    FORBIDDEN: "loginForbidden",
    RATE_LIMITED: "loginRateLimited",
    LOGIN_TIMEOUT: "loginTimeout",
    NETWORK_ERROR: "loginNetwork",
    INVALID_RESPONSE: "loginInvalidResponse",
    SERVER_CHANGED: "loginServerChanged",
    SECURE_STORAGE: "loginSecureStorage",
    VAULT_FULL: "loginVaultFull",
  };
  return messages[code] ?? "loginError";
}
