import { type ComponentProps, memo } from "react";
import { GraphWorkspace } from "../../features/graph/GraphWorkspace";
import { useGraphRoute } from "../hooks/useGraphRoute";

/** Graph route/viewport changes stay within the mounted graph workspace. */
export const GraphRoute = memo(
  function GraphRoute({
    onRouteAccepted,
    active: _active,
    scopeKey: _scopeKey,
    ...props
  }: Omit<ComponentProps<typeof GraphWorkspace>, "route" | "onRouteChange"> & {
    onRouteAccepted(): void;
    active?: boolean;
    scopeKey: string;
  }) {
    const navigation = useGraphRoute();
    if (!navigation.route) return null;
    return (
      <GraphWorkspace
        {...props}
        route={navigation.route}
        onRouteChange={(patch) => {
          navigation.update(patch);
          onRouteAccepted();
        }}
      />
    );
  },
  (previous, next) =>
    previous.scopeKey === next.scopeKey &&
    previous.active === false &&
    next.active === false,
);
