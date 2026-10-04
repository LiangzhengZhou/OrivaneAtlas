import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./Surfaces";

type Request = { message: string; resolve(value: boolean): void };
let requests: Request[] = [];
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function confirmAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    requests = [...requests, { message, resolve }];
    notify();
  });
}

export function ConfirmationHost() {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const request = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => requests[0] ?? null,
  );
  if (!request) return null;
  const finish = (answer: boolean) => {
    if (requests[0] !== request) return;
    requests = requests.slice(1);
    request.resolve(answer);
    notify();
  };
  return (
    <ConfirmDialog
      title={zh ? "确认操作" : "Confirm action"}
      confirmLabel={zh ? "确认" : "Confirm"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    >
      <p>{request.message}</p>
    </ConfirmDialog>
  );
}
