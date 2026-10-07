import { ModelNotSentError } from "./gateway-policy";
import type { ProviderKind } from "./provider-adapter";

export type ProviderErrorCategory =
  | "AUTH_INVALID"
  | "PERMISSION_DENIED"
  | "ENDPOINT_NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "NETWORK_TIMEOUT"
  | "NETWORK_DNS"
  | "TLS_ERROR"
  | "PROTOCOL_ERROR"
  | "UNSUPPORTED_DISCOVERY";

/** Public diagnostics contain classifications only, never upstream text or headers. */
export interface ProviderFailure {
  category: ProviderErrorCategory;
  provider?: ProviderKind;
  status?: number;
  retryable: boolean;
  messageKey: string;
}
export class ProviderRequestError extends Error {
  constructor(readonly failure: ProviderFailure) {
    super(failure.category);
    this.name = "ProviderRequestError";
  }
}
export class ProviderNotSentError extends ModelNotSentError {
  constructor(readonly failure: ProviderFailure) {
    super(failure.category);
  }
}
export type ProviderDiagnostic = `PROVIDER_REQUEST_FAILED:${string}`;
export function providerDiagnostic(
  error: unknown,
): ProviderDiagnostic | undefined {
  if (
    !(error instanceof ProviderRequestError) &&
    !(error instanceof ProviderNotSentError)
  )
    return undefined;
  const { category, status, provider } = error.failure;
  return `PROVIDER_REQUEST_FAILED:${JSON.stringify(providerFailure(category, status, provider).failure)}`;
}

export function providerFailure(
  category: ProviderErrorCategory,
  status?: number,
  provider?: ProviderKind,
): ProviderRequestError {
  return new ProviderRequestError({
    category,
    ...(status === undefined ? {} : { status }),
    ...(provider === undefined ? {} : { provider }),
    retryable: [
      "RATE_LIMITED",
      "UPSTREAM_UNAVAILABLE",
      "NETWORK_TIMEOUT",
      "NETWORK_DNS",
    ].includes(category),
    messageKey: `provider.error.${category}`,
  });
}
