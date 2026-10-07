import { expect, vi } from "vitest";

const path = expect.getState().testPath?.replaceAll("\\", "/") ?? "";
if (/\/packages\/(host|storage-[^/]+)\/src\//.test(path)) {
  // Includes real schema migration, durable fsync and encrypted physical backup.
  // These correctness tests are not five-second interaction benchmarks.
  vi.setConfig({ testTimeout: 30_000 });
}
