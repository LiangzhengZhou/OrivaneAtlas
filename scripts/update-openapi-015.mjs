// Mechanical OpenAPI migration for the organization application contract.
import { readFileSync, writeFileSync } from "node:fs";

const path = "docs/api/openapi.json";
const doc = JSON.parse(readFileSync(path, "utf8"));
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const str = { type: "string" };
const version = { type: "integer", minimum: 1 };
const kind = { type: "string", enum: ["WORK", "NOTE"] };
doc.info.version = "0.6.0";
doc.components.schemas.Organization = object({
  kind,
  id: str,
  workspaceId: str,
  version,
  archived: { type: "boolean" },
  folder: str,
  updatedAt: str,
  updatedBy: str,
});
doc.components.schemas.Snapshot.properties.organization = {
  type: "array",
  items: { $ref: "#/components/schemas/Organization" },
};
if (!doc.components.schemas.Snapshot.required.includes("organization"))
  doc.components.schemas.Snapshot.required.push("organization");
const route = structuredClone(doc.paths["/api/work/delete"]);
route.post.operationId = "organizeItems";
route.post.summary =
  "Atomically archive/unarchive tasks or move/delete selected notes and journals";
route.post.description =
  "Cookie + CSRF or write/read-write Bearer. Idempotency-Key required. Entire batch rolls back on stale entity or organization version, missing/deleted entity, foreign workspace or invalid entry. Maximum100 distinct IDs. organizationVersion0 means no metadata. Archive/unarchive require WORK (not PROJECT), preserve task status and dependencies. Move requires NOTE (including JOURNAL), folder up to80 characters trimmed; empty means Unfiled. Journal kind/day and all Markdown remain unchanged. Delete is recoverable soft deletion. Snapshot includes organization metadata; use its version on subsequent operations. No autonomous Agent tool is added.";
route.post.requestBody.content["application/json"].schema = object(
  {
    kind,
    action: {
      type: "string",
      enum: ["archive", "unarchive", "move", "delete"],
    },
    folder: { type: "string", maxLength: 80 },
    entries: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: object({
        id: str,
        version,
        organizationVersion: { type: "integer", minimum: 0 },
      }),
    },
  },
  ["kind", "action", "entries"],
);
route.post.responses["200"].content["application/json"].schema = object({
  changed: { type: "integer", minimum: 1, maximum: 100 },
});
doc.paths["/api/organize"] = route;
const alias = structuredClone(route);
alias.post.operationId += "V1";
doc.paths["/api/v1/organize"] = alias;
writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
