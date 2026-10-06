export interface GraphRoute {
  view?: "tree" | "graph";
  kind: "project" | "document";
  id: string;
  mode: "structure" | "dependencies" | "knowledge";
  scope: string;
  depth: number;
  hops: number;
  focus: string;
  selection: string;
  back: string;
  expandedIds?: readonly string[];
  viewport?: { x: number; y: number; zoom: number };
}
export function parseGraphRoute(hash: string): GraphRoute | null {
  const match = /^#\/?graph\/(project|document)\/([^?]+)(?:\?(.*))?$/.exec(
    hash,
  );
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[2]!);
    if (!id || id.length > 240) return null;
    const query = new URLSearchParams(match[3]);
    const kind = match[1] as GraphRoute["kind"],
      candidate = query.get("mode");
    const mode =
      kind === "document"
        ? "knowledge"
        : candidate === "dependencies" || candidate === "knowledge"
          ? candidate
          : "structure";
    const back =
      query.get("back") ??
      (kind === "project" ? "#projects/" + encodeURIComponent(id) : "#library");
    const rawViewport = query.get("viewport")?.split(",");
    const values = rawViewport?.every((value) => value.trim().length > 0)
      ? rawViewport.map(Number)
      : undefined;
    const viewport =
      values?.length === 3 &&
      values.every(Number.isFinite) &&
      values[2]! >= 0.1 &&
      values[2]! <= 2
        ? { x: values[0]!, y: values[1]!, zoom: values[2]! }
        : undefined;
    return {
      ...(query.get("view") === "graph" || query.get("view") === "tree"
        ? { view: query.get("view") as "tree" | "graph" }
        : {}),
      kind,
      id,
      mode,
      scope:
        query.get("scope") ??
        (mode === "knowledge"
          ? kind === "document"
            ? "local"
            : "project"
          : "focus"),
      depth: query.get("depth") === "2" ? 2 : 1,
      ...(query.has("manual") ? { expandedIds: query.getAll("expanded") } : {}),
      ...(viewport ? { viewport } : {}),
      hops: query.get("hops") === "2" ? 2 : 1,
      focus: query.get("focus") ?? (kind === "document" ? id : ""),
      selection: query.get("selection") ?? query.get("focus") ?? id,
      back: /^#(?:projects|tasks|library)(?:[/?]|$)/.test(back)
        ? back
        : "#" + (kind === "project" ? "projects" : "library"),
    };
  } catch {
    return null;
  }
}
export function graphHash(route: GraphRoute): string {
  const expansion = new URLSearchParams();
  if (route.expandedIds) {
    expansion.set("manual", "1");
    for (const id of route.expandedIds) expansion.append("expanded", id);
  }
  return (
    "#graph/" +
    route.kind +
    "/" +
    encodeURIComponent(route.id) +
    "?" +
    new URLSearchParams({
      ...(route.view ? { view: route.view } : {}),
      ...(route.viewport
        ? {
            viewport: [
              route.viewport.x,
              route.viewport.y,
              route.viewport.zoom,
            ].join(","),
          }
        : {}),
      mode: route.mode,
      scope: route.scope,
      depth: String(route.depth),
      hops: String(route.hops),
      focus: route.focus,
      selection: route.selection,
      back: route.back,
    }) +
    (expansion.size ? "&" + expansion : "")
  );
}
export function openGraph(
  input: Pick<GraphRoute, "kind" | "id" | "mode"> & Partial<GraphRoute>,
) {
  location.hash = graphHash({
    depth: 1,
    hops: 1,
    scope:
      input.mode === "knowledge"
        ? input.kind === "document"
          ? "local"
          : "project"
        : "focus",
    focus: input.kind === "document" ? input.id : "",
    selection: input.id,
    back: location.hash,
    ...input,
  });
}
