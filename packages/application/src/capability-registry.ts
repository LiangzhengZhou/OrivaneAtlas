import { DomainError } from "@arclattice/domain";
import type { AiCapabilityRisk } from "./ai-context";

export interface CapabilitySchema {
  type: "object" | "string" | "integer" | "array";
  properties?: Record<string, CapabilitySchema>;
  required?: readonly string[];
  additionalProperties?: false;
  items?: CapabilitySchema;
  maxLength?: number;
  minLength?: number;
  maxItems?: number;
  minimum?: number;
  enum?: readonly string[];
}
export interface CapabilityDefinition {
  previewOnly?: boolean;
  name: string;
  description: string;
  risk: AiCapabilityRisk;
  inputSchema: CapabilitySchema;
  execute<T>(
    input: unknown,
    invoke: (name: string, input: Record<string, unknown>) => Promise<T>,
  ): Promise<T>;
}
const text: CapabilitySchema = { type: "string", minLength: 1, maxLength: 240 };
const version: CapabilitySchema = { type: "integer", minimum: 1 };
const ids: CapabilitySchema = { type: "array", items: text, maxItems: 100 };
const define = (
  name: string,
  description: string,
  risk: AiCapabilityRisk,
  properties: Record<string, CapabilitySchema>,
  required: string[],
): CapabilityDefinition => ({
  name,
  description,
  risk,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
  execute: async (input, invoke) => {
    validateCapabilityInput(
      { type: "object", properties, required, additionalProperties: false },
      input,
    );
    return invoke(name, input as Record<string, unknown>);
  },
});

/** Shared contract for internal agents and external MCP. Execution remains in AiCapabilityService. */
export const capabilityRegistry: readonly CapabilityDefinition[] = [
  define(
    "search_documents",
    "Search permitted documents in the current retrieval scope.",
    "READ",
    {
      query: { ...text, maxLength: 10000 },
      projectId: text,
      currentSpaceId: text,
    },
    ["query"],
  ),
  define(
    "read_document",
    "Read a permitted document and its current version.",
    "READ",
    { id: text },
    ["id"],
  ),
  define(
    "get_project",
    "Read a project in the authenticated workspace.",
    "READ",
    { id: text },
    ["id"],
  ),
  define(
    "list_project_tasks",
    "Read tasks belonging to a project.",
    "READ",
    { projectId: text },
    ["projectId"],
  ),
  define(
    "create_task",
    "Create one task. Prefer a reviewed plan for batch imports.",
    "WRITE",
    { title: text, projectIds: ids },
    ["title"],
  ),
  define(
    "propose_document_edit",
    "Prepare a version-bound before/after document proposal; does not apply it.",
    "PROPOSE",
    { id: text, markdown: { type: "string", maxLength: 200000 } },
    ["id", "markdown"],
  ),
  define(
    "link_documents",
    "Link two permitted documents.",
    "WRITE",
    { fromId: text, toId: text },
    ["fromId", "toId"],
  ),
  define(
    "update_task",
    "Update a task title or description at an expected version.",
    "WRITE",
    {
      id: text,
      version,
      title: text,
      descriptionMd: { type: "string", maxLength: 200000 },
    },
    ["id", "version"],
  ),
  define(
    "complete_task",
    "Complete one task at an expected version, respecting dependency rules.",
    "WRITE",
    { id: text, version },
    ["id", "version"],
  ),
  define(
    "reschedule_task",
    "Change task dates at an expected version. Omit a date to keep it unchanged.",
    "WRITE",
    { id: text, version, startDate: text, dueDate: text },
    ["id", "version"],
  ),
  define(
    "set_task_priority",
    "Change task priority at an expected version.",
    "WRITE",
    {
      id: text,
      version,
      priority: { ...text, enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
    },
    ["id", "version", "priority"],
  ),
  define(
    "move_task_to_project",
    "Replace task project memberships at an expected version.",
    "WRITE",
    { id: text, version, projectIds: ids },
    ["id", "version", "projectIds"],
  ),
  {
    ...define(
      "preview_plan",
      "Validate an additive plan for human review without creating tasks. Publication always requires a separate human approval.",
      "PROPOSE",
      { projectId: text, manifest: { type: "object" } },
      ["manifest"],
    ),
    previewOnly: true,
  },
  define(
    "publish_plan",
    "Publish a reviewed plan at its expected version. Requires explicit human approval even under AUTO_SAFE.",
    "WRITE",
    { id: text, version, manifest: { type: "object" } },
    ["id", "version"],
  ),
  define(
    "create_document",
    "Create a Markdown document in an existing space with conservative AI access policy.",
    "WRITE",
    {
      spaceId: text,
      title: text,
      bodyMd: { type: "string", maxLength: 200000 },
    },
    ["spaceId", "title", "bodyMd"],
  ),
  define(
    "move_document",
    "Move a leaf document to another space, preserving its content, identity, revisions and links.",
    "WRITE",
    { id: text, version, spaceId: text },
    ["id", "version", "spaceId"],
  ),
];

export function validateCapabilityInput(
  schema: CapabilitySchema,
  value: unknown,
): void {
  const fail = () => {
    throw new DomainError("VALIDATION_ERROR");
  };
  switch (schema.type) {
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return fail();
      const input = value as Record<string, unknown>;
      // Plan manifests are parsed by the existing canonical WorkflowService validator.
      if (!schema.properties) {
        if (JSON.stringify(value).length > 200000) fail();
        return;
      }
      if (
        Object.keys(input).some(
          (key) => !Object.hasOwn(schema.properties ?? {}, key),
        ) ||
        schema.required?.some((key) => !Object.hasOwn(input, key))
      )
        return fail();
      for (const [key, field] of Object.entries(input))
        validateCapabilityInput(schema.properties![key]!, field);
      return;
    }
    case "string":
      if (
        typeof value !== "string" ||
        value.length > (schema.maxLength ?? 200000) ||
        value.trim().length < (schema.minLength ?? 0) ||
        (schema.enum && !schema.enum.includes(value))
      )
        fail();
      return;
    case "integer":
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < (schema.minimum ?? 0)
      )
        fail();
      return;
    case "array":
      if (!Array.isArray(value) || value.length > (schema.maxItems ?? 100))
        return fail();
      for (const item of value) validateCapabilityInput(schema.items!, item);
  }
}
export function capabilityDefinition(name: string): CapabilityDefinition {
  const definition = capabilityRegistry.find((entry) => entry.name === name);
  if (!definition) throw new DomainError("VALIDATION_ERROR");
  return definition;
}
