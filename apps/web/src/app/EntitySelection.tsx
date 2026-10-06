import type { EntityRef } from "@arclattice/application";
import { createContext, useContext } from "react";

export const EntitySelectionContext = createContext<{
  selected: EntityRef | null;
  select(ref: EntityRef): void;
} | null>(null);
export function useEntitySelection() {
  return useContext(EntitySelectionContext);
}
