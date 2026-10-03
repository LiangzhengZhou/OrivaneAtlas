import { useRef } from "react";

export function useStructuralLayout<T>(
  ids: readonly string[],
  edges: readonly { source: string; target: string }[],
  layout: (ids: string[], edges: { source: string; target: string }[]) => T,
): T {
  const sortedIds = [...ids].sort();
  const connections = edges
    .map((edge) => ({ source: edge.source, target: edge.target }))
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    );
  const key = JSON.stringify([sortedIds, connections]);
  const cache = useRef<{ key: string; value: T } | null>(null);
  if (!cache.current || cache.current.key !== key)
    cache.current = { key, value: layout(sortedIds, connections) };
  return cache.current.value;
}
