import { useEffect, useState } from "react";
import type { Runtime } from "../../bootstrap";

export function DocumentSaveStatus({
  runtime,
  id,
  library,
  dirty,
  busy,
  error,
  zh,
}: {
  runtime: Runtime;
  id?: string | undefined;
  library: boolean;
  dirty: boolean;
  busy: boolean;
  error: boolean;
  zh: boolean;
}) {
  const [state, setState] = useState({
    bound: false,
    pending: true,
    offline: !navigator.onLine,
  });
  useEffect(() => {
    let active = true,
      sequence = 0;
    const update = () => {
      if (!id) return;
      const current = ++sequence;
      void runtime
        .documentPersistenceState(library ? "library" : "notes", id)
        .then(
          (next) => {
            if (active && current === sequence) setState(next);
          },
          () => {
            if (active && current === sequence)
              setState((old) => ({ ...old, offline: true }));
          },
        );
    };
    update();
    const stop = runtime.subscribeWorkspace(update);
    const timer = setInterval(update, 1000);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      active = false;
      stop();
      clearInterval(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [runtime, library, id]);
  const text = error
    ? zh
      ? "保存失败"
      : "Save failed"
    : busy
      ? zh
        ? "正在保存到本机"
        : "Saving on this device"
      : dirty
        ? zh
          ? "未保存"
          : "Unsaved"
        : state.offline
          ? zh
            ? "已保存到本机 · 离线"
            : "Saved on this device · Offline"
          : !state.bound
            ? zh
              ? "已保存到本机"
              : "Saved on this device"
            : state.pending
              ? zh
                ? "已保存到本机 · 正在同步"
                : "Saved on this device · Syncing"
              : zh
                ? "已同步"
                : "Synced";
  return (
    <span role="status" data-locally-saved={!dirty && !busy && !error}>
      {text}
    </span>
  );
}
