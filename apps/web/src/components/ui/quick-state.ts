export type QuickStateArm = {
  entityId: string;
  intent: "COMPLETE" | "RESTORE";
  expiresAt: number;
};

export function armQuickState(
  previous: QuickStateArm | null,
  entityId: string,
  intent: QuickStateArm["intent"],
  now: number,
): { arm: QuickStateArm | null; commit: boolean } {
  if (
    previous?.entityId === entityId &&
    previous.intent === intent &&
    now < previous.expiresAt
  )
    return { arm: null, commit: true };
  return { arm: { entityId, intent, expiresAt: now + 4000 }, commit: false };
}
