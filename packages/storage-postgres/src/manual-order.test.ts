import { manualOrderContract } from "../../../tests/contracts/manual-order";
import { postgresHarness } from "./testing";

const h = postgresHarness();
manualOrderContract("PostgreSQL", () => h.create());
