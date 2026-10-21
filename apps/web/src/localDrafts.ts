export type Draft = {
  title: string;
  body: string;
  updatedAt: number;
  entityId?: string;
  baseVersion?: number;
  baseUpdatedAt?: string | null;
  savedAt?: number;
};
export function draftMatchesBase(
  draft: Draft,
  entityId: string,
  base?: { version: number; updatedAt: string },
): boolean {
  return (
    draft.entityId === entityId &&
    draft.baseVersion === (base?.version ?? 0) &&
    draft.baseUpdatedAt === (base?.updatedAt ?? null)
  );
}
const dbName = "orivane-atlas-local";
const storeName = "drafts";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadDraft(key: string): Promise<Draft | null> {
  try {
    return await loadDraftStrict(key);
  } catch {
    return null;
  }
}
/** New durable editors must distinguish unavailable storage from no draft. */
export async function loadDraftStrict(key: string): Promise<Draft | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).get(key);
      request.onsuccess = () =>
        resolve((request.result as Draft | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function saveDraft(key: string, draft: Draft): Promise<boolean> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(draft, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
export async function clearDraft(key: string) {
  try {
    await clearDraftStrict(key);
  } catch {
    /* best effort */
  }
}
export async function clearDraftStrict(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
