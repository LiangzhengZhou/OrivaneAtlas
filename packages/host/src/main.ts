import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openPersonalVault } from "./personal-model";
import { createHost } from "./server";

const data = process.env.ARCLATTICE_DATA;
if (!data)
  throw new Error("ARCLATTICE_DATA must be an explicit private data directory");
await mkdir(data, { recursive: true, mode: 0o700 });
const keyFile = resolve(data, "access.key");
try {
  await writeFile(keyFile, randomBytes(32).toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}
const port = Number(process.env.ARCLATTICE_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid port");
const host = await createHost({
  calendarTimezone: process.env.ARCLATTICE_CALENDAR_TIMEZONE ?? "UTC",
  vault: openPersonalVault(resolve(data, "vault")),
  database: resolve(data, "workbench.sqlite"),
  secret: (await readFile(keyFile, "utf8")).trim(),
  origin: process.env.ARCLATTICE_ORIGIN ?? "http://127.0.0.1:" + port,
  webRoot: resolve(process.env.ARCLATTICE_WEB_ROOT ?? "apps/web/dist"),
});
host.server.listen(port, "127.0.0.1", () =>
  console.log(
    "Orivane Atlas workbench " +
      (process.env.ARCLATTICE_ORIGIN ?? "http://127.0.0.1:" + port) +
      " (access key in private data directory)",
  ),
);
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (!closing) {
      closing = true;
      void host.close().then(() => process.exit(0));
    }
  });
