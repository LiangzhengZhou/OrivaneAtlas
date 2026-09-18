import { DomainError } from "@arclattice/domain";

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[],
) => ({ type: "object", properties, required, additionalProperties: false });
const text = { type: "string" };
export const mcpTools = [
  {
    name: "workspace_snapshot",
    description:
      "Read this authenticated workspace's tasks, documents and project materials. Requires read-write credential scope.",
    inputSchema: objectSchema({}, []),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "plan_preview",
    description:
      "Validate and store an additive plan for human review. Does not publish or activate tasks. Human must approve publication in the application.",
    inputSchema: objectSchema(
      { projectId: { type: ["string", "null"] }, manifest: { type: "object" } },
      ["projectId", "manifest"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "project_document_create",
    description:
      "Create a project-owned Markdown document with EXTERNAL_AI provenance and deny-by-default AI policy. Never creates tasks.",
    inputSchema: objectSchema({ projectId: text, title: text, bodyMd: text }, [
      "projectId",
      "title",
      "bodyMd",
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const;

export interface McpRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}
export function parseMcp(value: Record<string, unknown>): McpRequest {
  if (
    value.jsonrpc !== "2.0" ||
    typeof value.method !== "string" ||
    (value.id !== undefined &&
      value.id !== null &&
      typeof value.id !== "string" &&
      typeof value.id !== "number") ||
    (value.params !== undefined &&
      (!value.params ||
        typeof value.params !== "object" ||
        Array.isArray(value.params)))
  )
    throw new DomainError("VALIDATION_ERROR");
  return value as unknown as McpRequest;
}
export async function mcpDispatch(
  request: McpRequest,
  invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const respond = (result: unknown) => ({
    jsonrpc: "2.0",
    id: request.id ?? null,
    result,
  });
  if (request.method === "initialize")
    return respond({
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "orivane-atlas", version: "0.1.0" },
    });
  if (request.method === "notifications/initialized") return null;
  if (request.method === "ping") return respond({});
  if (request.method === "tools/list") return respond({ tools: mcpTools });
  if (request.method !== "tools/call")
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32601, message: "Method not found" },
    };
  const name = request.params?.name;
  const args = request.params?.arguments ?? {};
  if (
    typeof name !== "string" ||
    !args ||
    typeof args !== "object" ||
    Array.isArray(args)
  )
    throw new DomainError("VALIDATION_ERROR");
  const tool = mcpTools.find((entry) => entry.name === name);
  if (!tool)
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32602, message: "Unknown tool" },
    };
  const input = args as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !(key in tool.inputSchema.properties)) ||
    tool.inputSchema.required.some((key) => !(key in input))
  )
    throw new DomainError("VALIDATION_ERROR");
  const result = await invoke(name, input);
  return respond({
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: false,
  });
}
