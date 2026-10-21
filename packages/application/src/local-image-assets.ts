import { type ActorContext, DomainError } from "@arclattice/domain";
import type { Clock, IdGenerator } from "./index";
import type { LibraryAsset } from "./library";
import { localDto, localObject } from "./local-dto";
import type { LocalLibraryAssets } from "./local-library-store";
import type { LocalMutationTransaction } from "./local-mutation-transaction";
import type { LocalBlobStore } from "./local-persistence";
import type { WorkspaceChange } from "./workspace-change-log";

interface ImageRecord {
  id: string;
  workspaceId: string;
  version: number;
  principalId: string;
  spaceId: string | null;
  name: string;
  mime: string;
  state: "UPLOADING" | "READY";
  chunkHashes: string[];
  totalBytes: number;
  updatedAt: string;
}

/** Validate raster signature without converting original bytes to JSON or Base64. */
export async function requireRasterImage(bytes: Blob): Promise<void> {
  const head = new Uint8Array(await bytes.slice(0, 12).arrayBuffer());
  const valid =
    head.length >= 12 &&
    (bytes.type === "image/png"
      ? [137, 80, 78, 71, 13, 10, 26, 10].every(
          (byte, index) => head[index] === byte,
        )
      : bytes.type === "image/jpeg"
        ? head[0] === 255 && head[1] === 216 && head[2] === 255
        : bytes.type === "image/webp" &&
          String.fromCharCode(...head.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...head.slice(8, 12)) === "WEBP");
  if (!valid) throw new DomainError("VALIDATION_ERROR");
}

/** Legacy Markdown images retain their contract; durable bytes are Blob-only. */
export class LocalImageAssets implements LocalLibraryAssets {
  constructor(
    private readonly stage: LocalMutationTransaction,
    private readonly blobs: LocalBlobStore,
    private readonly actor: ActorContext,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly publish: (change: Omit<WorkspaceChange, "seq">) => void,
  ) {}

  private async record(id: string): Promise<ImageRecord | null> {
    const entity = await this.stage.get("libraryAssets", id);
    if (!entity) return null;
    const value = localObject(entity.value);
    if (
      value.workspaceId !== this.actor.workspaceId ||
      value.id !== id ||
      value.version !== entity.version ||
      !Array.isArray(value.chunkHashes) ||
      value.chunkHashes.some(
        (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash),
      ) ||
      typeof value.totalBytes !== "number" ||
      value.totalBytes < 0 ||
      !["READY", "UPLOADING"].includes(String(value.state))
    )
      throw new Error("LOCAL_DATA_CORRUPT");
    return structuredClone(value) as unknown as ImageRecord;
  }

  private async space(id: string | null) {
    if (id === null) return;
    const entity = await this.stage.get("library", id);
    if (!entity) throw new DomainError("NOT_FOUND");
    const value = localObject(entity.value);
    if (
      value.workspaceId !== this.actor.workspaceId ||
      value.kind !== "SPACE" ||
      value.deletedAt !== null
    )
      throw new DomainError("NOT_FOUND");
  }

  putAsset(asset: LibraryAsset) {
    return this.putAssetChunk(asset, 0, true);
  }

  async putAssetChunk(asset: LibraryAsset, index: number, final: boolean) {
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= 400 ||
      typeof final !== "boolean" ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(asset.id) ||
      !asset.name ||
      asset.name.length > 120 ||
      !["image/png", "image/jpeg", "image/webp"].includes(asset.mime) ||
      typeof asset.base64 !== "string" ||
      !asset.base64.length ||
      asset.base64.length > 349528 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        asset.base64,
      )
    )
      throw new DomainError("VALIDATION_ERROR");
    const decoded = atob(asset.base64);
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    if (
      !bytes.length ||
      bytes.length > 262144 ||
      btoa(decoded) !== asset.base64
    )
      throw new DomainError("VALIDATION_ERROR");
    if (index === 0) {
      const valid =
        bytes.length >= 12 &&
        (asset.mime === "image/png"
          ? [137, 80, 78, 71, 13, 10, 26, 10].every(
              (byte, i) => bytes[i] === byte,
            )
          : asset.mime === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
              String.fromCharCode(...bytes.slice(8, 12)) === "WEBP");
      if (!valid) throw new DomainError("VALIDATION_ERROR");
    }
    await this.space(asset.spaceId);
    const old = await this.record(asset.id);
    if (!old && index !== 0) throw new DomainError("VERSION_CONFLICT");
    if (old && old.principalId !== this.actor.principalId)
      throw new DomainError("FORBIDDEN");
    if (
      old &&
      (old.state !== "UPLOADING" ||
        old.chunkHashes.length !== index ||
        old.name !== asset.name ||
        old.mime !== asset.mime ||
        old.spaceId !== asset.spaceId)
    )
      throw new DomainError("VERSION_CONFLICT");
    if ((old?.totalBytes ?? 0) + bytes.length > 100 * 1024 * 1024)
      throw new DomainError("VALIDATION_ERROR");
    const blob = new Blob([bytes], { type: asset.mime });
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    // Blob is immutable and hash-verified before its metadata becomes visible.
    // A failed metadata commit can leave an unreferenced Blob, never a partial image.
    await this.blobs.put(this.actor.workspaceId, hash, blob);
    const record: ImageRecord = {
      id: asset.id,
      workspaceId: this.actor.workspaceId,
      version: (old?.version ?? 0) + 1,
      principalId: this.actor.principalId,
      spaceId: asset.spaceId,
      name: asset.name,
      mime: asset.mime,
      state: final ? "READY" : "UPLOADING",
      chunkHashes: [...(old?.chunkHashes ?? []), hash],
      totalBytes: (old?.totalBytes ?? 0) + bytes.length,
      updatedAt: this.clock.now(),
    };
    const value = localDto(record);
    this.stage.stage(
      {
        workspaceId: this.actor.workspaceId,
        collection: "libraryAssets",
        id: asset.id,
        version: record.version,
        value,
      },
      old?.version ?? null,
      old ? "PATCH" : "CREATE",
      value,
      old ? localDto(old) : null,
    );
    const activityId = this.ids.next();
    this.stage.stageInternal(
      {
        workspaceId: this.actor.workspaceId,
        collection: "$local.imageActivity",
        id: activityId,
        version: 1,
        value: localDto({
          entityId: asset.id,
          principalId: this.actor.principalId,
          type: final ? "ASSET_UPLOADED" : "ASSET_CHUNK_UPLOADED",
          version: record.version,
          occurredAt: record.updatedAt,
        }),
      },
      null,
    );
    this.publish({
      workspaceId: this.actor.workspaceId,
      collection: "libraryAssets",
      entityId: asset.id,
      version: record.version,
      op: "UPSERT",
    });
  }

  async asset(id: string): Promise<LibraryAsset> {
    const record = await this.record(id);
    if (!record || record.state !== "READY") throw new DomainError("NOT_FOUND");
    await this.space(record.spaceId);
    return {
      id: record.id,
      spaceId: record.spaceId,
      name: record.name,
      mime: record.mime,
      base64: "",
      chunkCount: record.chunkHashes.length,
    };
  }

  async assetChunk(id: string, index: number) {
    await this.asset(id);
    const record = await this.record(id);
    if (!Number.isSafeInteger(index) || index < 0)
      throw new DomainError("VALIDATION_ERROR");
    const hash = record?.chunkHashes[index];
    if (!hash) throw new DomainError("NOT_FOUND");
    const blob = await this.blobs.get(this.actor.workspaceId, hash);
    if (!blob) throw new Error("LOCAL_BINARY_MISSING");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  }

  async readImage(id: string) {
    const asset = await this.asset(id),
      record = await this.record(id);
    if (!record) throw new DomainError("NOT_FOUND");
    const parts: Blob[] = [];
    for (const hash of record.chunkHashes) {
      const blob = await this.blobs.get(this.actor.workspaceId, hash);
      if (!blob) throw new Error("LOCAL_BINARY_MISSING");
      parts.push(blob);
    }
    const blob = new Blob(parts, { type: asset.mime });
    if (blob.size !== record.totalBytes)
      throw new Error("LOCAL_BINARY_CORRUPT");
    return blob;
  }
}
