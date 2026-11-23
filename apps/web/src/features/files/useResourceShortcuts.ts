import { useEffect, useRef, useState } from "react";

type Shortcuts = { favorites: string[]; recent: string[] };
const empty = (): Shortcuts => ({ favorites: [], recent: [] });
const recentLimit = 40;

function parse(raw: string | null): Shortcuts {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    const keys = (value: unknown): string[] =>
      Array.isArray(value)
        ? [
            ...new Set(
              value.filter(
                (id): id is string =>
                  typeof id === "string" && /^(FILE|NOTE|DOCUMENT):.+/.test(id),
              ),
            ),
          ]
        : [];
    return {
      favorites: keys(parsed.favorites),
      recent: keys(parsed.recent).slice(0, recentLimit),
    };
  } catch {
    return empty();
  }
}

/** FilesWorkspace is keyed by identity. Only typed references live on disk. */
export function useResourceShortcuts(scopeKey: string) {
  const key = "orivane-atlas.files.shortcuts.v1." + scopeKey;
  const [state, setState] = useState(() => {
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return empty();
    }
  });
  const current = useRef(state);
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (
        event.storageArea !== localStorage ||
        (event.key !== null && event.key !== key)
      )
        return;
      current.current = parse(event.newValue);
      setState(current.current);
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  function update(transform: (value: Shortcuts) => Shortcuts) {
    let next: Shortcuts;
    try {
      const stored = localStorage.getItem(key);
      next = transform(stored === null ? current.current : parse(stored));
    } catch {
      next = transform(current.current);
    }
    current.current = next;
    setState(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Storage may be unavailable in a private session. */
    }
  }
  return {
    ...state,
    markOpened(id: string) {
      update((value) => ({
        ...value,
        recent: [id, ...value.recent.filter((key) => key !== id)].slice(
          0,
          recentLimit,
        ),
      }));
    },
    setFavorites(ids: readonly string[], favorite: boolean) {
      const changed = new Set(ids);
      update((value) => ({
        ...value,
        favorites: favorite
          ? [...new Set([...value.favorites, ...changed])]
          : value.favorites.filter((key) => !changed.has(key)),
      }));
    },
  };
}
