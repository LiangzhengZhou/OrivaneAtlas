import {
  type LocalBlobUpload,
  type LocalChunkBlobStore,
  LocalStorageError,
} from "./contracts";

/** Separate database: binary bytes never enter metadata records or outbox JSON. */
export class IndexedDbLocalBlobStore implements LocalChunkBlobStore {
  private constructor(private readonly db: IDBDatabase) {}

  static open(
    name: string,
    factory: IDBFactory = indexedDB,
  ): Promise<IndexedDbLocalBlobStore> {
    return new Promise((resolve, reject) => {
      const request = factory.open(`${name}.blobs`, 2);
      request.onupgradeneeded = (event) => {
        if (event.oldVersion < 1) request.result.createObjectStore("blobs");
        if (event.oldVersion < 2) {
          request.result.createObjectStore("uploads");
          request.result.createObjectStore("chunks");
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(new IndexedDbLocalBlobStore(db));
      };
    });
  }

  close() {
    this.db.close();
  }

  async listHashes(workspaceId: string) {
    if (!workspaceId) throw new LocalStorageError("INVALID_WRITE");
    const tx = this.db.transaction("blobs", "readonly");
    const done = this.done(tx);
    const request = tx
      .objectStore("blobs")
      .getAllKeys(
        IDBKeyRange.bound([workspaceId, ""], [workspaceId, "\uffff"]),
      );
    await done;
    return request.result.map((key) => String((key as IDBValidKey[])[1]));
  }

  private done(tx: IDBTransaction) {
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error("LOCAL_BLOB_TRANSACTION_ABORTED"));
    });
  }

  async begin(upload: LocalBlobUpload) {
    if (
      !upload.workspaceId ||
      !/^[a-f0-9]{64}$/.test(upload.sha256) ||
      !Number.isSafeInteger(upload.size) ||
      upload.size < 0 ||
      upload.size > 100 * 1024 * 1024 ||
      !Number.isSafeInteger(upload.chunkSize) ||
      upload.chunkSize < 1 ||
      upload.chunkSize > 262144 ||
      !upload.mime ||
      upload.mime.length > 255
    )
      throw new LocalStorageError("INVALID_WRITE");
    const tx = this.db.transaction("uploads", "readwrite", {
      durability: "strict",
    });
    const done = this.done(tx);
    let conflict = false;
    const store = tx.objectStore("uploads");
    const key = [upload.workspaceId, upload.sha256];
    const read: IDBRequest<LocalBlobUpload | undefined> = store.get(key);
    read.onsuccess = () => {
      const old = read.result;
      if (
        old &&
        (old.size !== upload.size ||
          old.chunkSize !== upload.chunkSize ||
          old.mime !== upload.mime)
      ) {
        conflict = true;
        tx.abort();
      } else if (!old) store.add(upload, key);
    };
    try {
      await done;
    } catch (error) {
      if (conflict) throw new LocalStorageError("INVALID_WRITE");
      throw error;
    }
  }

  private async upload(workspaceId: string, sha256: string) {
    if (!workspaceId || !/^[a-f0-9]{64}$/.test(sha256))
      throw new LocalStorageError("INVALID_WRITE");
    const tx = this.db.transaction("uploads", "readonly");
    const done = this.done(tx);
    const read: IDBRequest<LocalBlobUpload | undefined> = tx
      .objectStore("uploads")
      .get([workspaceId, sha256]);
    await done;
    if (!read.result) throw new LocalStorageError("INVALID_WRITE");
    return read.result;
  }

  async chunks(workspaceId: string, sha256: string) {
    await this.upload(workspaceId, sha256);
    const tx = this.db.transaction("chunks", "readonly");
    const done = this.done(tx);
    const read = tx
      .objectStore("chunks")
      .getAllKeys(
        IDBKeyRange.bound(
          [workspaceId, sha256, 0],
          [workspaceId, sha256, Number.MAX_SAFE_INTEGER],
        ),
      );
    await done;
    return read.result.map((key) => Number((key as IDBValidKey[])[2]));
  }

  async putChunk(
    workspaceId: string,
    sha256: string,
    index: number,
    chunkHash: string,
    bytes: Blob,
  ) {
    const upload = await this.upload(workspaceId, sha256);
    const count = Math.ceil(upload.size / upload.chunkSize);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= count ||
      bytes.size !==
        Math.min(upload.chunkSize, upload.size - index * upload.chunkSize) ||
      !/^[a-f0-9]{64}$/.test(chunkHash)
    )
      throw new LocalStorageError("INVALID_WRITE");
    if ((await this.digest(bytes)) !== chunkHash)
      throw new LocalStorageError("HASH_MISMATCH");
    const tx = this.db.transaction("chunks", "readwrite", {
      durability: "strict",
    });
    const done = this.done(tx);
    let conflict = false;
    const store = tx.objectStore("chunks");
    const key = [workspaceId, sha256, index];
    const read: IDBRequest<{ hash: string; bytes: Blob } | undefined> =
      store.get(key);
    read.onsuccess = () => {
      if (read.result && read.result.hash !== chunkHash) {
        conflict = true;
        tx.abort();
      } else if (!read.result) store.add({ hash: chunkHash, bytes }, key);
    };
    try {
      await done;
    } catch (error) {
      if (conflict) throw new LocalStorageError("HASH_MISMATCH");
      throw error;
    }
  }

  async complete(workspaceId: string, sha256: string) {
    const upload = await this.upload(workspaceId, sha256);
    const tx = this.db.transaction("chunks", "readonly");
    const done = this.done(tx);
    const read: IDBRequest<{ hash: string; bytes: Blob }[]> = tx
      .objectStore("chunks")
      .getAll(
        IDBKeyRange.bound(
          [workspaceId, sha256, 0],
          [workspaceId, sha256, Number.MAX_SAFE_INTEGER],
        ),
      );
    await done;
    if (read.result.length !== Math.ceil(upload.size / upload.chunkSize))
      throw new LocalStorageError("INVALID_WRITE");
    for (const chunk of read.result)
      if ((await this.digest(chunk.bytes)) !== chunk.hash)
        throw new LocalStorageError("HASH_MISMATCH");
    const bytes = new Blob(
      read.result.map((chunk) => chunk.bytes),
      { type: upload.mime },
    );
    if (bytes.size !== upload.size || (await this.digest(bytes)) !== sha256)
      throw new LocalStorageError("HASH_MISMATCH");
    await this.put(workspaceId, sha256, bytes);
  }

  async digest(bytes: Blob) {
    return [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer()),
      ),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }

  async put(workspaceId: string, expectedSha256: string, bytes: Blob) {
    if (!workspaceId || !/^[a-f0-9]{64}$/.test(expectedSha256))
      throw new LocalStorageError("INVALID_WRITE");
    const hash = await this.digest(bytes);
    if (hash !== expectedSha256) throw new LocalStorageError("HASH_MISMATCH");
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction("blobs", "readwrite", {
        durability: "strict",
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error("LOCAL_BLOB_TRANSACTION_ABORTED"));
      tx.objectStore("blobs").put(bytes, [workspaceId, hash]);
    });
  }

  async get(workspaceId: string, sha256: string): Promise<Blob | null> {
    if (!workspaceId || !/^[a-f0-9]{64}$/.test(sha256))
      return Promise.reject(new LocalStorageError("INVALID_WRITE"));
    const result = await new Promise<Blob | null>((resolve, reject) => {
      const tx = this.db.transaction("blobs", "readonly");
      let bytes: Blob | null = null;
      const request: IDBRequest<Blob | undefined> = tx
        .objectStore("blobs")
        .get([workspaceId, sha256]);
      request.onsuccess = () => {
        bytes = request.result ?? null;
      };
      tx.oncomplete = () => resolve(bytes);
      tx.onabort = () =>
        reject(tx.error ?? new Error("LOCAL_BLOB_TRANSACTION_ABORTED"));
    });
    if (result) {
      const actualHash = await this.digest(result);
      if (actualHash !== sha256) throw new LocalStorageError("HASH_MISMATCH");
    }
    return result;
  }
}
