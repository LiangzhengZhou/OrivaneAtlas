import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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
export function ToastHost() {
  const { i18n } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<string | null>(null);
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
    <aside className="toast-host" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id}>
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              disabled={pending === toast.id}
              onClick={async () => {
                setPending(toast.id);
                try {
                  await toast.undo?.();
                  setToasts((old) =>
                    old.filter((entry) => entry.id !== toast.id),
                  );
                } catch {
                  showToast(
                    i18n.language.startsWith("zh")
                      ? "撤销失败，请刷新后重试"
                      : "Undo failed. Refresh and retry.",
                  );
                } finally {
                  setPending(null);
                }
              }}
            >
              {i18n.language.startsWith("zh") ? "撤销" : "Undo"}
            </button>
          )}
          <button
            type="button"
            aria-label={i18n.language.startsWith("zh") ? "关闭" : "Dismiss"}
            onClick={() =>
              setToasts((old) => old.filter((entry) => entry.id !== toast.id))
            }
          >
            ×
          </button>
        </div>
      ))}
    </aside>
  );
}
