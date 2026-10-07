import { expect, it } from "vitest";
import { providerHttpError, providerNetworkError } from "./provider-error";

it.each([
  [401, "AUTH_INVALID", false],
  [403, "PERMISSION_DENIED", false],
  [404, "ENDPOINT_NOT_FOUND", false],
  [405, "METHOD_NOT_ALLOWED", false],
  [429, "RATE_LIMITED", true],
  [503, "UPSTREAM_UNAVAILABLE", true],
  [302, "PROTOCOL_ERROR", false],
] as const)(
  "classifies HTTP %s without exposing upstream data",
  (status, category, retryable) => {
    expect(providerHttpError(status).failure).toEqual({
      category,
      status,
      retryable,
      messageKey: `provider.error.${category}`,
    });
  },
);

it.each([
  ["ETIMEDOUT", "NETWORK_TIMEOUT"],
  ["ENOTFOUND", "NETWORK_DNS"],
  ["EAI_AGAIN", "NETWORK_DNS"],
  ["ERR_TLS_CERT_ALTNAME_INVALID", "TLS_ERROR"],
  ["ECONNRESET", "UPSTREAM_UNAVAILABLE"],
] as const)(
  "classifies network %s without copying secret-bearing messages",
  (code, category) => {
    const error = Object.assign(
      new Error("Authorization: Bearer TEST-PRIVATE-KEY"),
      { code },
    );
    const result = providerNetworkError(error, new AbortController().signal);
    expect(result.failure.category).toBe(category);
    expect(JSON.stringify(result.failure)).not.toContain("TEST-PRIVATE-KEY");
    expect(result.message).toBe(category);
  },
);
