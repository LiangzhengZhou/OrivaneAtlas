import { manualOrderContract } from "../../../tests/contracts/manual-order";
import { MemoryUnitOfWork } from "./index";

manualOrderContract("Memory", () => new MemoryUnitOfWork());
