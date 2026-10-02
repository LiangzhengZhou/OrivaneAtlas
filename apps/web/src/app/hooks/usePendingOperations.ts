import { useRef, useState } from "react";

export function usePendingOperations() {
  const active = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const runPending = async <T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    if (active.current.has(key)) throw new Error("OPERATION_PENDING");
    active.current.add(key);
    setPending(new Set(active.current));
    try {
      return await operation();
    } finally {
      active.current.delete(key);
      setPending(new Set(active.current));
    }
  };
  return { isPending: (key: string) => pending.has(key), runPending };
}
