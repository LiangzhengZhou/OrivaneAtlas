import { DomainError } from "@arclattice/domain";
import type { AgentRun, ModelRoute, ModelUsage } from "./connected";

export type GatewayLimit = number | "UNLIMITED";
export type GatewayCapability = "TEXT" | "JSON" | "EMBEDDING";
export interface GatewayPolicy {
  providerId: string;
  enabled: boolean;
  capabilities: GatewayCapability[];
  capability: GatewayCapability;
  dailyRequests: GatewayLimit;
  dailyBudgetMicros: GatewayLimit;
  currency: "USD";
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  fallbackProfileIds: string[];
}
export interface GatewayMoney {
  currency: "USD";
  reservedMicros: number;
  chargedMicros: number;
  state: "RESERVED" | "RECONCILED" | "UNKNOWN" | "NOT_SENT";
  routeFingerprint?: string;
}
export interface GatewaySettlement {
  routeFingerprint?: string;
  notSent: boolean;
}
export class ModelNotSentError extends Error {
  constructor(code = "MODEL_NOT_SENT") {
    super(code);
  }
}

export function validateGatewayPolicy(value: unknown): GatewayPolicy {
  const policy = value as GatewayPolicy;
  const integer = (amount: unknown) =>
    typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount >= 0 &&
    amount <= 1_000_000_000_000;
  const limit = (amount: unknown) => amount === "UNLIMITED" || integer(amount);
  if (
    !policy ||
    typeof policy !== "object" ||
    Object.keys(policy).sort().join(",") !==
      "capabilities,capability,currency,dailyBudgetMicros,dailyRequests,enabled,fallbackProfileIds,inputMicrosPerMillion,outputMicrosPerMillion,providerId" ||
    typeof policy.providerId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(policy.providerId) ||
    typeof policy.enabled !== "boolean" ||
    policy.currency !== "USD" ||
    !Array.isArray(policy.capabilities) ||
    !policy.capabilities.length ||
    policy.capabilities.length > 3 ||
    new Set(policy.capabilities).size !== policy.capabilities.length ||
    !policy.capabilities.every((capability) =>
      ["TEXT", "JSON", "EMBEDDING"].includes(capability),
    ) ||
    !policy.capabilities.includes(policy.capability) ||
    !limit(policy.dailyRequests) ||
    !limit(policy.dailyBudgetMicros) ||
    !integer(policy.inputMicrosPerMillion) ||
    !integer(policy.outputMicrosPerMillion) ||
    !Array.isArray(policy.fallbackProfileIds) ||
    policy.fallbackProfileIds.length > 2 ||
    new Set(policy.fallbackProfileIds).size !==
      policy.fallbackProfileIds.length ||
    !policy.fallbackProfileIds.every(
      (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(id),
    )
  )
    throw new DomainError("VALIDATION_ERROR");
  return structuredClone(policy);
}

export function pricedUsage(
  route: ModelRoute,
  inputTokens: number,
  outputTokens: number,
): number {
  if (!route.gateway) throw new DomainError("FORBIDDEN");
  const numerator =
    BigInt(inputTokens) * BigInt(route.gateway.inputMicrosPerMillion) +
    BigInt(outputTokens) * BigInt(route.gateway.outputMicrosPerMillion);
  const cost = Number((numerator + 999999n) / 1000000n);
  if (!Number.isSafeInteger(cost)) throw new DomainError("FORBIDDEN");
  return cost;
}

export function gatewayReservation(
  run: AgentRun,
  runs: AgentRun[],
  now: string,
): GatewayMoney | undefined {
  if (!run.route.gateway) return undefined;
  const candidates = [run.route, ...(run.route.fallbackRoutes ?? [])];
  const history = runs.filter(
    (other) =>
      other.workspaceId === run.workspaceId &&
      other.createdBy === run.createdBy &&
      (other.route.scope ?? "personal") === (run.route.scope ?? "personal") &&
      other.attempt?.reservedAt.slice(0, 10) === now.slice(0, 10),
  );
  const reservedMicros = Math.max(
    ...candidates.map((route) =>
      pricedUsage(
        route,
        run.prompt.length * 4 + 4096,
        route.gateway?.capability === "EMBEDDING" ? 0 : route.maxOutputTokens,
      ),
    ),
  );
  for (const route of candidates) {
    const policy = route.gateway;
    if (!policy || !policy.enabled) throw new DomainError("FORBIDDEN");
    validateGatewayPolicy(policy);
    if (
      policy.dailyRequests !== "UNLIMITED" &&
      history.length >= policy.dailyRequests
    )
      throw new DomainError("FORBIDDEN");
    if (policy.dailyBudgetMicros !== "UNLIMITED") {
      if (history.some((other) => !other.attempt?.money))
        throw new DomainError("FORBIDDEN");
      const spent = history.reduce(
        (total, other) => total + (other.attempt?.money?.chargedMicros ?? 0),
        0,
      );
      if (
        !Number.isSafeInteger(spent) ||
        spent + reservedMicros > policy.dailyBudgetMicros
      )
        throw new DomainError("FORBIDDEN");
    }
  }
  return {
    currency: "USD",
    reservedMicros,
    chargedMicros: reservedMicros,
    state: "RESERVED",
  };
}

export function settleGatewayMoney(
  run: AgentRun,
  usage?: ModelUsage,
  settlement?: GatewaySettlement,
): GatewayMoney | undefined {
  const money = run.attempt?.money;
  if (!money) return undefined;
  if (settlement?.notSent && !usage)
    return { ...money, chargedMicros: 0, state: "NOT_SENT" };
  const route = [run.route, ...(run.route.fallbackRoutes ?? [])].find(
    (candidate) =>
      candidate.fingerprint ===
      (settlement?.routeFingerprint ?? run.route.fingerprint),
  );
  if (
    usage &&
    route &&
    (!run.route.fallbackRoutes?.length || settlement?.routeFingerprint)
  )
    return {
      ...money,
      chargedMicros: pricedUsage(route, usage.inputTokens, usage.outputTokens),
      state: "RECONCILED",
      routeFingerprint: route.fingerprint,
    };
  return { ...money, state: "UNKNOWN" };
}

export function gatewayLedger(runs: AgentRun[]) {
  return runs
    .filter((run) => run.attempt)
    .map((run) => ({
      requestId: run.id,
      profileId: run.route.profileId ?? "default",
      scope: run.route.scope ?? "personal",
      status: run.status,
      reservedAt: run.attempt!.reservedAt,
      settledAt: run.attempt!.settledAt,
      usage: run.attempt!.usage ?? null,
      money: run.attempt!.money ?? null,
    }));
}
