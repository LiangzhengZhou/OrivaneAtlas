import { useEffect, useState } from "react";
import {
  type GraphRoute,
  graphHash,
  parseGraphRoute,
} from "../../features/graph/graph-route";

export function useGraphRoute() {
  const [route, setRoute] = useState(() => parseGraphRoute(location.hash));
  useEffect(() => {
    const restore = () => setRoute(parseGraphRoute(location.hash));
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, []);
  function update(patch: Partial<GraphRoute>) {
    const current = parseGraphRoute(location.hash);
    if (!current) return;
    const next = { ...current, ...patch };
    history.replaceState(null, "", graphHash(next));
    setRoute(next);
  }
  return { route, update };
}
