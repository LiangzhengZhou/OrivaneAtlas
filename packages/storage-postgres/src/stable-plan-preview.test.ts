import { it } from "vitest";
import { stablePlanPreviewScenario } from "../../../tests/contracts/stable-plan-preview";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL stable PLAN preview rejects duplicates and stale original baselines atomically", async () => {
  const name = await harness.database();
  await stablePlanPreviewScenario(
    await harness.provision(await harness.open(name)),
  );
}, 30000);
