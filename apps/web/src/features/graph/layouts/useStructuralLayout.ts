import { useRef } from "react";

export function useStructuralLayout<T>(
  ids: readonly string[],
  edges: readonly { source: string; target: string }[],
  layout: (ids: string[], edges: { source: string; target: string }[]) => T,
  key: string,
): T {
  const cache = useRef<{ key: string; value: T } | null>(null);
  if (cache.current?.key === key) return cache.current.value;
  const sortedIds = [...ids].sort();
  const connections = edges
    .map((edge) => ({ source: edge.source, target: edge.target }))
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    );
  cache.current = { key, value: layout(sortedIds, connections) };
  return cache.current.value;
}
