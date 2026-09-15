// One-time mechanical contract migration. No server or business data access.
import { readFileSync, writeFileSync } from "node:fs";

const path = "docs/api/openapi.json";
const doc = JSON.parse(readFileSync(path, "utf8"));
const s = doc.components.schemas,
  p = doc.paths;
const ref = (name) => ({ $ref: "#/components/schemas/" + name });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const str = { type: "string" },
  version = { type: "integer", minimum: 1 };
const scope = {
  type: "string",
  pattern: "^(personal|(?:WORK|SPACE):[^:]+)$",
  default: "personal",
  description:
    "Personal configuration or own active project / knowledge-space ID. No administrator-global model.",
};
doc.info.title = "Orivane Atlas workspace API";
doc.info.version = "0.5.0";
doc.info.description =
  doc.info.description.replace(
    "30-day revocable",
    "30/90/365-day or non-expiring revocable",
  ) +
  " Personal encrypted provider settings support Chat Completions and Responses. Explicit review authorizes one call with selected versioned documents; results never auto-apply. SQLite backup excludes the separate provider vault and its master key.";
s.Snapshot.properties.library = { type: "array", items: ref("LibraryEntry") };
if (!s.Snapshot.required.includes("library"))
  s.Snapshot.required.push("library");
s.EntityRef.properties.kind.enum = ["NOTE", "WORK", "SPACE", "DOCUMENT"];
s.ModelRoute.properties.scope = scope;
s.AgentRun.properties.context = {
  type: "array",
  maxItems: 20,
  items: object({ ref: ref("EntityRef"), version, title: str, bodyMd: str }),
};
s.AgentRun.properties.appliedAt = str;
for (const name of ["ApiCredential", "IssuedCredential"])
  s[name].properties.expiresAt = {
    type: ["string", "null"],
    description:
      "null means no scheduled expiry; revocation, password changes and account suspension still apply.",
  };
const token = p["/api/tokens/create"].post;
token.summary = "Create revocable API credential; secret shown once";
token.description =
  "Cookie account required. days defaults to 30; allowed 30, 90, 365 or null (no expiry). Existing credentials retain original expiry. Secret response is never replayed; uncertain retries require reviewing credentials and revoking as needed.";
token.requestBody.content["application/json"].schema.properties.days = {
  type: ["integer", "null"],
  enum: [30, 90, 365, null],
  default: 30,
};
const identity = object({ workspaceId: str, principalId: str });
const credentials = structuredClone(s.Credentials);
credentials.properties.expectedContext = identity;
const login = p["/api/session"].post;
login.requestBody.content["application/json"].schema.oneOf = [
  credentials,
  object(
    {
      secret: { type: "string", maxLength: 256, writeOnly: true },
      expectedContext: identity,
    },
    ["secret"],
  ),
];
login.description =
  "Optional expectedContext binds draft reauthentication to the original identity. Mismatch returns 403 without replacing the existing cookie. No idempotency receipt.";
p["/api/ai"].get.parameters = [{ name: "scope", in: "query", schema: scope }];
const proposal = p["/api/ai/propose"].post;
proposal.description =
  "Cookie only. Resolve personal scope config and explicitly selected own live documents at exact versions (max20). SPACE scope restricts sources to that space. Combined prompt plus context is capped at32000 characters. Does not call provider until approval. Default empty sources. Changed config invalidates approval.";
proposal.requestBody.content["application/json"].schema.properties.scope =
  scope;
proposal.requestBody.content["application/json"].schema.properties.sources = {
  type: "array",
  maxItems: 20,
  items: object({
    kind: { type: "string", enum: ["NOTE", "SPACE", "DOCUMENT"] },
    id: str,
    version,
  }),
};
const input = object({
  scope,
  endpoint: {
    type: "string",
    format: "uri",
    description:
      "Public HTTPS port443 base URL; no userinfo/query/fragment, private DNS, redirects or proxy bypass.",
  },
  protocol: { type: "string", enum: ["chat", "responses"] },
  model: { type: "string", maxLength: 160 },
  key: {
    type: "string",
    maxLength: 4096,
    writeOnly: true,
    description:
      "Blank keeps existing key on update; required on create. Never returned.",
  },
  maxRunsPerDay: { type: "integer", minimum: 1, maximum: 100 },
});
s.PersonalModelInput = input;
const props = structuredClone(input.properties);
delete props.key;
s.PersonalModelSummary = object({
  ...props,
  version,
  route: ref("ModelRoute"),
});
const responses = (schema) => ({
  200: { description: "Success", content: { "application/json": { schema } } },
  default: structuredClone(proposal.responses.default),
});
const post = (operationId, summary, schema, result, description) => ({
  post: {
    operationId,
    summary,
    description,
    security: [{ ownerSession: [] }],
    parameters: structuredClone(proposal.parameters),
    requestBody: {
      required: true,
      content: { "application/json": { schema } },
    },
    responses: responses(result),
  },
});
p["/api/ai/providers"] = {
  get: {
    operationId: "personalProviders",
    summary: "List only current principal's provider summaries, never keys",
    security: [{ ownerSession: [] }],
    responses: responses({ type: "array", items: ref("PersonalModelSummary") }),
  },
};
p["/api/ai/providers/save"] = post(
  "savePersonalProvider",
  "Create or update own provider configuration",
  object({
    version: { type: "integer", minimum: 0 },
    input: ref("PersonalModelInput"),
  }),
  ref("PersonalModelSummary"),
  "Cookie + CSRF + request key required. version0 creates; current version updates. No secret-bearing receipt, no replay; CAS fails closed after an uncertain response. Re-list before retry. Encrypted filesystem vault is separate from business DB; audit and vault are not a distributed transaction. Bearer forbidden.",
);
p["/api/ai/providers/remove"] = post(
  "removePersonalProvider",
  "Remove own provider configuration",
  object({ scope, version }),
  object({ removed: { const: true } }),
  "Cookie only, version CAS. Request key required; no receipt replay. Does not remove past run records.",
);
p["/api/ai/apply"] = post(
  "applyAiSuggestions",
  "Atomically apply reviewed text suggestions",
  object({
    id: str,
    version,
    indices: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      uniqueItems: true,
      items: { type: "integer", minimum: 0, maximum: 19 },
    },
  }),
  { type: "array", items: { oneOf: [ref("Note"), ref("LibraryEntry")] } },
  "Cookie only; creator and succeeded run required. Only exact JSON edits targeting original approved NOTE/SPACE/DOCUMENT IDs and versions. User selects zero-based indices. Any stale or missing target rolls back all edits. Revisions, EXTERNAL_AI attribution, activity/outbox, applied marker and idempotency receipt are atomic. A run can apply once; partial selection discards remaining suggestions. No creation/deletion/task tools or shell.",
);
p["/api/backup"].post.description +=
  " Provider vault (providers.enc) and master.key are NOT in this SQLite download; back them up separately with restrictive permissions, keeping the key separately protected.";
// Rebuild identical aliases with unique operation IDs, avoiding hand-edited drift.
for (const key of Object.keys(p)) if (key.startsWith("/api/v1/")) delete p[key];
for (const [key, value] of Object.entries(p)) {
  const alias = structuredClone(value);
  for (const op of Object.values(alias))
    if (op.operationId) op.operationId += "V1";
  p[key.replace("/api/", "/api/v1/")] = alias;
}
writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
