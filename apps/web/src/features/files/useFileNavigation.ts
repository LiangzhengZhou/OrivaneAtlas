import type { LibraryFile } from "@arclattice/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { fileHash, parseFileHash } from "./fileRoute";

/** File routing owns only File tabs; Task/Graph queries and selection are preserved. */
export function useFileNavigation(
  files: readonly LibraryFile[],
  onOpen: (file: LibraryFile) => void,
) {
  const [requested, setRequested] = useState(() =>
    parseFileHash(location.hash),
  );
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const read = () => setRequested(parseFileHash(location.hash));
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, []);
  useEffect(() => {
    if (!requested) {
      opened.current = null;
      return;
    }
    if (opened.current === requested) return;
    const file = files.find((file) => file.id === requested && !file.deletedAt);
    if (!file) return;
    opened.current = requested;
    onOpen(file);
  }, [requested, files, onOpen]);
  return useCallback(
    (id: string) => {
      const file = files.find((file) => file.id === id && !file.deletedAt);
      if (!file) return false;
      opened.current = id;
      setRequested(id);
      if (location.hash !== fileHash(id))
        history.pushState(null, "", fileHash(id));
      onOpen(file);
      return true;
    },
    [files, onOpen],
  );
}
