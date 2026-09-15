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
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";
import type {
  ModelPort,
  PersonalModelInput,
  PersonalModelSummary,
  PersonalModelVault,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";

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
export function modelEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError("VALIDATION_ERROR");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    url.href.length > 1000
  )
    throw new DomainError("VALIDATION_ERROR");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (!host.includes(".") && !isIP(host)) ||
    (isIP(host) && !publicAddress(host))
  )
    throw new DomainError("VALIDATION_ERROR");
  url.pathname =
    url.pathname
      .replace(/\/(chat\/completions|responses|models)\/?$/, "")
      .replace(/\/$/, "") + "/";
  return url;
}
async function send(
  endpoint: URL,
  key: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const host = endpoint.hostname.replace(/^\[|\]$/g, "");
  // Validate every answer, then pin one. TLS still verifies the original hostname.
  const answers = await lookup(host, { all: true, verbatim: true });
  if (
    !answers.length ||
    answers.some((a) => !publicAddress(a.address)) ||
    signal.aborted
  )
    throw new Error("MODEL_DESTINATION_REJECTED");
  const address = answers[0]!;
  return new Promise((resolve, reject) => {
    const req = request(
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
        },
      },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.destroy();
          reject(new Error("MODEL_REQUEST_FAILED"));
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
        res.on("error", reject);
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("MODEL_RESPONSE_INVALID"));
          }
        });
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(payload));
  });
}
type Entry = PersonalModelInput & { owner: string; version: number };
const owner = (actor: ActorContext) =>
  JSON.stringify([actor.workspaceId, actor.principalId]);
function summary(entry: Entry): PersonalModelSummary {
  const { key, owner: identity, ...safe } = entry;
  return {
    ...safe,
    route: {
      scope: entry.scope,
      provider: entry.endpoint,
      model: entry.model,
      maxInputChars: 32000,
      maxOutputTokens: 4096,
      timeoutMs: 60000,
      maxRunsPerDay: entry.maxRunsPerDay,
      fingerprint: createHash("sha256")
        .update(JSON.stringify([identity, entry]))
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
  if (existsSync(dataPath)) {
    privatePath(dataPath);
    const data = readFileSync(dataPath);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      master,
      data.subarray(0, 12),
    );
    decipher.setAuthTag(data.subarray(12, 28));
    entries = JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
  }
  function commit(next: Entry[]) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", master, iv);
    const body = Buffer.concat([
      cipher.update(JSON.stringify(next), "utf8"),
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
    if (process.platform !== "win32") {
      const directoryFd = openSync(directory, "r");
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    }
  }
  return {
    list: (actor) =>
      entries.filter((e) => e.owner === owner(actor)).map(summary),
    save(actor, version, input) {
      const endpoint = modelEndpoint(input.endpoint).href;
      if (
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
        (e) => e.owner === owner(actor) && e.scope === input.scope,
      );
      if ((old?.version ?? 0) !== version)
        throw new DomainError("VERSION_CONFLICT");
      if (!old && entries.filter((e) => e.owner === owner(actor)).length >= 50)
        throw new DomainError("VALIDATION_ERROR");
      const key = input.key || old?.key;
      if (!key) throw new DomainError("VALIDATION_ERROR");
      const entry = {
        ...input,
        endpoint,
        key,
        owner: owner(actor),
        version: version + 1,
      };
      commit([...entries.filter((e) => e !== old), entry]);
      return summary(entry);
    },
    remove(actor, scope, version) {
      const old = entries.find(
        (e) => e.owner === owner(actor) && e.scope === scope,
      );
      if (!old || old.version !== version)
        throw new DomainError("VERSION_CONFLICT");
      commit(entries.filter((e) => e !== old));
    },
    resolve(actor, scope): ModelPort | null {
      const entry = entries.find(
        (e) => e.owner === owner(actor) && e.scope === scope,
      );
      if (!entry) return null;
      const route = summary(entry).route;
      return {
        route,
        async complete(prompt, signal) {
          const endpoint = new URL(
            entry.protocol === "chat" ? "chat/completions" : "responses",
            entry.endpoint,
          );
          const data = (await send(
            endpoint,
            entry.key,
            entry.protocol === "chat"
              ? {
                  model: entry.model,
                  messages: [{ role: "user", content: prompt }],
                  max_completion_tokens: route.maxOutputTokens,
                  store: false,
                  stream: false,
                }
              : {
                  model: entry.model,
                  input: prompt,
                  max_output_tokens: route.maxOutputTokens,
                  store: false,
                  stream: false,
                },
            signal,
          )) as {
            choices?: {
              message?: { content?: string; tool_calls?: unknown[] };
            }[];
            output?: {
              type: string;
              content?: { type: string; text?: string }[];
            }[];
          };
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
          return text;
        },
      };
    },
  };
}
