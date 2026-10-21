import { it } from "vitest";
import { stablePlanPreviewScenario } from "../../../tests/contracts/stable-plan-preview";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite stable PLAN preview rejects duplicates and stale original baselines atomically", async () => {
  await stablePlanPreviewScenario(await harness.create());
});
