import { DomainError } from "@arclattice/domain";
import type {
  ModelProviderCapabilities,
  ProviderKind,
} from "./provider-adapter";

export type DailyRequestLimit =
  | { kind: "UNLIMITED" }
  | { kind: "LIMITED"; count: number };
export function dailyRequestLimit(value: unknown): DailyRequestLimit {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError("VALIDATION_ERROR");
  const input = value as Record<string, unknown>;
  if (input.kind === "UNLIMITED" && Object.keys(input).length === 1)
    return { kind: "UNLIMITED" };
  if (
    input.kind === "LIMITED" &&
    Object.keys(input).sort().join(",") === "count,kind" &&
    Number.isSafeInteger(input.count) &&
    Number(input.count) >= 1 &&
    Number(input.count) <= 1_000_000
  )
    return { kind: "LIMITED", count: Number(input.count) };
  throw new DomainError("VALIDATION_ERROR");
}
export interface ProviderConnection {
  id: string;
  name: string;
  kind: ProviderKind;
  endpoint: string;
  credentialRef: string;
  credentialConfigured: boolean;
}
export function requestLimitThreshold(route: {
  requestLimit?: DailyRequestLimit;
  gateway?: { dailyRequests: number | "UNLIMITED" };
  maxRunsPerDay: number;
}): number {
  if (route.requestLimit) {
    const limit = dailyRequestLimit(route.requestLimit);
    return limit.kind === "UNLIMITED" ? Number.POSITIVE_INFINITY : limit.count;
  }
  return route.gateway?.dailyRequests === "UNLIMITED"
    ? Number.POSITIVE_INFINITY
    : (route.gateway?.dailyRequests ?? route.maxRunsPerDay);
}
export interface ModelDefinition {
  id: string;
  connectionId: string;
  modelId: string;
  capabilities: ModelProviderCapabilities;
}
export interface ModelProfile {
  legacyScope?: string;
  enabled?: boolean;
  workload?: "TEXT" | "JSON" | "EMBEDDING";
  id: string;
  name: string;
  primaryModelId: string;
  fallbackModelIds: string[];
  requestLimit: DailyRequestLimit;
  budget: {
    currency: "USD";
    dailyMicros: number | "UNLIMITED";
    inputMicrosPerMillion: number;
    outputMicrosPerMillion: number;
  };
}
export interface ModelBinding {
  scope: "PERSONAL" | "PROJECT" | "SPACE";
  entityId: string | null;
  profileId: string;
}
export interface ModelConfiguration {
  version: number;
  connections: ProviderConnection[];
  models: ModelDefinition[];
  profiles: ModelProfile[];
  bindings: ModelBinding[];
}
export interface ModelConfigurationInput
  extends Omit<ModelConfiguration, "version"> {
  credentials: { connectionId: string; key: string }[];
}

/** Configuration validation without secrets or vendor HTTP in application logic. */
export function validateModelConfiguration(value: ModelConfigurationInput) {
  const object = (row: unknown) =>
    !!row && typeof row === "object" && !Array.isArray(row);
  if (!object(value)) throw new DomainError("VALIDATION_ERROR");
  const id = (value: string) =>
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
  const name = (value: string) =>
    typeof value === "string" && value.trim().length > 0 && value.length <= 240;
  const unique = (rows: readonly { id: string }[]) =>
    rows.every((row) => object(row) && id(row.id)) &&
    new Set(rows.map((row) => row.id)).size === rows.length;
  const integer = (amount: unknown) =>
    Number.isSafeInteger(amount) &&
    Number(amount) >= 0 &&
    Number(amount) <= 1_000_000_000_000;
  if (
    !Array.isArray(value.connections) ||
    value.connections.length > 50 ||
    !Array.isArray(value.models) ||
    value.models.length > 250 ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > 100 ||
    !Array.isArray(value.bindings) ||
    value.bindings.length > 500 ||
    !Array.isArray(value.credentials) ||
    value.credentials.length > 50 ||
    value.bindings.some((row) => !object(row)) ||
    value.credentials.some((row) => !object(row)) ||
    !unique(value.connections) ||
    !unique(value.models) ||
    !unique(value.profiles)
  )
    throw new DomainError("VALIDATION_ERROR");
  for (const connection of value.connections) {
    if (
      !name(connection.name) ||
      ![
        "OPENAI",
        "ANTHROPIC",
        "GEMINI",
        "DEEPSEEK",
        "OPENROUTER",
        "OLLAMA",
        "LM_STUDIO",
        "VLLM",
        "CUSTOM_OPENAI",
      ].includes(connection.kind) ||
      typeof connection.endpoint !== "string" ||
      !id(connection.credentialRef) ||
      typeof connection.credentialConfigured !== "boolean"
    )
      throw new DomainError("VALIDATION_ERROR");
  }
  const connectionIds = new Set(value.connections.map((row) => row.id)),
    modelIds = new Set(value.models.map((row) => row.id)),
    profileIds = new Set(value.profiles.map((row) => row.id));
  for (const model of value.models) {
    if (
      !connectionIds.has(model.connectionId) ||
      typeof model.modelId !== "string" ||
      !/^[a-zA-Z0-9._:/-]{1,160}$/.test(model.modelId) ||
      !model.capabilities ||
      Object.keys(model.capabilities).sort().join(",") !==
        "embedding,jsonSchema,streaming,tools,vision" ||
      Object.values(model.capabilities).some(
        (capability) => typeof capability !== "boolean",
      )
    )
      throw new DomainError("VALIDATION_ERROR");
  }
  for (const profile of value.profiles) {
    dailyRequestLimit(profile.requestLimit);
    if (
      (profile.enabled !== undefined && typeof profile.enabled !== "boolean") ||
      (profile.workload !== undefined &&
        !["TEXT", "JSON", "EMBEDDING"].includes(profile.workload))
    )
      throw new DomainError("VALIDATION_ERROR");
    if (
      !name(profile.name) ||
      !modelIds.has(profile.primaryModelId) ||
      !Array.isArray(profile.fallbackModelIds) ||
      profile.fallbackModelIds.length > 2 ||
      new Set([profile.primaryModelId, ...profile.fallbackModelIds]).size !==
        profile.fallbackModelIds.length + 1 ||
      profile.fallbackModelIds.some((modelId) => !modelIds.has(modelId)) ||
      !profile.budget ||
      Object.keys(profile.budget).sort().join(",") !==
        "currency,dailyMicros,inputMicrosPerMillion,outputMicrosPerMillion" ||
      profile.budget.currency !== "USD" ||
      (profile.budget.dailyMicros !== "UNLIMITED" &&
        !integer(profile.budget.dailyMicros)) ||
      !integer(profile.budget.inputMicrosPerMillion) ||
      !integer(profile.budget.outputMicrosPerMillion)
    )
      throw new DomainError("VALIDATION_ERROR");
  }
  const scopes = new Set<string>();
  for (const binding of value.bindings) {
    const target = `${binding.scope}:${binding.entityId ?? ""}`;
    if (
      !["PERSONAL", "PROJECT", "SPACE"].includes(binding.scope) ||
      (binding.scope === "PERSONAL"
        ? binding.entityId !== null
        : !name(binding.entityId ?? "")) ||
      !profileIds.has(binding.profileId) ||
      scopes.has(target)
    )
      throw new DomainError("VALIDATION_ERROR");
    scopes.add(target);
  }
  const keys = new Set<string>();
  for (const credential of value.credentials) {
    if (
      !connectionIds.has(credential.connectionId) ||
      keys.has(credential.connectionId) ||
      typeof credential.key !== "string" ||
      credential.key.length > 4096 ||
      /[\x00-\x20\x7f]/.test(credential.key)
    )
      throw new DomainError("VALIDATION_ERROR");
    keys.add(credential.connectionId);
  }
}
