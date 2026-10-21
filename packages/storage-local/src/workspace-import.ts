import {
  requireWorkspaceImportFork,
  requireWorkspaceImportJournal,
  type WorkspaceImportJournal,
  type WorkspaceImportStore,
  type WorkspaceImportSummary,
} from "@arclattice/application";
import { DomainError } from "@arclattice/domain";

/** Separate from source and target replicas; switching a workspace never destroys recovery evidence. */
export class IndexedDbWorkspaceImports implements WorkspaceImportStore {
  private constructor(private readonly db: IDBDatabase) {}
  static async open(
    name = "orivane-atlas.workspace-imports",
    factory: IDBFactory = indexedDB,
  ) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = factory.open(name, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("imports"))
          request.result.createObjectStore("imports", { keyPath: "id" });
        if (!request.result.objectStoreNames.contains("forks"))
          request.result.createObjectStore("forks", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("WORKSPACE_IMPORT_BLOCKED"));
      };
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
    });
    db.onversionchange = () => db.close();
    return new IndexedDbWorkspaceImports(db);
  }
  async create(input: WorkspaceImportJournal) {
    const journal = structuredClone(input);
    requireWorkspaceImportJournal(journal);
    if (journal.version !== 1) throw new DomainError("VALIDATION_ERROR");
    await new Promise<void>((resolve, reject) => {
      let failure: unknown;
      const tx = this.db.transaction(["imports", "forks"], "readwrite", {
        durability: "strict",
      });
      const store = tx.objectStore("imports"),
        forks = tx.objectStore("forks");
      const add = () => {
        store.add(journal);
        if (journal.parent)
          forks.add({ id: journal.parent.id, childId: journal.id });
      };
      if (journal.parent) {
        const parent = store.get(journal.parent.id);
        parent.onsuccess = () => {
          try {
            if (!parent.result) throw new DomainError("NOT_FOUND");
            requireWorkspaceImportFork(parent.result, journal);
            add();
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      } else add();
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error("WORKSPACE_IMPORT_ABORTED"));
    });
  }
  async successor(id: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("forks", "readonly"),
        read = tx.objectStore("forks").get(id);
      tx.oncomplete = () => resolve(read.result?.childId ?? null);
      tx.onabort = () =>
        reject(tx.error ?? new Error("WORKSPACE_IMPORT_READ_FAILED"));
    });
  }

  async get(id: string): Promise<WorkspaceImportJournal | null> {
    const output = await new Promise<WorkspaceImportJournal | null>(
      (resolve, reject) => {
        const tx = this.db.transaction("imports", "readonly"),
          request = tx.objectStore("imports").get(id);
        tx.oncomplete = () => resolve(request.result ?? null);
        tx.onabort = () =>
          reject(tx.error ?? new Error("WORKSPACE_IMPORT_READ_FAILED"));
      },
    );
    if (output) requireWorkspaceImportJournal(output);
    return output;
  }
  async list(actorInput: {
    workspaceId: string;
    principalId: string;
  }): Promise<readonly WorkspaceImportSummary[]> {
    const actor = structuredClone(actorInput);
    if (!actor.workspaceId || !actor.principalId)
      throw new DomainError("FORBIDDEN");
    return new Promise((resolve, reject) => {
      const rows: WorkspaceImportSummary[] = [];
      let failure: unknown;
      const tx = this.db.transaction(["imports", "forks"], "readonly");
      const claims = tx.objectStore("forks").getAll();
      const request = tx.objectStore("imports").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value as WorkspaceImportJournal;
        if (!entry || typeof entry !== "object") {
          failure = new DomainError("VALIDATION_ERROR");
          tx.abort();
          return;
        }
        if (
          entry.sourceWorkspaceId === actor.workspaceId &&
          entry.sourcePrincipalId === actor.principalId
        ) {
          try {
            requireWorkspaceImportJournal(entry);
            rows.push({
              id: entry.id,
              backupId: entry.backupId,
              targetWorkspaceId: entry.targetWorkspaceId,
              targetPrincipalId: entry.targetPrincipalId,
              targetOrigin: entry.targetOrigin,
              version: entry.version,
              completedSteps: entry.accepted.length,
              totalSteps: entry.steps.length,
              complete: entry.accepted.length === entry.steps.length,
            });
          } catch (error) {
            failure = error;
            tx.abort();
            return;
          }
        }
        cursor.continue();
      };
      tx.oncomplete = () => {
        const successors = new Map<string, string>(
          (claims.result as { id: string; childId: string }[]).map((entry) => [
            entry.id,
            entry.childId,
          ]),
        );
        resolve(
          rows
            .map((row) =>
              successors.has(row.id)
                ? { ...row, supersededBy: successors.get(row.id)! }
                : row,
            )
            .sort((a, b) => a.id.localeCompare(b.id)),
        );
      };
      tx.onabort = () =>
        reject(
          failure ?? tx.error ?? new Error("WORKSPACE_IMPORT_READ_FAILED"),
        );
    });
  }
  async advance(
    expectedInput: WorkspaceImportJournal,
    nextInput: WorkspaceImportJournal,
  ) {
    const expected = structuredClone(expectedInput),
      next = structuredClone(nextInput);
    requireWorkspaceImportJournal(expected);
    requireWorkspaceImportJournal(next);
    const immutable = (entry: WorkspaceImportJournal) => {
      const {
        version: _version,
        revision: _revision,
        accepted: _accepted,
        ...identity
      } = entry;
      return identity;
    };
    if (
      next.version !== expected.version + 1 ||
      JSON.stringify(immutable(next)) !== JSON.stringify(immutable(expected)) ||
      JSON.stringify(next.accepted.slice(0, -1)) !==
        JSON.stringify(expected.accepted)
    )
      throw new DomainError("VERSION_CONFLICT");
    await new Promise<void>((resolve, reject) => {
      let failure: Error | null = null;
      const tx = this.db.transaction(["imports", "forks"], "readwrite", {
        durability: "strict",
      });
      const store = tx.objectStore("imports"),
        read = store.get(expected.id);
      const successor = tx.objectStore("forks").get(expected.id);
      successor.onsuccess = () => {
        if (successor.result) {
          failure = new DomainError("VERSION_CONFLICT");
          tx.abort();
        }
      };
      read.onsuccess = () => {
        if (JSON.stringify(read.result) !== JSON.stringify(expected)) {
          failure = new DomainError("VERSION_CONFLICT");
          tx.abort();
          return;
        }
        store.put(next);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error("WORKSPACE_IMPORT_ABORTED"));
    });
  }
  close() {
    this.db.close();
  }
}
