import type { ComponentProps } from "react";
import { GraphWorkspace } from "../../features/graph/GraphWorkspace";
import { useGraphRoute } from "../hooks/useGraphRoute";

/** Graph route/viewport changes stay within the mounted graph workspace. */
export function GraphRoute({
  onRouteAccepted,
  ...props
}: Omit<ComponentProps<typeof GraphWorkspace>, "route" | "onRouteChange"> & {
  onRouteAccepted(): void;
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
}
