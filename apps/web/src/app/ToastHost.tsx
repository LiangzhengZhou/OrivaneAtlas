import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/Button";

interface Toast {
  id: string;
  message: string;
  undo?: () => Promise<void>;
}
export function showToast(message: string, undo?: () => Promise<void>) {
  window.dispatchEvent(
    new CustomEvent<Toast>("atlas:toast", {
      detail: { id: crypto.randomUUID(), message, ...(undo ? { undo } : {}) },
    }),
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss(id: string): void;
}) {
  const { i18n } = useTranslation();
  const [undoing, setUndoing] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 10_000);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.id]);
  const zh = i18n.language.startsWith("zh");
  return (
    <div className="toast">
      <span>{toast.message}</span>
      {toast.undo && (
        <Button
          type="button"
          disabled={undoing}
          onClick={async () => {
            setUndoing(true);
            try {
              await toast.undo?.();
              onDismiss(toast.id);
            } catch {
              showToast(
                zh
                  ? "撤销失败，请刷新后重试"
                  : "Undo failed. Refresh and retry.",
              );
            } finally {
              setUndoing(false);
            }
          }}
        >
          {zh ? "撤销" : "Undo"}
        </Button>
      )}
      <Button
        type="button"
        aria-label={zh ? "关闭" : "Dismiss"}
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </Button>
      <span className="toast-life" aria-hidden="true" />
    </div>
  );
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const hostRef = useRef<HTMLElement>(null);
  const dismiss = useCallback(
    (id: string) => setToasts((old) => old.filter((entry) => entry.id !== id)),
    [],
  );
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--toast-stack-height",
        `${host.getBoundingClientRect().height}px`,
      );
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--toast-stack-height");
    };
  }, []);
  useEffect(() => {
    const listener = (event: Event) =>
      setToasts((old) => [
        ...old.slice(-3),
        (event as CustomEvent<Toast>).detail,
      ]);
    window.addEventListener("atlas:toast", listener);
    return () => window.removeEventListener("atlas:toast", listener);
  }, []);
  return (
    <aside ref={hostRef} className="toast-host" aria-live="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </aside>
  );
}
