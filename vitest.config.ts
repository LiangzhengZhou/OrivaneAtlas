import { configDefaults, defineConfig } from "vitest/config";

const include = ["packages/**/*.test.ts", "apps/web/src/**/*.test.ts"];
const postgres = "packages/storage-postgres/src/**/*.test.ts";
const parsers = "packages/file-parsers/src/**/*.test.ts";
const shared = {
  environment: "node" as const,
  setupFiles: ["tests/integration-budget.ts"],
};

export default defineConfig({
  test: {
    ...shared,
    include,
    // SQLite backup/restore and portable PostgreSQL share the local disk.
    // Bound parallel fixtures instead of weakening their timeout assertions.
    maxWorkers: process.env.CI ? 2 : 4,
    // Cold PDF initialization and independent PostgreSQL physical restores
    // must not contend with the general suite's fsync/CPU load. Keep every
    // original assertion and deadline; this only schedules CI resources.
    ...(process.env.CI
      ? {
          projects: [
            {
              extends: false,
              test: {
                ...shared,
                name: "parsers",
                include: [parsers],
                fileParallelism: false,
                sequence: { groupOrder: 0 },
              },
            },
            {
              extends: false,
              test: {
                ...shared,
                name: "application",
                include,
                exclude: [...configDefaults.exclude, postgres, parsers],
                maxWorkers: 2,
                sequence: { groupOrder: 1 },
              },
            },
            {
              extends: false,
              test: {
                ...shared,
                name: "postgres",
                include: [postgres],
                fileParallelism: false,
                sequence: { groupOrder: 2 },
              },
            },
          ],
        }
      : {}),
  },
});
