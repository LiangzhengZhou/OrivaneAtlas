import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";
import type {
  ModelEvent,
  ModelPort,
  PersonalModelInput,
  PersonalModelSummary,
  PersonalModelVault,
} from "@arclattice/application";
import {
  matchesTrustedAiEndpoint,
  ProviderNotSentError,
  ProviderRequestError,
  providerFailure,
  type TrustedAiEndpoint,
  validateTrustedAiEndpoint,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import {
  ModelNotSentError,
  validateGatewayPolicy,
} from "../../application/src/gateway-policy";
import { decodeModelStream } from "./model-stream";
import { providerUsage } from "./model-usage";
import {
  configurationEntries,
  mergeLegacyProfile,
  migrateLegacyConfiguration,
  publicConfiguration,
  type StoredModelConfiguration,
  updateConfiguration,
} from "./provider-catalog";
import { providerHttpError, providerNetworkError } from "./provider-error";
import {
  createProviderAdapter,
  type ProviderHttpRequest,
} from "./provider-protocol";

const blocked = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, bits, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
for (const [address, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, bits, "ipv6");
export function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        global6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}
function trustedPrivateAddress(address: string) {
  const allowed = new BlockList();
  allowed.addSubnet("127.0.0.0", 8, "ipv4");
  allowed.addSubnet("10.0.0.0", 8, "ipv4");
  allowed.addSubnet("172.16.0.0", 12, "ipv4");
  allowed.addSubnet("192.168.0.0", 16, "ipv4");
  allowed.addAddress("::1", "ipv6");
  allowed.addSubnet("fc00::", 7, "ipv6");
  const family = isIP(address);
  return family === 4
    ? allowed.check(address, "ipv4")
    : family === 6 && allowed.check(address, "ipv6");
}
function canonicalProviderDestination(value: URL) {
  const url = new URL(value);
  if (url.hostname === "api.deepseek.com")
    url.pathname = url.pathname.replace(/^\/(?:v1\/)+/, "/");
  return url;
}
export function modelEndpoint(value: string, trusted = false) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError("VALIDATION_ERROR");
  }
  if (
    (url.protocol !== "https:" && !(trusted && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!trusted && url.port && url.port !== "443") ||
    url.href.length > 1000
  )
    throw new DomainError("VALIDATION_ERROR");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !trusted &&
    (host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      (!host.includes(".") && !isIP(host)) ||
      (isIP(host) && !publicAddress(host)))
  )
    throw new DomainError("VALIDATION_ERROR");
  url.pathname =
    url.pathname
      .replace(/\/(chat\/completions|responses|models|embeddings)\/?$/, "")
      .replace(/\/$/, "") + "/";
  // DeepSeek's optional /v1 alias resolves to its canonical API root.
  if (url.hostname === "api.deepseek.com" && /^\/(?:v1\/)+$/.test(url.pathname))
    url.pathname = "/";
  return url;
}
async function send(
  endpoint: URL,
  key: string,
  payload: unknown,
  signal: AbortSignal,
  trusted: () => boolean = () => false,
  protocol?: Pick<ProviderHttpRequest, "method" | "headers">,
): Promise<unknown> {
  endpoint = canonicalProviderDestination(endpoint);
  try {
    const destination = new URL(endpoint);
    destination.search = "";
    modelEndpoint(destination.href, trusted());
  } catch {
    throw new ModelNotSentError("MODEL_DESTINATION_REJECTED");
  }
  const host = endpoint.hostname.replace(/^\[|\]$/g, "");
  // Validate every answer, then pin one. TLS still verifies the original hostname.
  const answers = await lookup(host, { all: true, verbatim: true }).catch(
    (error: unknown) => {
      throw new ProviderNotSentError(
        providerNetworkError(error, signal).failure,
      );
    },
  );
  if (
    !answers.length ||
    answers.some(
      (a) =>
        !publicAddress(a.address) &&
        !(trusted() && trustedPrivateAddress(a.address)),
    ) ||
    signal.aborted
  )
    throw new ModelNotSentError("MODEL_DESTINATION_REJECTED");
  try {
    const destination = new URL(endpoint);
    destination.search = "";
    modelEndpoint(destination.href, trusted());
  } catch {
    throw new ModelNotSentError("MODEL_DESTINATION_REJECTED");
  }
  const address = answers[0]!;
  return new Promise((resolve, reject) => {
    const req = (endpoint.protocol === "http:" ? httpRequest : request)(
      endpoint,
      {
        method: protocol?.method ?? "POST",
        agent: false,
        family: address.family,
        signal,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
        headers: {
          "Content-Type": "application/json",
          ...(protocol ? protocol.headers : { Authorization: "Bearer " + key }),
        },
      },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.destroy();
          reject(providerHttpError(res.statusCode));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (part: Buffer) => {
          size += part.length;
          if (size > 1000000) {
            res.destroy(new Error("MODEL_RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(part);
        });
        res.on("error", (error) => reject(providerNetworkError(error, signal)));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(providerFailure("PROTOCOL_ERROR"));
          }
        });
      },
    );
    req.on("error", (error) => reject(providerNetworkError(error, signal)));
    req.end(protocol?.method === "GET" ? undefined : JSON.stringify(payload));
  });
}
async function* sendStream(
  endpoint: URL,
  key: string,
  payload: unknown,
  signal: AbortSignal,
  trusted: () => boolean = () => false,
): AsyncIterable<ModelEvent> {
  endpoint = canonicalProviderDestination(endpoint);
  try {
    modelEndpoint(endpoint.href, trusted());
  } catch {
    throw new ModelNotSentError("MODEL_DESTINATION_REJECTED");
  }
  const answers = await lookup(endpoint.hostname.replace(/^\[|\]$/g, ""), {
    all: true,
    verbatim: true,
  }).catch((error: unknown) => {
    throw new ProviderNotSentError(providerNetworkError(error, signal).failure);
  });
  if (
    !answers.length ||
    answers.some(
      (answer) =>
        !publicAddress(answer.address) &&
        !(trusted() && trustedPrivateAddress(answer.address)),
    ) ||
    signal.aborted
  )
    throw new ModelNotSentError("MODEL_DESTINATION_REJECTED");
  try {
    modelEndpoint(endpoint.href, trusted());
  } catch {
    throw new ModelNotSentError("MODEL_DESTINATION_REJECTED");
  }
  const address = answers[0]!;
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = (endpoint.protocol === "http:" ? httpRequest : request)(
      endpoint,
      {
        method: "POST",
        agent: false,
        family: address.family,
        signal,
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
      },
      (response) => {
        if (
          !response.statusCode ||
          response.statusCode < 200 ||
          response.statusCode >= 300 ||
          !response.headers["content-type"]?.startsWith("text/event-stream")
        ) {
          response.destroy();
          reject(providerHttpError(response.statusCode));
          return;
        }
        resolve(response);
      },
    );
    req.on("error", (error) => reject(providerNetworkError(error, signal)));
    req.end(JSON.stringify(payload));
  });
  try {
    yield* decodeModelStream(response);
  } finally {
    response.destroy();
  }
}

type Entry = PersonalModelInput & {
  owner: string;
  version: number;
  generation?: string;
};
const owner = (actor: ActorContext) =>
  JSON.stringify([actor.workspaceId, actor.principalId]);
function summary(entry: Entry): PersonalModelSummary {
  const { key, owner: identity, generation: _generation, ...safe } = entry;
  return {
    ...structuredClone(safe),
    route: {
      ...(entry.gateway ? { gateway: structuredClone(entry.gateway) } : {}),
      ...(entry.profileId ? { profileId: entry.profileId } : {}),
      scope: entry.scope,
      ...(entry.requestLimit ? { requestLimit: entry.requestLimit } : {}),
      ...(entry.quotaKey ? { quotaKey: entry.quotaKey } : {}),
      ...(entry.legacyQuotaScope
        ? { legacyQuotaScope: entry.legacyQuotaScope }
        : {}),
      provider: entry.endpoint,
      model: entry.model,
      maxInputChars: 32000,
      maxOutputTokens: 4096,
      timeoutMs: 60000,
      maxRunsPerDay: entry.maxRunsPerDay,
      fingerprint: createHash("sha256")
        .update(
          JSON.stringify([identity, entry], (_key, value) =>
            value && typeof value === "object" && !Array.isArray(value)
              ? Object.fromEntries(
                  Object.entries(value).sort(([left], [right]) =>
                    left.localeCompare(right),
                  ),
                )
              : value,
          ),
        )
        .digest("hex"),
    },
  };
}
function privatePath(path: string, directory = false) {
  const info = lstatSync(path);
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    (process.platform !== "win32" && (info.mode & 0o077) !== 0)
  )
    throw new Error("VAULT_PERMISSIONS");
}
/** One host process; synchronous atomic commit keeps authorization and vault mutation indivisible. */
export function openPersonalVault(directory: string): PersonalModelVault {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privatePath(directory, true);
  const masterPath = join(directory, "master.key"),
    dataPath = join(directory, "providers.enc");
  if (!existsSync(masterPath)) {
    if (existsSync(dataPath)) throw new Error("VAULT_MASTER_MISSING");
    writeFileSync(masterPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    const fd = openSync(masterPath, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (process.platform !== "win32") {
      const directoryFd = openSync(directory, "r");
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    }
  }
  privatePath(masterPath);
  const master = readFileSync(masterPath);
  if (master.length !== 32) throw new Error("VAULT_MASTER_INVALID");
  let entries: Entry[] = [];
  let configurations: StoredModelConfiguration[] = [];
  let trustedEndpoints: readonly TrustedAiEndpoint[] = [];
  if (existsSync(dataPath)) {
    privatePath(dataPath);
    const data = readFileSync(dataPath);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      master,
      data.subarray(0, 12),
    );
    decipher.setAuthTag(data.subarray(12, 28));
    const decoded = JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (Array.isArray(decoded)) entries = decoded;
    else {
      if (
        decoded.format !== 2 ||
        !Array.isArray(decoded.entries) ||
        !Array.isArray(decoded.configurations)
      )
        throw new Error("VAULT_FORMAT_INVALID");
      configurations = decoded.configurations;
      entries = decoded.entries.map(
        (stored: Omit<Entry, "key"> & { credentialRef: string }) => {
          const configuration = configurations.find(
            (row) => row.owner === stored.owner,
          );
          const credential = configuration?.credentials.find(
            (row) => row.connectionId === stored.credentialRef,
          );
          if (!credential) throw new Error("VAULT_CREDENTIAL_MISSING");
          const { credentialRef: _reference, ...entry } = stored;
          return { ...entry, key: credential.key };
        },
      );
    }
  }
  function commit(next: Entry[], supplied = configurations) {
    const nextConfigurations = supplied.filter(
      (configuration) => configuration.version > 0,
    );
    for (const identity of new Set(next.map((entry) => entry.owner))) {
      if (
        !nextConfigurations.some(
          (configuration) => configuration.owner === identity,
        )
      )
        nextConfigurations.push(migrateLegacyConfiguration(identity, next));
    }
    const storedEntries = next.map((entry) => {
      const configuration = nextConfigurations.find(
        (row) => row.owner === entry.owner,
      )!;
      const connection = configuration.connections.find(
        (connection) =>
          connection.endpoint === entry.endpoint &&
          configuration.credentials.some(
            (credential) =>
              credential.connectionId === connection.id &&
              credential.key === entry.key,
          ),
      );
      if (!connection) throw new Error("VAULT_CREDENTIAL_MISSING");
      const { key: _key, ...safe } = entry;
      return { ...safe, credentialRef: connection.id };
    });
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", master, iv);
    const body = Buffer.concat([
      cipher.update(
        JSON.stringify({
          format: 2,
          entries: storedEntries,
          configurations: nextConfigurations,
        }),
        "utf8",
      ),
      cipher.final(),
    ]);
    const temp = join(directory, "pending-" + randomUUID() + ".enc");
    writeFileSync(temp, Buffer.concat([iv, cipher.getAuthTag(), body]), {
      flag: "wx",
      mode: 0o600,
    });
    const fd = openSync(temp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, dataPath);
    entries = next;
    configurations = nextConfigurations;
    if (process.platform !== "win32") {
      const directoryFd = openSync(directory, "r");
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    }
  }
  function registeredSummary(entry: Entry): PersonalModelSummary {
    const result = summary(entry);
    if (!entry.gateway?.fallbackProfileIds.length) return result;
    const alternatives = entry.gateway.fallbackProfileIds.map((profileId) =>
      entries.find(
        (candidate) =>
          candidate.owner === entry.owner &&
          candidate.scope === entry.scope &&
          (candidate.profileId ?? "default") === profileId,
      ),
    );
    result.route.fallbackRoutes = alternatives.flatMap((candidate) =>
      candidate ? [summary(candidate).route] : [],
    );
    result.route.fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          result.route.fingerprint,
          alternatives.map((candidate) =>
            candidate ? summary(candidate).route.fingerprint : null,
          ),
        ]),
      )
      .digest("hex");
    return result;
  }
  const vault: PersonalModelVault = {
    setTrustedEndpoints: (entries) => {
      trustedEndpoints = entries.map(validateTrustedAiEndpoint);
    },
    configuration(actor) {
      return publicConfiguration(
        configurations.find((row) => row.owner === owner(actor)) ??
          migrateLegacyConfiguration(owner(actor), entries),
      );
    },
    saveConfiguration(actor, version, input) {
      const previous =
        configurations.find((row) => row.owner === owner(actor)) ??
        migrateLegacyConfiguration(owner(actor), entries);
      if (previous.version !== version)
        throw new DomainError("VERSION_CONFLICT");
      const next = updateConfiguration(previous, input);
      for (const connection of next.connections) {
        connection.endpoint = modelEndpoint(
          connection.endpoint,
          matchesTrustedAiEndpoint(
            trustedEndpoints,
            actor.workspaceId,
            connection.endpoint,
          ),
        ).href;
        if (
          !connection.credentialConfigured &&
          !["OLLAMA", "LM_STUDIO", "VLLM"].includes(connection.kind)
        )
          throw new DomainError("VALIDATION_ERROR");
      }
      commit(
        [
          ...entries.filter((entry) => entry.owner !== owner(actor)),
          ...configurationEntries(next),
        ],
        [...configurations.filter((row) => row.owner !== owner(actor)), next],
      );
      return publicConfiguration(next);
    },
    connectionAdapter(actor, connectionId) {
      const configuration =
        configurations.find((row) => row.owner === owner(actor)) ??
        migrateLegacyConfiguration(owner(actor), entries);
      const connection = configuration.connections.find(
        (row) => row.id === connectionId,
      );
      if (!connection) throw new DomainError("NOT_FOUND");
      const key =
        configuration.credentials.find(
          (row) => row.connectionId === connectionId,
        )?.key ?? "";
      return createProviderAdapter(
        connection.kind,
        configuration.models.find(
          (model) => model.connectionId === connectionId,
        )?.modelId ?? "connection-probe",
        key,
        async (request, signal) => {
          try {
            return await send(
              new URL(request.path, connection.endpoint),
              key,
              request.body,
              signal,
              () =>
                matchesTrustedAiEndpoint(
                  trustedEndpoints,
                  actor.workspaceId,
                  connection.endpoint,
                ),
              request,
            );
          } catch (error) {
            if (error instanceof ProviderRequestError)
              throw new ProviderRequestError({
                ...error.failure,
                provider: connection.kind,
              });
            if (error instanceof ProviderNotSentError)
              throw new ProviderNotSentError({
                ...error.failure,
                provider: connection.kind,
              });
            throw error;
          }
        },
        { maxOutputTokens: 128 },
      );
    },
    async testConnection(actor, connectionId, signal) {
      const adapter = vault.connectionAdapter!(actor, connectionId);
      try {
        await adapter.listModels(signal);
        return { connected: true, discovery: "AVAILABLE" };
      } catch (error) {
        if (
          !(error instanceof ProviderRequestError) ||
          ![404, 405].includes(error.failure.status ?? 0)
        )
          throw error;
        const configuration = vault.configuration!(actor);
        if (
          !configuration.models.some(
            (model) => model.connectionId === connectionId,
          )
        )
          throw providerFailure("UNSUPPORTED_DISCOVERY", error.failure.status);
        await adapter.complete("Reply OK.", signal);
        return { connected: true, discovery: "UNSUPPORTED" };
      }
    },
    list: (actor) =>
      entries.filter((e) => e.owner === owner(actor)).map(registeredSummary),
    save(actor, version, input) {
      if (
        input.providerKind !== undefined &&
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
        ].includes(input.providerKind)
      )
        throw new DomainError("VALIDATION_ERROR");
      if (
        input.modelCapabilities !== undefined &&
        (typeof input.modelCapabilities !== "object" ||
          input.modelCapabilities === null ||
          Object.entries(input.modelCapabilities).some(
            ([name, value]) =>
              ![
                "tools",
                "jsonSchema",
                "vision",
                "streaming",
                "embedding",
              ].includes(name) || typeof value !== "boolean",
          ))
      )
        throw new DomainError("VALIDATION_ERROR");
      const endpoint = modelEndpoint(
        input.endpoint,
        matchesTrustedAiEndpoint(
          trustedEndpoints,
          actor.workspaceId,
          input.endpoint,
        ),
      ).href;
      if (
        input.supportsStreaming !== undefined &&
        typeof input.supportsStreaming !== "boolean"
      )
        throw new DomainError("VALIDATION_ERROR");
      const gateway =
        input.gateway === undefined
          ? undefined
          : validateGatewayPolicy(input.gateway);
      if (
        gateway &&
        (gateway.fallbackProfileIds.includes(input.profileId ?? "default") ||
          entries.some(
            (candidate) =>
              candidate.owner === owner(actor) &&
              candidate.gateway?.providerId === gateway.providerId &&
              candidate.endpoint !== endpoint &&
              !(
                candidate.scope === input.scope &&
                (candidate.profileId ?? "default") ===
                  (input.profileId ?? "default")
              ),
          ) ||
          gateway.fallbackProfileIds.some(
            (profileId) =>
              !entries.some(
                (candidate) =>
                  candidate.owner === owner(actor) &&
                  candidate.scope === input.scope &&
                  (candidate.profileId ?? "default") === profileId &&
                  candidate.gateway?.enabled &&
                  candidate.gateway.capability === gateway.capability,
              ),
          ))
      )
        throw new DomainError("VALIDATION_ERROR");
      if (
        (input.profileId !== undefined &&
          (typeof input.profileId !== "string" ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(input.profileId))) ||
        !["chat", "responses"].includes(input.protocol) ||
        !input.scope ||
        input.scope.length > 240 ||
        !/^[a-zA-Z0-9._:/-]{1,160}$/.test(input.model) ||
        !Number.isInteger(input.maxRunsPerDay) ||
        input.maxRunsPerDay < 1 ||
        input.maxRunsPerDay > 100 ||
        typeof input.key !== "string" ||
        input.key.length > 4096 ||
        /[\x00-\x20\x7f]/.test(input.key)
      )
        throw new DomainError("VALIDATION_ERROR");
      const old = entries.find(
        (e) =>
          e.owner === owner(actor) &&
          e.scope === input.scope &&
          (e.profileId ?? "default") === (input.profileId ?? "default"),
      );
      if ((old?.version ?? 0) !== version)
        throw new DomainError("VERSION_CONFLICT");
      if (!old && entries.filter((e) => e.owner === owner(actor)).length >= 50)
        throw new DomainError("VALIDATION_ERROR");
      const key = input.key || old?.key || "";
      if (
        !key &&
        !["OLLAMA", "LM_STUDIO", "VLLM"].includes(input.providerKind ?? "")
      )
        throw new DomainError("VALIDATION_ERROR");
      const entry = {
        ...input,
        ...(gateway ? { gateway } : {}),
        endpoint,
        key,
        owner: owner(actor),
        generation: old?.generation ?? randomUUID(),
        version: version + 1,
      };
      const nextEntries = [...entries.filter((e) => e !== old), entry];
      const published = configurations.find(
        (configuration) =>
          configuration.owner === owner(actor) && configuration.version > 0,
      );
      if (published) {
        const next = mergeLegacyProfile(published, entry, nextEntries);
        commit(
          [
            ...entries.filter((row) => row.owner !== owner(actor)),
            ...configurationEntries(next),
          ],
          [...configurations.filter((row) => row.owner !== owner(actor)), next],
        );
      } else commit(nextEntries);
      return registeredSummary(
        entries.find(
          (row) =>
            row.owner === entry.owner &&
            row.scope === entry.scope &&
            (row.profileId ?? "default") === (entry.profileId ?? "default"),
        ) ?? entry,
      );
    },
    remove(actor, scope, version, profileId = "default") {
      const old = entries.find(
        (e) =>
          e.owner === owner(actor) &&
          e.scope === scope &&
          (e.profileId ?? "default") === profileId,
      );
      if (!old || old.version !== version)
        throw new DomainError("VERSION_CONFLICT");
      const published = configurations.find(
        (configuration) =>
          configuration.owner === owner(actor) && configuration.version > 0,
      );
      if (published) {
        const next = structuredClone(published);
        next.version++;
        if (profileId === "default") {
          next.bindings = next.bindings.filter(
            (binding) =>
              (binding.scope === "PERSONAL"
                ? "personal"
                : `${binding.scope === "PROJECT" ? "WORK" : "SPACE"}:${binding.entityId}`) !==
              scope,
          );
        } else {
          if (
            next.bindings.some((binding) => binding.profileId === profileId) ||
            profileId.startsWith("fb_")
          )
            throw new DomainError("FORBIDDEN");
          next.profiles = next.profiles.filter(
            (profile) => profile.id !== profileId,
          );
        }
        commit(
          [
            ...entries.filter((row) => row.owner !== owner(actor)),
            ...configurationEntries(next),
          ],
          [...configurations.filter((row) => row.owner !== owner(actor)), next],
        );
      } else commit(entries.filter((e) => e !== old));
    },
    resolve(actor, scope, profileId = "default"): ModelPort | null {
      const entry = entries.find(
        (e) =>
          e.owner === owner(actor) &&
          e.scope === scope &&
          (e.profileId ?? "default") === profileId,
      );
      if (!entry) return null;
      if (entry.gateway?.enabled === false) return null;
      const route = registeredSummary(entry).route;
      const alternatives =
        entry.gateway?.fallbackProfileIds.map((profile) =>
          entries.find(
            (candidate) =>
              candidate.owner === entry.owner &&
              candidate.scope === entry.scope &&
              (candidate.profileId ?? "default") === profile,
          ),
        ) ?? [];
      if (
        alternatives.some(
          (candidate) =>
            !candidate?.gateway?.enabled ||
            candidate.gateway.capability !== entry.gateway?.capability,
        )
      )
        return null;
      const build = (entry: Entry, route: ModelPort["route"]): ModelPort => {
        const port: ModelPort = {
          route,
          async complete(prompt, signal, reportUsage) {
            const embedding = route.gateway?.capability === "EMBEDDING";
            const endpoint = new URL(
              embedding
                ? "embeddings"
                : entry.protocol === "chat"
                  ? "chat/completions"
                  : "responses",
              entry.endpoint,
            );
            const data = (await send(
              endpoint,
              entry.key,
              embedding
                ? {
                    model: entry.model,
                    input: prompt,
                    encoding_format: "float",
                  }
                : entry.protocol === "chat"
                  ? {
                      model: entry.model,
                      messages: [{ role: "user", content: prompt }],
                      max_completion_tokens: route.maxOutputTokens,
                      store: false,
                      stream: false,
                      ...(route.gateway?.capability === "JSON"
                        ? { response_format: { type: "json_object" } }
                        : {}),
                    }
                  : {
                      model: entry.model,
                      input: prompt,
                      max_output_tokens: route.maxOutputTokens,
                      store: false,
                      stream: false,
                      ...(route.gateway?.capability === "JSON"
                        ? { text: { format: { type: "json_object" } } }
                        : {}),
                    },
              signal,
              () =>
                matchesTrustedAiEndpoint(
                  trustedEndpoints,
                  actor.workspaceId,
                  entry.endpoint,
                ),
            )) as {
              data?: { embedding?: unknown }[];
              usage?: unknown;
              choices?: {
                message?: { content?: string; tool_calls?: unknown[] };
              }[];
              output?: {
                type: string;
                content?: { type: string; text?: string }[];
              }[];
            };
            const usage = providerUsage(data.usage, embedding);
            if (usage) reportUsage?.(usage);
            if (embedding) {
              const vector = data.data?.[0]?.embedding;
              if (
                data.data?.length !== 1 ||
                !Array.isArray(vector) ||
                !vector.length ||
                vector.length > 32768 ||
                !vector.every(
                  (value) =>
                    typeof value === "number" && Number.isFinite(value),
                )
              )
                throw new Error("MODEL_RESPONSE_INVALID");
              const artifact = JSON.stringify({ embedding: vector });
              if (artifact.length > 100000)
                throw new Error("MODEL_RESPONSE_INVALID");
              return artifact;
            }
            if (
              data.choices?.[0]?.message?.tool_calls?.length ||
              data.output?.some(
                (o) => o.type !== "message" && o.type !== "reasoning",
              )
            )
              throw new Error("MODEL_TOOLS_NOT_ALLOWED");
            const text =
              entry.protocol === "chat"
                ? data.choices?.[0]?.message?.content
                : data.output
                    ?.filter((o) => o.type === "message")
                    .flatMap(
                      (o) =>
                        o.content
                          ?.filter((c) => c.type === "output_text")
                          .map((c) => c.text ?? "") ?? [],
                    )
                    .join("\n");
            if (typeof text !== "string" || !text || text.length > 100000)
              throw new Error("MODEL_RESPONSE_INVALID");
            if (route.gateway?.capability === "JSON") JSON.parse(text);
            return text;
          },
        };
        if (entry.providerKind) {
          const adapter = createProviderAdapter(
            entry.providerKind,
            entry.model,
            entry.key,
            (request, signal) =>
              send(
                new URL(request.path, entry.endpoint),
                entry.key,
                request.body,
                signal,
                () =>
                  matchesTrustedAiEndpoint(
                    trustedEndpoints,
                    actor.workspaceId,
                    entry.endpoint,
                  ),
                request,
              ),
            {
              maxOutputTokens: route.maxOutputTokens,
              ...(entry.modelCapabilities
                ? { capabilities: entry.modelCapabilities }
                : {}),
            },
          );
          return {
            ...port,
            complete: adapter.complete.bind(adapter),
            providerAdapter: adapter,
          };
        }
        return {
          ...port,
          providerAdapter: {
            capabilities: {
              tools: false,
              jsonSchema: false,
              vision: false,
              streaming:
                route.gateway?.capability !== "EMBEDDING" &&
                entry.supportsStreaming !== false,
              embedding: route.gateway?.capability === "EMBEDDING",
            },
            complete: (prompt, signal, reportUsage) =>
              port.complete(prompt, signal, reportUsage),
            ...(route.gateway?.capability === "EMBEDDING"
              ? {
                  async embed(texts: readonly string[], signal: AbortSignal) {
                    if (!texts.length || texts.length > 100)
                      throw new ModelNotSentError("MODEL_INPUT_LIMIT");
                    const vectors: number[][] = [];
                    for (const text of texts) {
                      const artifact = JSON.parse(
                        await port.complete(text, signal),
                      ) as { embedding: number[] };
                      vectors.push(artifact.embedding);
                    }
                    return vectors;
                  },
                }
              : {}),
            async *stream(prompt, signal) {
              if (route.gateway?.capability === "EMBEDDING")
                throw new ModelNotSentError("STREAMING_NOT_SUPPORTED");
              const endpoint = new URL(
                entry.protocol === "chat" ? "chat/completions" : "responses",
                entry.endpoint,
              );
              const payload =
                entry.protocol === "chat"
                  ? {
                      model: entry.model,
                      messages: [{ role: "user", content: prompt }],
                      max_completion_tokens: route.maxOutputTokens,
                      store: false,
                      stream: true,
                      stream_options: { include_usage: true },
                      ...(route.gateway?.capability === "JSON"
                        ? { response_format: { type: "json_object" } }
                        : {}),
                    }
                  : {
                      model: entry.model,
                      input: prompt,
                      max_output_tokens: route.maxOutputTokens,
                      store: false,
                      stream: true,
                      ...(route.gateway?.capability === "JSON"
                        ? { text: { format: { type: "json_object" } } }
                        : {}),
                    };
              yield* sendStream(endpoint, entry.key, payload, signal, () =>
                matchesTrustedAiEndpoint(
                  trustedEndpoints,
                  actor.workspaceId,
                  entry.endpoint,
                ),
              );
            },
            listModels: async () => [entry.model],
          },
        };
      };
      return {
        ...build(entry, route),
        ...(alternatives.length
          ? {
              fallbacks: alternatives.map((candidate) =>
                build(candidate!, summary(candidate!).route),
              ),
            }
          : {}),
      };
    },
  };
  return vault;
}
