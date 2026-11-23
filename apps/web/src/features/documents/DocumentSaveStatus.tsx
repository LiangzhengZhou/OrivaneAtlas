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
  type Persistence = Awaited<ReturnType<Runtime["documentPersistenceState"]>>;
  const [state, setState] = useState<Persistence | "unavailable" | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true,
      reading = false,
      requested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = async () => {
      if (!active || document.hidden) return;
      if (reading) {
        requested = true;
        return;
      }
      clearTimeout(timer);
      reading = true;
      requested = false;
      let delay = 5000;
      try {
        const next = await runtime.documentPersistenceState(
          library ? "library" : "notes",
          id,
        );
        if (active)
          setState((previous) =>
            previous &&
            previous !== "unavailable" &&
            previous.bound === next.bound &&
            previous.pending === next.pending &&
            previous.offline === next.offline
              ? previous
              : next,
          );
        if (next.pending) delay = 1000;
      } catch {
        if (active) setState("unavailable");
      } finally {
        reading = false;
        if (active) timer = setTimeout(update, requested ? 0 : delay);
      }
    };
    void update();
    const stop = runtime.subscribeWorkspace(update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      active = false;
      stop();
      clearTimeout(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("visibilitychange", update);
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
        : !id
          ? zh
            ? "草稿"
            : "Draft"
          : state === "unavailable"
            ? zh
              ? "无法读取同步状态"
              : "Sync status unavailable"
            : !state
              ? zh
                ? "正在检查保存状态"
                : "Checking save status"
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
    <span
      role="status"
      data-locally-saved={
        !!id && !!state && state !== "unavailable" && !dirty && !busy && !error
      }
    >
      {text}
    </span>
  );
}
