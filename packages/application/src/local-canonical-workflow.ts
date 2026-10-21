import { validateLocalCanonicalPlanValue } from "./local-canonical-plan";
import { validateLocalCanonicalRecurrenceValue } from "./local-canonical-recurrence";
import { localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";

export function validateLocalCanonicalWorkflowValue(
  id: string,
  workspaceId: string,
  version: number,
  value: LocalJson,
): void {
  const payload = localObject(localObject(value).payload ?? null);
  if (payload.kind === "PLAN")
    validateLocalCanonicalPlanValue(id, workspaceId, version, value);
  else validateLocalCanonicalRecurrenceValue(id, workspaceId, version, value);
}
