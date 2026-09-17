import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    environment: "node",
    // SQLite backup/restore and portable PostgreSQL share the local disk.
    // Bound parallel fixtures instead of weakening their timeout assertions.
    maxWorkers: 4,
  },
});
