import { providerFailure } from "@arclattice/application";

export function providerHttpError(status: number | undefined) {
  const category =
    status === 401
      ? "AUTH_INVALID"
      : status === 403
        ? "PERMISSION_DENIED"
        : status === 404
          ? "ENDPOINT_NOT_FOUND"
          : status === 405
            ? "METHOD_NOT_ALLOWED"
            : status === 429
              ? "RATE_LIMITED"
              : status !== undefined && status >= 500
                ? "UPSTREAM_UNAVAILABLE"
                : "PROTOCOL_ERROR";
  return providerFailure(category, status);
}

export function providerNetworkError(error: unknown, signal: AbortSignal) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (
    signal.aborted ||
    ["ETIMEDOUT", "ESOCKETTIMEDOUT", "ABORT_ERR"].includes(code)
  )
    return providerFailure("NETWORK_TIMEOUT");
  if (["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"].includes(code))
    return providerFailure("NETWORK_DNS");
  if (code.includes("CERT") || code.includes("TLS") || code.includes("SSL"))
    return providerFailure("TLS_ERROR");
  return providerFailure("UPSTREAM_UNAVAILABLE");
}
