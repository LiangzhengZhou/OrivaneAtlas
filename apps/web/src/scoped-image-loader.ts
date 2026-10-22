/** Loader identity is also the private Blob cache boundary. Retired scopes fail closed. */
export function scopedImageLoader(
  identity: () => string,
  load: (path: string) => Promise<Blob>,
) {
  let key: string | undefined;
  let loader: ((path: string) => Promise<Blob>) | undefined;
  return () => {
    const current = identity();
    if (current !== key || !loader) {
      key = current;
      loader = async (path) => {
        if (identity() !== current) throw new Error("SERVER_CHANGED");
        const blob = await load(path);
        if (identity() !== current) throw new Error("SERVER_CHANGED");
        return blob;
      };
    }
    return loader;
  };
}
