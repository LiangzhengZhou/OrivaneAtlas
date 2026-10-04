import { createHash } from "node:crypto";
import type {
  ModelConfiguration,
  ModelConfigurationInput,
  PersonalModelInput,
} from "@arclattice/application";
import { validateModelConfiguration } from "@arclattice/application";

export interface VaultLegacyEntry extends PersonalModelInput {
  owner: string;
  version: number;
  generation?: string;
}
export interface StoredModelConfiguration extends ModelConfiguration {
  owner: string;
  credentials: { connectionId: string; key: string }[];
  legacyModels: {
    modelId: string;
    protocol: "chat" | "responses";
    supportsStreaming?: boolean;
  }[];
}
const identity = (prefix: string, values: unknown[]) =>
  prefix +
  createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex")
    .slice(0, 32);
export function emptyConfiguration(owner: string): StoredModelConfiguration {
  return {
    owner,
    version: 0,
    connections: [],
    models: [],
    profiles: [],
    bindings: [],
    credentials: [],
    legacyModels: [],
  };
}
/** Lossless old encrypted payload migration; credentials occur once per connection. */
export function migrateLegacyConfiguration(
  owner: string,
  entries: readonly VaultLegacyEntry[],
): StoredModelConfiguration {
  const result = emptyConfiguration(owner),
    owned = entries.filter((entry) => entry.owner === owner);
  const modelByEntry = new Map<VaultLegacyEntry, string>();
  for (const entry of owned) {
    const connectionId = identity("c_", [
      owner,
      entry.endpoint,
      entry.key,
      entry.providerKind ?? "CUSTOM_OPENAI",
    ]);
    // Legacy profiles may intentionally route to the same remote model with different
    // protocol/capability settings. Preserve their fallback slots without copying keys.
    const modelId = identity("m_", [
      connectionId,
      entry.model,
      entry.protocol,
      entry.scope,
      entry.profileId ?? "default",
    ]);
    if (
      !result.connections.some((connection) => connection.id === connectionId)
    ) {
      result.connections.push({
        id: connectionId,
        name: new URL(entry.endpoint).hostname,
        kind: entry.providerKind ?? "CUSTOM_OPENAI",
        endpoint: entry.endpoint,
        credentialRef: connectionId,
        credentialConfigured: !!entry.key,
      });
      result.credentials.push({ connectionId, key: entry.key });
    }
    if (!result.models.some((model) => model.id === modelId)) {
      result.models.push({
        id: modelId,
        connectionId,
        modelId: entry.model,
        capabilities: {
          tools: false,
          jsonSchema: false,
          vision: false,
          streaming: entry.supportsStreaming !== false,
          embedding: entry.gateway?.capability === "EMBEDDING",
          ...entry.modelCapabilities,
        },
      });
      if (!entry.providerKind)
        result.legacyModels.push({
          modelId,
          protocol: entry.protocol,
          ...(entry.supportsStreaming === undefined
            ? {}
            : { supportsStreaming: entry.supportsStreaming }),
        });
    }
    modelByEntry.set(entry, modelId);
  }
  for (const entry of owned) {
    const profileId = identity("p_", [
      owner,
      entry.scope,
      entry.profileId ?? "default",
    ]);
    const limit = entry.gateway?.dailyRequests ?? entry.maxRunsPerDay;
    result.profiles.push({
      id: profileId,
      name: entry.profileId ?? "Default profile",
      primaryModelId: modelByEntry.get(entry)!,
      fallbackModelIds: (entry.gateway?.fallbackProfileIds ?? []).flatMap(
        (id) => {
          const fallback = owned.find(
            (candidate) =>
              candidate.scope === entry.scope &&
              (candidate.profileId ?? "default") === id,
          );
          return fallback ? [modelByEntry.get(fallback)!] : [];
        },
      ),
      requestLimit:
        limit === "UNLIMITED"
          ? { kind: "UNLIMITED" }
          : { kind: "LIMITED", count: limit },
      budget: {
        currency: "USD",
        dailyMicros: entry.gateway?.dailyBudgetMicros ?? "UNLIMITED",
        inputMicrosPerMillion: entry.gateway?.inputMicrosPerMillion ?? 0,
        outputMicrosPerMillion: entry.gateway?.outputMicrosPerMillion ?? 0,
      },
      legacyScope: entry.scope,
      enabled: entry.gateway?.enabled ?? true,
      workload: entry.gateway?.capability ?? "TEXT",
    });
    if ((entry.profileId ?? "default") === "default")
      result.bindings.push({
        scope:
          entry.scope === "personal"
            ? "PERSONAL"
            : entry.scope.startsWith("SPACE:")
              ? "SPACE"
              : "PROJECT",
        entityId:
          entry.scope === "personal"
            ? null
            : entry.scope.slice(entry.scope.indexOf(":") + 1),
        profileId,
      });
  }
  return result;
}
export function publicConfiguration(
  stored: StoredModelConfiguration,
): ModelConfiguration {
  const {
    owner: _owner,
    credentials: _credentials,
    legacyModels: _legacyModels,
    ...safe
  } = stored;
  return structuredClone(safe);
}
/** Deprecated input writes update one profile without replacing unrelated connections. */
export function mergeLegacyProfile(
  previous: StoredModelConfiguration,
  entry: VaultLegacyEntry,
  allEntries: readonly VaultLegacyEntry[],
): StoredModelConfiguration {
  const imported = migrateLegacyConfiguration(previous.owner, allEntries);
  const importedId = identity("p_", [
    previous.owner,
    entry.scope,
    entry.profileId ?? "default",
  ]);
  const source = imported.profiles.find(
    (profile) => profile.id === importedId,
  )!;
  const scope =
    entry.scope === "personal"
      ? "PERSONAL"
      : entry.scope.startsWith("SPACE:")
        ? "SPACE"
        : "PROJECT";
  const entityId =
    entry.scope === "personal"
      ? null
      : entry.scope.slice(entry.scope.indexOf(":") + 1);
  const binding = previous.bindings.find(
    (binding) => binding.scope === scope && binding.entityId === entityId,
  );
  const current =
    (entry.profileId ?? "default") === "default"
      ? previous.profiles.find((profile) => profile.id === binding?.profileId)
      : previous.profiles.find((profile) => profile.id === entry.profileId);
  const next = structuredClone(previous);
  next.version++;
  const importedModels = [source.primaryModelId, ...source.fallbackModelIds];
  const mapped = new Map<string, string>();
  for (const sourceId of importedModels) {
    const model = imported.models.find((model) => model.id === sourceId)!,
      connection = imported.connections.find(
        (connection) => connection.id === model.connectionId,
      )!;
    const key = imported.credentials.find(
      (credential) => credential.connectionId === connection.id,
    )!.key;
    let existingConnection = next.connections.find(
      (row) =>
        row.endpoint === connection.endpoint &&
        row.kind === connection.kind &&
        next.credentials.some(
          (credential) =>
            credential.connectionId === row.id && credential.key === key,
        ),
    );
    if (!existingConnection) {
      next.connections.push(connection);
      next.credentials.push({ connectionId: connection.id, key });
      existingConnection = connection;
    }
    let existingModel = next.models.find(
      (row) =>
        row.connectionId === existingConnection!.id &&
        row.modelId === model.modelId,
    );
    if (!existingModel) {
      existingModel = { ...model, connectionId: existingConnection.id };
      next.models.push(existingModel);
      const legacy = imported.legacyModels.find(
        (row) => row.modelId === model.id,
      );
      if (legacy) next.legacyModels.push(legacy);
    }
    mapped.set(sourceId, existingModel.id);
  }
  const profile = {
    ...source,
    id: current?.id ?? source.id,
    name: current?.name ?? source.name,
    primaryModelId: mapped.get(source.primaryModelId)!,
    fallbackModelIds: source.fallbackModelIds.map((id) => mapped.get(id)!),
  };
  next.profiles = [
    ...next.profiles.filter((row) => row.id !== profile.id),
    profile,
  ];
  if ((entry.profileId ?? "default") === "default")
    next.bindings = [
      ...next.bindings.filter(
        (row) => row.scope !== scope || row.entityId !== entityId,
      ),
      { scope, entityId, profileId: profile.id },
    ];
  return next;
}
export function updateConfiguration(
  previous: StoredModelConfiguration,
  input: ModelConfigurationInput,
): StoredModelConfiguration {
  validateModelConfiguration(input);
  const keys = new Map(
    previous.credentials.map((credential) => [
      credential.connectionId,
      credential.key,
    ]),
  );
  for (const credential of input.credentials)
    if (credential.key) keys.set(credential.connectionId, credential.key);
  const credentials = input.connections.map((connection) => ({
    connectionId: connection.id,
    key: keys.get(connection.id) ?? "",
  }));
  return {
    owner: previous.owner,
    version: previous.version + 1,
    connections: structuredClone(input.connections).map((connection) => ({
      ...connection,
      credentialRef: connection.id,
      credentialConfigured: !!keys.get(connection.id),
    })),
    models: structuredClone(input.models),
    profiles: structuredClone(input.profiles).map((profile) => {
      const { legacyScope: _input, ...safe } = profile;
      const prior = previous.profiles.find((row) => row.id === profile.id);
      return {
        ...safe,
        ...(prior?.legacyScope ? { legacyScope: prior.legacyScope } : {}),
      };
    }),
    bindings: structuredClone(input.bindings),
    credentials,
    legacyModels: previous.legacyModels.filter((legacy) =>
      input.models.some((model) => model.id === legacy.modelId),
    ),
  };
}
/** Compatibility projection only; this is never serialized with per-profile keys. */
export function configurationEntries(
  stored: StoredModelConfiguration,
): VaultLegacyEntry[] {
  const entries: VaultLegacyEntry[] = [];
  const modelById = new Map(stored.models.map((model) => [model.id, model]));
  const connections = new Map(
    stored.connections.map((connection) => [connection.id, connection]),
  );
  for (const profile of stored.profiles) {
    const scopes = [
      "personal",
      ...stored.bindings
        .filter(
          (binding) =>
            binding.profileId === profile.id && binding.scope !== "PERSONAL",
        )
        .map(
          (binding) =>
            `${binding.scope === "PROJECT" ? "WORK" : "SPACE"}:${binding.entityId}`,
        ),
    ];
    for (const scope of scopes) {
      const append = (
        modelId: string,
        profileId: string,
        fallbackProfileIds: string[],
      ) => {
        const model = modelById.get(modelId)!,
          connection = connections.get(model.connectionId)!;
        const legacy = stored.legacyModels.find(
          (row) => row.modelId === modelId,
        );
        entries.push({
          owner: stored.owner,
          version: stored.version,
          generation: identity("g_", [
            stored.owner,
            stored.version,
            profile.id,
            modelId,
          ]),
          scope,
          profileId,
          endpoint: connection.endpoint,
          protocol: legacy?.protocol ?? "chat",
          model: model.modelId,
          key:
            stored.credentials.find((key) => key.connectionId === connection.id)
              ?.key ?? "",
          maxRunsPerDay:
            profile.requestLimit.kind === "UNLIMITED"
              ? Number.MAX_SAFE_INTEGER
              : profile.requestLimit.count,
          requestLimit: profile.requestLimit,
          quotaKey: profile.id,
          ...(profile.legacyScope
            ? { legacyQuotaScope: profile.legacyScope }
            : {}),
          ...(legacy
            ? { supportsStreaming: legacy.supportsStreaming ?? true }
            : {
                providerKind: connection.kind,
                modelCapabilities: model.capabilities,
              }),
          gateway: {
            providerId: connection.id,
            enabled: profile.enabled ?? true,
            capabilities: [profile.workload ?? "TEXT"],
            capability: profile.workload ?? "TEXT",
            dailyRequests:
              profile.requestLimit.kind === "UNLIMITED"
                ? "UNLIMITED"
                : profile.requestLimit.count,
            dailyBudgetMicros: profile.budget.dailyMicros,
            currency: "USD",
            inputMicrosPerMillion: profile.budget.inputMicrosPerMillion,
            outputMicrosPerMillion: profile.budget.outputMicrosPerMillion,
            fallbackProfileIds,
          },
        });
      };
      const fallbackIds = profile.fallbackModelIds.map((modelId) =>
        identity("fb_", [profile.id, modelId]),
      );
      append(profile.primaryModelId, profile.id, fallbackIds);
      if (
        stored.bindings.some(
          (binding) =>
            binding.profileId === profile.id &&
            (binding.scope === "PERSONAL"
              ? "personal"
              : `${binding.scope === "PROJECT" ? "WORK" : "SPACE"}:${binding.entityId}`) ===
              scope,
        )
      )
        append(profile.primaryModelId, "default", fallbackIds);
      profile.fallbackModelIds.forEach((modelId, index) =>
        append(modelId, fallbackIds[index]!, []),
      );
    }
  }
  return entries;
}
