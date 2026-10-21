import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type AuthorizationService,
  type Clock,
  type ContentPolicy,
  type FileReplayEffect,
  FileReplayEffects,
  FileService,
  FileTransferService,
  type FileUploadInput,
  type IdGenerator,
  type LibraryFileStore,
  type LibraryStore,
  type LocalChunkBlobStore,
  type MutationReceipt,
  requireStableUuid,
  requireWorkspaceMutationPrecondition,
  reviewedWorkspaceMutationResult,
  type WorkspaceMutationPrecondition,
  type WorkTransaction,
} from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  type FileExtractionDocument,
} from "@arclattice/domain";

interface FileRoutePorts {
  context: ActorContext;
  authorization: AuthorizationService;
  clock: Clock;
  ids: IdGenerator;
  extract(
    id: string,
    version: number,
    signal: AbortSignal,
  ): Promise<FileExtractionDocument>;
  readJson(
    req: IncomingMessage,
  ): Promise<{ raw: string; value: Record<string, unknown> }>;
  json(res: ServerResponse, status: number, value: unknown): void;
  transaction<T>(
    receipt: MutationReceipt | null,
    operation: (
      files: LibraryFileStore,
      library: LibraryStore,
      blobs: LocalChunkBlobStore,
      tx: WorkTransaction,
    ) => Promise<T>,
  ): Promise<T>;
}
function invalid(field = "fileRequest"): never {
  throw new DomainError("VALIDATION_ERROR", { field });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k))) invalid();
}
function text(value: unknown, max = 240): string {
  if (typeof value !== "string" || !value || value.length > max) invalid();
  return value as string;
}
function number(value: unknown, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    invalid();
  return value as number;
}
const nullable = (value: unknown) => (value === null ? null : text(value));

/** Human authenticated File surface. Application owns metadata and transfer rules. */
export async function handleFileRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  ports: FileRoutePorts,
): Promise<boolean> {
  const read = req.method === "GET",
    mutation = req.method === "POST";
  const paths = [
    "/api/files/metadata",
    "/api/files/bytes",
    "/api/files/binary/status",
    "/api/files/binary/begin",
    "/api/files/binary/chunk",
    "/api/files/binary/complete",
    "/api/files/register",
    "/api/files/rename",
    "/api/files/delete",
    "/api/files/policy",
    "/api/files/extraction",
  ];
  if (!paths.includes(path)) return false;
  const service = (
    files: LibraryFileStore,
    library: LibraryStore,
    blobs: LocalChunkBlobStore,
  ) =>
    new FileService(
      files,
      library,
      blobs,
      ports.authorization,
      ports.clock,
      ports.ids,
    );
  if (read && path === "/api/files/extraction") {
    const rawVersion = url.searchParams.get("version");
    if (!rawVersion || !/^[1-9]\d*$/.test(rawVersion)) invalid("version");
    const version = number(Number(rawVersion), 1);
    const controller = new AbortController();
    const cancel = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once("close", cancel);
    try {
      const value = await ports.extract(
        text(url.searchParams.get("id")),
        version,
        controller.signal,
      );
      ports.json(res, 200, value);
    } finally {
      res.removeListener("close", cancel);
    }
    return true;
  }
  if (read && path === "/api/files/metadata") {
    const value = await ports.transaction(null, (files, library, blobs) =>
      service(files, library, blobs).read(
        ports.context,
        text(url.searchParams.get("id")),
      ),
    );
    ports.json(res, 200, value);
    return true;
  }
  if (read && path === "/api/files/bytes") {
    const value = await ports.transaction(
      null,
      async (files, library, blobs) => {
        const file = await service(files, library, blobs).read(
          ports.context,
          text(url.searchParams.get("id")),
        );
        return {
          file,
          bytes: await service(files, library, blobs).originalBytes(
            ports.context,
            file.id,
          ),
        };
      },
    );
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(value.bytes.size),
      "Content-Disposition":
        "attachment; filename*=UTF-8''" +
        encodeURIComponent(value.file.originalName),
      "Cache-Control": "private, no-store",
    });
    await pipeline(
      Readable.from(
        (async function* () {
          for (let offset = 0; offset < value.bytes.size; offset += 262144)
            yield new Uint8Array(
              await value.bytes.slice(offset, offset + 262144).arrayBuffer(),
            );
        })(),
      ),
      res,
    );
    return true;
  }
  if (read && path === "/api/files/binary/status") {
    const value = await ports.transaction(null, (_files, _library, blobs) =>
      new FileTransferService(blobs, ports.authorization).status(
        ports.context,
        text(url.searchParams.get("hash"), 64),
      ),
    );
    ports.json(res, 200, value);
    return true;
  }
  if (!mutation) throw new DomainError("NOT_FOUND");
  if (path === "/api/files/binary/chunk") {
    if (
      req.headers["content-type"]?.split(";")[0] !== "application/octet-stream"
    )
      invalid("binaryContentType");
    const hash = text(url.searchParams.get("hash"), 64),
      index = number(Number(url.searchParams.get("index"))),
      chunkHash = text(req.headers["x-file-chunk-hash"], 64);
    if (!url.searchParams.has("index")) invalid("chunkIndex");
    const parts: Buffer[] = [];
    let size = 0;
    for await (const part of req) {
      const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
      size += bytes.length;
      if (size > 262144) invalid("chunkBytes");
      parts.push(bytes);
    }
    const bytes = new Blob([new Uint8Array(Buffer.concat(parts))]);
    const value = await ports.transaction(null, (_files, _library, blobs) =>
      new FileTransferService(blobs, ports.authorization).putChunk(
        ports.context,
        hash,
        index,
        chunkHash,
        bytes,
      ),
    );
    ports.json(res, 200, value);
    return true;
  }
  const { raw, value } = await ports.readJson(req);
  if (path === "/api/files/binary/begin") {
    keys(value, ["contentHash", "size", "mime", "chunkSize"]);
    const result = await ports.transaction(null, (_files, _library, blobs) =>
      new FileTransferService(blobs, ports.authorization).begin(ports.context, {
        contentHash: text(value.contentHash, 64),
        size: number(value.size),
        mime: text(value.mime, 127),
        chunkSize: number(value.chunkSize, 1),
      }),
    );
    ports.json(res, 200, result);
    return true;
  }
  if (path === "/api/files/binary/complete") {
    keys(value, ["contentHash"]);
    const result = await ports.transaction(null, (_files, _library, blobs) =>
      new FileTransferService(blobs, ports.authorization).complete(
        ports.context,
        text(value.contentHash, 64),
      ),
    );
    ports.json(res, 200, result);
    return true;
  }
  const requestKey = text(req.headers["idempotency-key"], 80);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestKey)) invalid("idempotencyKey");
  const guardHeader = req.headers["x-workspace-precondition"];
  let workspacePrecondition: WorkspaceMutationPrecondition | undefined;
  if (guardHeader !== undefined) {
    if (typeof guardHeader !== "string" || guardHeader.length > 1024)
      invalid("workspacePrecondition");
    try {
      workspacePrecondition = requireWorkspaceMutationPrecondition(
        JSON.parse(guardHeader),
      );
    } catch {
      invalid("workspacePrecondition");
    }
  }
  const receipt = {
    ...(workspacePrecondition ? { workspacePrecondition } : {}),
    key: requestKey,
    digest: createHash("sha256")
      .update(path + "\n" + raw)
      .digest("hex"),
  };
  let sync: {
    commandId: string;
    deviceId: string;
    effects: FileReplayEffect[];
  } | null = null;
  if (value.syncCommand !== undefined) {
    const command = object(value.syncCommand);
    keys(command, ["commandId", "deviceId", "effects"]);
    const commandId = requireStableUuid(command.commandId, "commandId"),
      deviceId = requireStableUuid(command.deviceId, "deviceId");
    if (
      commandId !== requestKey ||
      !Array.isArray(command.effects) ||
      command.effects.length !== 1
    )
      invalid("fileEffects");
    const e = object(command.effects[0]);
    keys(e, ["collection", "id", "op", "baseVersion"]);
    if (e.collection !== "files" || e.op !== "UPSERT") invalid("fileEffects");
    sync = {
      commandId,
      deviceId,
      effects: [
        {
          collection: "files",
          id: text(e.id),
          op: "UPSERT",
          baseVersion: number(e.baseVersion),
        },
      ],
    };
  }
  if (path === "/api/files/register")
    keys(value, [
      "name",
      "mime",
      "spaceId",
      "parentDocumentId",
      "aiPolicy",
      "contentHash",
      "size",
      "stableId",
      "deviceId",
      "syncCommand",
    ]);
  else
    keys(
      value,
      path.endsWith("rename")
        ? ["id", "version", "name", "syncCommand"]
        : path.endsWith("policy")
          ? ["id", "version", "aiPolicy", "syncCommand"]
          : ["id", "version", "deleted", "syncCommand"],
    );
  if (value.stableId !== undefined || value.deviceId !== undefined) {
    if (
      !sync ||
      path !== "/api/files/register" ||
      value.deviceId !== sync.deviceId ||
      value.stableId !== sync.effects[0]?.id
    )
      invalid("stableFileIdentity");
    requireStableUuid(value.stableId, "stableId");
  }
  const result = await ports.transaction(
    { ...receipt, ...(sync ? { deviceId: sync.deviceId } : {}) },
    async (files, library, blobs, tx) => {
      const guard = sync
        ? new FileReplayEffects(
            ports.context.workspaceId,
            ports.context.principalId,
            sync.effects,
          )
        : null;
      const execute = async (store: LibraryFileStore) => {
        const app = service(store, library, blobs);
        if (path === "/api/files/register") {
          if (sync && value.stableId === undefined)
            invalid("stableFileIdentity");
          const input: FileUploadInput = {
            name: text(value.name, 255),
            mime: text(value.mime, 127),
            spaceId: nullable(value.spaceId),
            parentDocumentId:
              value.parentDocumentId === undefined
                ? null
                : nullable(value.parentDocumentId),
            ...(value.aiPolicy === undefined
              ? {}
              : {
                  aiPolicy: object(value.aiPolicy) as unknown as NonNullable<
                    FileUploadInput["aiPolicy"]
                  >,
                }),
          };
          return app.registerUploaded(
            ports.context,
            value.stableId === undefined
              ? (ports.ids.nextFor?.("FILE") ?? ports.ids.next())
              : text(value.stableId),
            input,
            text(value.contentHash, 64),
            number(value.size),
          );
        }
        if (path.endsWith("rename"))
          return app.rename(
            ports.context,
            text(value.id),
            number(value.version, 1),
            text(value.name, 255),
          );
        if (path.endsWith("policy"))
          return app.setPolicy(
            ports.context,
            text(value.id),
            number(value.version, 1),
            object(value.aiPolicy) as unknown as ContentPolicy,
          );
        if (typeof value.deleted !== "boolean") invalid("deleted");
        return app.setDeleted(
          ports.context,
          text(value.id),
          number(value.version, 1),
          value.deleted as boolean,
        );
      };
      const applied = guard
        ? await guard.run(files, execute)
        : await execute(files);
      const response =
        sync && guard
          ? {
              commandId: sync.commandId,
              deviceId: sync.deviceId,
              result: applied,
              effects: guard.acceptedEffects,
            }
          : applied;
      return workspacePrecondition
        ? reviewedWorkspaceMutationResult(tx, workspacePrecondition, response)
        : response;
    },
  );
  ports.json(res, 200, result);
  return true;
}
