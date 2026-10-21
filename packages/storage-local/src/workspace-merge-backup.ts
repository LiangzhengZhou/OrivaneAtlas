import type {
  WorkspaceMergeBackup,
  WorkspaceMergeBackupStore,
} from "@arclattice/application";

/** Independent database: workspace switching/restoration never replaces its backups. */
export class IndexedDbWorkspaceMergeBackups
  implements WorkspaceMergeBackupStore
{
  private constructor(private readonly db: IDBDatabase) {}
  static async open(
    name = "orivane-atlas.merge-backups",
    factory: IDBFactory = indexedDB,
  ) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = factory.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("backups", { keyPath: "id" });
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("MERGE_BACKUP_BLOCKED"));
      };
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
    });
    db.onversionchange = () => db.close();
    return new IndexedDbWorkspaceMergeBackups(db);
  }
  async save(input: WorkspaceMergeBackup) {
    const backup = structuredClone(input);
    if (
      !(backup.bytes instanceof Blob) ||
      !/^[a-f0-9]{64}$/.test(backup.sha256)
    )
      throw new Error("INVALID_MERGE_BACKUP");
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction("backups", "readwrite");
      // Immutable IDs: a retry must never replace an earlier original archive.
      tx.objectStore("backups").add(backup);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("MERGE_BACKUP_ABORTED"));
    });
  }
  async get(id: string): Promise<WorkspaceMergeBackup | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("backups", "readonly"),
        request = tx.objectStore("backups").get(id);
      tx.oncomplete = () => resolve(request.result ?? null);
      tx.onabort = () =>
        reject(tx.error ?? new Error("MERGE_BACKUP_READ_FAILED"));
    });
  }
  async list(
    workspaceId: string,
    principalId: string,
  ): Promise<readonly Omit<WorkspaceMergeBackup, "bytes">[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("backups", "readonly");
      const output: Omit<WorkspaceMergeBackup, "bytes">[] = [];
      const cursor = tx.objectStore("backups").openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        const backup: WorkspaceMergeBackup = entry.value;
        if (
          backup.sourceWorkspaceId === workspaceId &&
          backup.sourcePrincipalId === principalId
        ) {
          const { bytes: _bytes, ...metadata } = backup;
          output.push(metadata);
        }
        entry.continue();
      };
      tx.oncomplete = () =>
        resolve(output.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      tx.onabort = () =>
        reject(tx.error ?? new Error("MERGE_BACKUP_READ_FAILED"));
    });
  }
  close() {
    this.db.close();
  }
}
