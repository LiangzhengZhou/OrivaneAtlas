/** A loader belongs to one runtime/workspace. Never share private bytes across loaders. */
interface Entry {
  promise: Promise<string>;
  users: number;
}
const caches = new WeakMap<
  (path: string) => Promise<Blob>,
  Map<string, Entry>
>();
function trim(cache: Map<string, Entry>) {
  if (cache.size <= 128) return;
  for (const [path, entry] of cache) {
    if (entry.users !== 0) continue;
    cache.delete(path);
    void entry.promise.then(
      (url) => URL.revokeObjectURL(url),
      () => {},
    );
    if (cache.size <= 128) break;
  }
}
export function resolvePrivateImage(
  load: (path: string) => Promise<Blob>,
  path: string,
) {
  let cache = caches.get(load);
  if (!cache) {
    cache = new Map();
    caches.set(load, cache);
  }
  const existing = cache.get(path);
  if (existing) return existing.promise;
  const pending = load(path)
    .then((blob) => URL.createObjectURL(blob))
    .catch((error: unknown) => {
      cache.delete(path);
      throw error;
    });
  cache.set(path, { promise: pending, users: 0 });
  return pending;
}

/** Mounted readers pin URLs. Only unmounted cache entries may be revoked. */
export function holdPrivateImage(
  load: (path: string) => Promise<Blob>,
  path: string,
) {
  const promise = resolvePrivateImage(load, path);
  const cache = caches.get(load)!;
  const entry = cache.get(path)!;
  entry.users++;
  trim(cache);
  let released = false;
  return {
    promise,
    release() {
      if (released) return;
      released = true;
      entry.users--;
      trim(cache);
    },
  };
}
