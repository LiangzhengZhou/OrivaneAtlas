import { DomainError } from "@arclattice/domain";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Runtime, Snapshot } from "../../bootstrap";
export function useWorkspaceSync(
  runtime: Runtime,
  onError: Dispatch<SetStateAction<string | null>>,
) {
  const error = useRef(onError);
  error.current = onError;
  const setError = (value: string | null) => error.current(value);
  const errorCode = (cause: unknown) =>
    cause instanceof DomainError ? String(cause.code) : "UNAVAILABLE";
  const [loading, setLoading] = useState(true),
    [syncOffline, setSyncOffline] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    projectMaterials: [],
    items: [],
    edges: [],
    notes: [],
    links: [],
    library: [],
    organization: [],
  });
  async function refresh() {
    try {
      setSnapshot(await runtime.snapshot());
      setSyncOffline(false);
      setError(null);
    } catch (cause) {
      setError(errorCode(cause));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void runtime
      .snapshot()
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((cause) => {
        if (active) setError(errorCode(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [runtime]);
  useEffect(() => {
    let active = true,
      polling = false;
    const poll = async () => {
      if (document.hidden || polling) return;
      polling = true;
      try {
        const value = await runtime.snapshot();
        if (active) {
          setSnapshot(value);
          setSyncOffline(false);
        }
      } catch {
        if (active) setSyncOffline(true);
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 5000);
    const foreground = () => void poll();
    window.addEventListener("online", foreground);
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", foreground);
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [runtime]);

  return { snapshot, setSnapshot, loading, syncOffline, refresh };
}
