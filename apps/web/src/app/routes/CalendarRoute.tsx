import { type ComponentProps, useSyncExternalStore } from "react";
import {
  CalendarView,
  type CalendarViewState,
} from "../../features/calendar/CalendarWorkspace";
import type { createViewStore } from "../hooks/view-store";

export function CalendarRoute({
  viewStore,
  ...props
}: Omit<
  ComponentProps<typeof CalendarView>,
  "viewState" | "onViewStateChange"
> & {
  viewStore: ReturnType<typeof createViewStore<CalendarViewState>>;
}) {
  const state = useSyncExternalStore(
    viewStore.subscribe,
    viewStore.getSnapshot,
  );
  return (
    <CalendarView
      {...props}
      viewState={state}
      onViewStateChange={viewStore.set}
    />
  );
}
