import { type ComponentProps, useSyncExternalStore } from "react";
import { AssistantPane } from "../../features/ai/AssistantPane";
import type { createViewStore } from "../hooks/view-store";

export function AtlasRoute({
  viewStore,
  ...props
}: Omit<ComponentProps<typeof AssistantPane>, "requestedSessionId"> & {
  viewStore: ReturnType<typeof createViewStore<string | null>>;
}) {
  const sessionId = useSyncExternalStore(
    viewStore.subscribe,
    viewStore.getSnapshot,
  );
  return <AssistantPane {...props} requestedSessionId={sessionId} />;
}
