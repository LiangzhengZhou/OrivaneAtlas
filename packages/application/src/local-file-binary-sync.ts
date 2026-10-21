import { type ActorContext, DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import { buildLocalFileReplayRequest } from "./local-file-replay-request";
import type { LocalBlobStore, LocalSyncState } from "./local-persistence";

export interface LocalFileBinaryTransport {
  begin(
    binding: LocalSyncState,
    input: {
      contentHash: string;
      size: number;
      mime: string;
      chunkSize: number;
    },
  ): Promise<unknown>;
  putChunk(
    binding: LocalSyncState,
    hash: string,
    index: number,
    chunkHash: string,
    bytes: Blob,
  ): Promise<unknown>;
  complete(binding: LocalSyncState, hash: string): Promise<unknown>;
}
/** Original verified local bytes; resumable transport never changes metadata or ACK. */
export async function syncLocalFileBinary(
  actorInput: ActorContext,
  planInput: LocalCommandPlan,
  blobs: LocalBlobStore,
  transport: LocalFileBinaryTransport,
  binding: () => Promise<LocalSyncState>,
) {
  const actor = Object.freeze({ ...actorInput }),
    plan = structuredClone(planInput),
    request = buildLocalFileReplayRequest(plan);
  if (!request || plan.command?.name !== "file.upload")
    throw new DomainError("VALIDATION_ERROR", { field: "fileUploadCommand" });
  const original = localObject(plan.command.input),
    input = localObject(original.input!);
  if (
    typeof original.contentHash !== "string" ||
    typeof original.size !== "number" ||
    typeof input.mime !== "string" ||
    !blobs.digest
  )
    throw new DomainError("VALIDATION_ERROR");
  return syncVerifiedLocalFileBinary(
    actor,
    {
      contentHash: original.contentHash,
      size: original.size,
      mime: input.mime,
    },
    blobs,
    transport,
    binding,
  );
}

/** Shared original-byte transfer for ordinary Outbox replay and reviewed workspace imports. */
export async function syncVerifiedLocalFileBinary(
  actorInput: ActorContext,
  input: {
    readonly contentHash: string;
    readonly size: number;
    readonly mime: string;
  },
  blobs: LocalBlobStore,
  transport: LocalFileBinaryTransport,
  bindingInput: () => Promise<LocalSyncState>,
) {
  const actor = Object.freeze({ ...actorInput }),
    captured = structuredClone(input);
  if (
    !/^[a-f0-9]{64}$/.test(captured.contentHash) ||
    !Number.isSafeInteger(captured.size) ||
    captured.size < 0 ||
    !blobs.digest ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(captured.mime)
  )
    throw new DomainError("VALIDATION_ERROR");
  let expectedScope: string | null = null;
  const binding = async () => {
    const value = await bindingInput();
    if (
      value.workspaceId !== actor.workspaceId ||
      !value.remoteWorkspaceId ||
      !value.remotePrincipalId ||
      !value.serverOrigin ||
      !value.epoch
    )
      throw new DomainError("FORBIDDEN");
    const scope = JSON.stringify([
      value.workspaceId,
      value.remoteWorkspaceId,
      value.remotePrincipalId,
      value.serverOrigin,
      value.epoch,
    ]);
    if (expectedScope !== null && expectedScope !== scope)
      throw new DomainError("VERSION_CONFLICT");
    expectedScope = scope;
    return value;
  };
  await binding();
  const hash = captured.contentHash,
    size = captured.size,
    bytes = await blobs.get(actor.workspaceId, hash);
  if (!bytes || bytes.size !== size || (await blobs.digest(bytes)) !== hash)
    throw new Error("LOCAL_FILE_BYTES_MISSING_OR_CORRUPT");
  const chunkSize = 262144,
    count = Math.ceil(size / chunkSize);
  const started = localObject(
    localDto(
      await transport.begin(await binding(), {
        contentHash: hash,
        size,
        mime: captured.mime,
        chunkSize,
      }),
    ),
  );
  await binding();
  if (
    Object.keys(started).some(
      (k) => !["contentHash", "received"].includes(k),
    ) ||
    started.contentHash !== hash ||
    !Array.isArray(started.received) ||
    started.received.length > count ||
    started.received.some(
      (i) =>
        typeof i !== "number" ||
        !Number.isSafeInteger(i) ||
        i < 0 ||
        i >= count,
    ) ||
    new Set(started.received).size !== started.received.length
  )
    throw new DomainError("VALIDATION_ERROR", { field: "fileBinaryStatus" });
  const received = new Set(started.received);
  for (let index = 0; index < count; index++) {
    if (received.has(index)) continue;
    const chunk = bytes.slice(index * chunkSize, (index + 1) * chunkSize),
      chunkHash = await blobs.digest(chunk);
    const result = localObject(
      localDto(
        await transport.putChunk(
          await binding(),
          hash,
          index,
          chunkHash,
          chunk,
        ),
      ),
    );
    await binding();
    if (
      Object.keys(result).some((k) => !["contentHash", "index"].includes(k)) ||
      result.contentHash !== hash ||
      result.index !== index
    )
      throw new DomainError("VALIDATION_ERROR", { field: "fileBinaryChunk" });
  }
  const completed = localObject(
    localDto(await transport.complete(await binding(), hash)),
  );
  await binding();
  if (
    Object.keys(completed).some(
      (k) => !["contentHash", "complete"].includes(k),
    ) ||
    completed.contentHash !== hash ||
    completed.complete !== true
  )
    throw new DomainError("VALIDATION_ERROR", { field: "fileBinaryComplete" });
}
