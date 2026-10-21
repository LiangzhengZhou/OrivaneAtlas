import { DomainError, requireManualOrderState } from "@arclattice/domain";
import { localDto } from "./local-dto";
import type { LocalJson } from "./local-persistence";

export function validateLocalCanonicalManualOrder(
  id: string,
  workspaceId: string,
  version: number,
  value: LocalJson,
): void {
  const state = requireManualOrderState(value);
  if (
    state.id !== id ||
    state.workspaceId !== workspaceId ||
    state.version !== version
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "canonicalManualOrder",
    });
}
export function projectLocalManualOrder(
  value: LocalJson,
  workspaceId: string,
): LocalJson {
  const state = requireManualOrderState(value);
  return localDto(
    requireManualOrderState({
      ...state,
      workspaceId,
      entries: state.entries.map((entry) => ({ ...entry, workspaceId })),
    }),
  );
}
