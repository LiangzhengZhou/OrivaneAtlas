import { DomainError } from "@arclattice/domain";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Runtime, Snapshot } from "../../bootstrap";
import { coalescedRefresh } from "../coalesced-refresh";
import { connectedWorkspaceSync } from "../connected-workspace-sync";
import { stableWorkspaceSnapshot } from "../stable-workspace-snapshot";
import { workspaceSnapshotLoader } from "../workspace-snapshot-loader";
import {
  type WorkspaceSyncIssue,
  workspaceSyncIssue,
} from "../workspace-sync-issue";

export function useWorkspaceSync(
  runtime: Pick<
    Runtime,
    | "context"
    | "serverOrigin"
    | "native"
    | "storageMode"
    | "workspaceRevision"
    | "loadWorkspaceWithRevision"
    | "synchronizeConnectedWorkspace"
    | "subscribeWorkspace"
    | "streamWorkspaceEvents"
  >,
  onError: Dispatch<SetStateAction<string | null>>,
) {
  const error = useRef(onError);
  error.current = onError;
  const identity = `${runtime.serverOrigin}|${runtime.context?.workspaceId}|${runtime.context?.principalId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const generation = useRef(0),
    mounted = useRef(true);
  const [loading, setLoading] = useState(true),
    [snapshotFailed, setSnapshotFailed] = useState(false),
    [networkIssue, setNetworkIssue] = useState<WorkspaceSyncIssue | null>(null);
  const wakeSync = useRef<(() => void) | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    projectMaterials: [],
    items: [],
    edges: [],
    notes: [],
    links: [],
    library: [],
    organization: [],
  });
  const [attentionTick, setAttentionTick] = useState(0);
  const loadSnapshot = useMemo(
    () =>
      workspaceSnapshotLoader(
        () => runtime.workspaceRevision(),
        () => runtime.loadWorkspaceWithRevision(),
        (value) => value.revision,
      ),
    [runtime, identity],
  );
  const readSnapshot = useCallback(
    async (showError: boolean) => {
      const sequence = ++generation.current;
      try {
        await loadSnapshot((value) => {
          if (
            !mounted.current ||
            identityRef.current !== identity ||
            sequence !== generation.current
          )
            return false;
          setSnapshot((previous) =>
            stableWorkspaceSnapshot(previous, value.snapshot),
          );
          return true;
        });
        if (
          !mounted.current ||
          identityRef.current !== identity ||
          sequence !== generation.current
        )
          return;
        setAttentionTick((tick) => tick + 1);
        setSnapshotFailed(false);
        if (showError) error.current(null);
      } catch (cause) {
        if (!mounted.current || identityRef.current !== identity) return;
        if (sequence === generation.current) setSnapshotFailed(true);
        if (showError)
          error.current(
            cause instanceof DomainError ? String(cause.code) : "UNAVAILABLE",
          );
      } finally {
        if (
          mounted.current &&
          identityRef.current === identity &&
          sequence === generation.current
        )
          setLoading(false);
      }
    },
    [runtime, identity, loadSnapshot],
  );
  const fetchSnapshot = useMemo(
    () => coalescedRefresh(readSnapshot),
    [readSnapshot],
  );
  const refresh = useCallback(() => fetchSnapshot(true), [fetchSnapshot]);
  const retrySync = useCallback(() => {
    wakeSync.current?.();
    void refresh();
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    setSnapshotFailed(false);
    setNetworkIssue(null);
    let active = true,
      pulling = false,
      requested = false,
      connected = false,
      attempts = 0,
      lastCursor = "";
    let stream: AbortController | null = null,
      reconnect: number | undefined;
    const visible = () =>
      !document.hidden && (runtime.storageMode === "local" || navigator.onLine);
    const pull = async () => {
      if (!active || !visible()) return;
      requested = true;
      if (pulling) return;
      pulling = true;
      try {
        do {
          requested = false;
          await fetchSnapshot(false);
        } while (requested && active && visible());
      } finally {
        pulling = false;
      }
    };
    const disconnect = () => {
      window.clearTimeout(reconnect);
      stream?.abort();
      stream = null;
      connected = false;
    };
    const connect = () => {
      if (
        !active ||
        runtime.storageMode === "local" ||
        runtime.native ||
        !visible() ||
        stream
      )
        return;
      const controller = new AbortController();
      stream = controller;
      void runtime
        .streamWorkspaceEvents(
          lastCursor,
          controller.signal,
          (cursor) => {
            if (!active || controller.signal.aborted) return;
            if (cursor !== lastCursor) {
              lastCursor = cursor;
              void pull();
            }
          },
          () => {
            if (!active || controller.signal.aborted) return;
            connected = true;
            attempts = 0;
          },
        )
        .catch(() => {
          if (!active || controller.signal.aborted) return;
          connected = false;
          reconnect = window.setTimeout(
            () => {
              if (stream === controller) stream = null;
              void pull();
              connect();
            },
            Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)),
          );
        });
    };
    const foreground = () => {
      if (!visible()) {
        disconnect();
        if (runtime.storageMode !== "local" && !navigator.onLine)
          setSnapshotFailed(true);
        return;
      }
      void pull();
      connect();
    };
    if (runtime.storageMode === "local") {
      const network = connectedWorkspaceSync({
        sync: () => runtime.synchronizeConnectedWorkspace(),
        stream: runtime.native
          ? undefined
          : (cursor, signal, changed, connected) =>
              runtime.streamWorkspaceEvents(cursor, signal, changed, connected),
        schedule: (callback, delay) => {
          const timer = window.setTimeout(callback, delay);
          return () => window.clearTimeout(timer);
        },
        visible: () => !document.hidden && navigator.onLine,
        onOffline: (failed, cause) =>
          setNetworkIssue(failed ? workspaceSyncIssue(cause) : null),
      });
      const unsubscribe = runtime.subscribeWorkspace(() => {
        void pull();
        network.wake();
      });
      const wakeNetwork = network.wake;
      wakeSync.current = wakeNetwork;
      void refresh();
      window.addEventListener("online", wakeNetwork);
      window.addEventListener("focus", foreground);
      window.addEventListener("focus", wakeNetwork);
      document.addEventListener("visibilitychange", foreground);
      document.addEventListener("visibilitychange", wakeNetwork);
      return () => {
        active = false;
        mounted.current = false;
        ++generation.current;
        unsubscribe();
        wakeSync.current = null;
        network.stop();
        window.removeEventListener("online", wakeNetwork);
        window.removeEventListener("focus", foreground);
        window.removeEventListener("focus", wakeNetwork);
        document.removeEventListener("visibilitychange", foreground);
        document.removeEventListener("visibilitychange", wakeNetwork);
      };
    }
    void refresh();
    connect();
    const fallback = window.setInterval(() => {
      if (runtime.native || !connected) void pull();
    }, 30000);
    window.addEventListener("online", foreground);
    window.addEventListener("offline", foreground);
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      active = false;
      mounted.current = false;
      ++generation.current;
      disconnect();
      window.clearInterval(fallback);
      window.removeEventListener("online", foreground);
      window.removeEventListener("offline", foreground);
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [runtime, identity, fetchSnapshot, refresh]);
  return {
    snapshot,
    setSnapshot,
    loading,
    syncIssue: snapshotFailed
      ? runtime.storageMode === "local"
        ? ("localReadFailed" as const)
        : ("syncFailed" as const)
      : networkIssue,
    retrySync,
    refresh,
    attentionTick,
  };
}
