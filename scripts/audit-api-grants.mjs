import { readFileSync } from "node:fs";

const server = readFileSync("packages/host/src/server.ts", "utf8");
const files = readFileSync("packages/host/src/file-routes.ts", "utf8");
const policy = readFileSync("packages/host/src/api-authorization.ts", "utf8");
const legacy = (name) =>
  new Set(
    [
      ...(
        server.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1] ??
        ""
      ).matchAll(/"([^"]+)"/g),
    ].map((entry) => entry[1]),
  );
const legacyReads = legacy("readable");
const legacyWrites = legacy("writable");
const grants = new Map(
  [...policy.matchAll(/"(\/api\/[^"]+)":\s*\[([^\]]+)\]/g)].map(
    ([, route, values]) => [
      route,
      [...values.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]).join(", "),
    ],
  ),
);
const routes = [
  ...new Set(
    [...(server + files).matchAll(/"(\/api\/[A-Za-z0-9_./-]+)"/g)].map(
      (entry) => entry[1],
    ),
  ),
]
  .filter((route) => !route.endsWith("/") && route !== "/api/files")
  .sort();
console.log("# API credential authorization matrix\n");
console.log(
  "Both `/api` and `/api/v1` aliases use the normalized route. Granular credentials never fall back to the legacy allowlist. Null durable grants identify legacy credentials; explicit arrays must be nonempty and valid. Legacy credentials retain only their historical allowlist. Cookie writes additionally require CSRF. Unknown routes deny bearer access.\n",
);
console.log(
  "The table is generated from actual Host route literals and the shared route grants map. HUMAN means bearer denied regardless of grants, retaining existing human approval/private-owner boundaries. Login/health are pre-authentication routes; their own validation still applies.\n",
);
console.log(
  "| Route (both aliases) | Granular bearer required grants | Legacy profile | Trusted check |\n|---|---|---|---|",
);
for (const route of routes) {
  const publicRoute = ["/api/health", "/api/session", "/api/register"].includes(
    route,
  );
  console.log(
    `| \`${route}\` | ${grants.get(route) ?? (publicRoute ? "Dedicated login/health contract" : "HUMAN / bearer denied")} | ${[legacyReads.has(route) ? "GET: read-write only" : "", legacyWrites.has(route) ? "POST: write/read-write" : ""].filter(Boolean).join("; ") || "bearer denied"} | ${grants.has(route) ? "request + transaction recheck; Application scope/version checks" : "dedicated handler + default-deny bearer gate"} |`,
  );
}
console.log(
  "\nMCP `tools/call` additionally requires CapabilityDefinition.requiredScopes inside the transaction. Special tools: workspace_snapshot requires capabilities:execute + workspace:read + tasks:read + projects:read + knowledge:read; plan_preview requires capabilities:execute + plans:propose + proposals:write; project_document_create requires capabilities:execute + projects:write + knowledge:write. Atlas/Memo approval and Apply remain human-only, with owner/content policy/version revalidation at approval and execution. Merely declaring a grant never grants a human-only route.\n",
);
console.log(
  "PostgreSQL v37 is a business-schema compatibility marker: this backend has no AccountStore/api_credential table. Credential persistence, legacy upgrade, revocation and restore are validated on the actual SQLite Host token store; PG fresh/upgrade and physical backup restore remain independently tested.",
);
