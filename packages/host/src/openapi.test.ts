import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  apiScopes,
  capabilityRegistry,
  stableUuidPattern,
} from "@arclattice/application";
import { expect, it } from "vitest";

it("documents complete-effect human purge replay separately from narrow guards on both aliases", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const prefix of ["/api", "/api/v1"])
    for (const family of ["work", "note", "library"]) {
      const operation = spec.paths[prefix + "/" + family + "/purge"].post;
      expect(
        operation.requestBody.content["application/json"].schema.properties
          .syncCommand,
      ).toEqual({ $ref: "#/components/schemas/PurgeReplayCommand" });
      expect(
        operation.responses["200"].content["application/json"].schema.oneOf,
      ).toContainEqual({ $ref: "#/components/schemas/PurgeReplayReceipt" });
    }
  expect(
    spec.components.schemas.PurgeReplayCommand.properties.effects.items
      .properties.baseVersion.minimum,
  ).toBe(1);
});

it("declares explicit canonical relation replication on bootstrap and sync aliases", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const prefix of ["/api", "/api/v1"]) {
    for (const route of ["/bootstrap", "/sync"]) {
      expect(spec.paths[prefix + route].get.parameters).toContainEqual(
        expect.objectContaining({
          name: "relationMode",
          in: "query",
          schema: { type: "string", enum: ["canonical"] },
        }),
      );
    }
  }
});

it("declares the same strict explicit credential grants on both token aliases", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const prefix of ["/api", "/api/v1"]) {
    const schema =
      spec.paths[prefix + "/tokens/create"].post.requestBody.content[
        "application/json"
      ].schema;
    expect(schema.properties.grants).toMatchObject({
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: [...apiScopes] },
    });
    expect(schema.additionalProperties).toBe(false);
  }
});

it("private Memo contract never inherits public token access or caller ownership", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const prefix of ["/api", "/api/v1"]) {
    const read =
      spec.components.pathItems[
        spec.paths[prefix + "/memo"].$ref.split("/").at(-1)
      ].get;
    const save =
      spec.components.pathItems[
        spec.paths[prefix + "/memo/save"].$ref.split("/").at(-1)
      ].post;
    expect(read.security).toEqual([{ ownerSession: [] }]);
    expect(save.security).toEqual([{ ownerSession: [] }]);
    expect(
      save.parameters.find(
        (entry: { name: string }) => entry.name === "X-Workspace-Precondition",
      ),
    ).toMatchObject({
      in: "header",
      required: false,
      schema: { type: "string" },
    });
    expect(
      read.parameters.map((entry: { name: string }) => entry.name),
    ).toEqual(["targetKind", "targetId"]);
    const input = save.requestBody.content["application/json"].schema;
    expect(input.additionalProperties).toBe(false);
    expect(Object.keys(input.properties)).toEqual([
      "version",
      "input",
      "deleted",
      "syncCommand",
    ]);
    expect(input.properties.syncCommand).toEqual({
      $ref: "#/components/schemas/EntityMemoReplayCommand",
    });
    expect(
      save.responses["200"].content["application/json"].schema.oneOf,
    ).toContainEqual({ $ref: "#/components/schemas/EntityMemoReplayReceipt" });
    expect(
      read.responses["200"].content["application/json"].schema.oneOf,
    ).not.toContainEqual({
      $ref: "#/components/schemas/EntityMemoReplayReceipt",
    });
    expect(
      spec.paths[prefix + "/sync"].get.parameters.find(
        (entry: { name: string }) => entry.name === "privateMemos",
      ).schema.enum,
    ).toEqual(["include", "only"]);
    const effects =
      spec.components.schemas.EntityMemoReplayCommand.properties.effects;
    expect(effects.minItems).toBe(1);
    expect(effects.maxItems).toBe(1);
    expect(effects.items.properties.collection.const).toBe("entityMemos");
    expect(input.properties.version.maximum).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(spec.components.schemas.EntityMemoInput.additionalProperties).toBe(
      false,
    );
    expect(
      spec.components.schemas.EntityMemoInput.properties.bodyMd.maxLength,
    ).toBe(100000);
  }
});

it("private Memo Atlas sources remain separate from public entity references and require explicit target identity", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const prefix of ["/api", "/api/v1"]) {
    const schema =
      spec.paths[prefix + "/ai/propose"].post.requestBody.content[
        "application/json"
      ].schema;
    const source = schema.properties.sources.items;
    expect(source.properties.kind.enum).toContain("MEMO");
    expect(source.properties.target).toEqual({
      $ref: "#/components/schemas/EntityMemoTarget",
    });
    expect(source.allOf[0].then.required).toEqual(["target"]);
    expect(source.allOf[0].then.not.required).toEqual(["range"]);
    expect(source.allOf[0].else.not.required).toEqual(["target"]);
    expect(source.properties).not.toHaveProperty("bodyMd");
    expect(source.properties).not.toHaveProperty("ownerPrincipalId");
  }
  expect(spec.components.schemas.EntityMemoInput.properties.aiPolicy).toEqual({
    $ref: "#/components/schemas/ContentPolicy",
  });
  expect(spec.components.schemas.EntityMemoInput.required).not.toContain(
    "aiPolicy",
  );
});

it("document home moves expose a human-only versioned contract on both aliases", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const prefix of ["/api", "/api/v1"]) {
    const operation = spec.paths[prefix + "/library/move"].post;
    expect(operation.security).toEqual([{ ownerSession: [] }]);
    const schema = operation.requestBody.content["application/json"].schema;
    expect(schema.required).toEqual(["id", "version", "spaceId"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.syncCommand).toEqual({
      $ref: "#/components/schemas/KnowledgeReplayCommand",
    });
  }
});
it("reviewed Document links document stable human-only material identities on both REST aliases", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const path of ["/api/projects/link", "/api/v1/projects/link"]) {
    const operation = spec.paths[path].post;
    const schema = operation.requestBody.content["application/json"].schema;
    expect(schema.properties.stableMaterialId.pattern).toBe(stableUuidPattern);
    expect(schema.properties.deviceId.pattern).toBe(stableUuidPattern);
    expect(schema.dependentRequired.stableMaterialId).toEqual(["deviceId"]);
    expect(schema.properties.syncCommand).toEqual({
      $ref: "#/components/schemas/ProjectKnowledgeReplayCommand",
    });
    expect(operation.description).toContain("human-only");
  }
});

it("contextual requests document File citations and bounded Markdown selection separately", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const path of ["/api/ai/propose", "/api/v1/ai/propose"]) {
    const input =
      spec.paths[path].post.requestBody.content["application/json"].schema;
    expect(input.properties.responseFormat.enum).toEqual([
      "REPLACEMENT",
      "ANSWER",
    ]);
    const source = input.properties.sources.items;
    expect(source.additionalProperties).toBe(false);
    expect(source.properties.kind.enum).toContain("FILE");
    expect(source.properties.range).toMatchObject({
      additionalProperties: false,
      required: ["from", "to", "text"],
      properties: {
        from: { type: "integer", minimum: 0 },
        text: { maxLength: 12000 },
      },
    });
  }
});

it("contextual promotion accepts canonical references only and requires a human idempotent mutation", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const path of [
    "/api/ai/sessions/promote",
    "/api/v1/ai/sessions/promote",
  ]) {
    const operation = spec.paths[path].post;
    expect(operation.security).toEqual([{ ownerSession: [] }]);
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({ name: "Idempotency-Key", required: true }),
    );
    const input = operation.requestBody.content["application/json"].schema;
    expect(input.additionalProperties).toBe(false);
    expect(new Set(Object.keys(input.properties))).toEqual(
      new Set(["title", "runs"]),
    );
    expect(input.properties.runs).toMatchObject({
      minItems: 1,
      maxItems: 20,
      items: { additionalProperties: false, required: ["id", "version"] },
    });
    expect(operation.responses["409"]).toBeDefined();
  }
});

it("versioned human capability names and File input match the shared capability contract", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  const operation = spec.paths["/api/v1/ai/capability"].post;
  expect(
    new Set(
      operation.requestBody.content["application/json"].schema.properties.name
        .enum,
    ),
  ).toEqual(new Set(capabilityRegistry.map((entry) => entry.name)));
  expect(spec.components.schemas.FileChunkCapabilityInput).toEqual(
    capabilityRegistry.find((entry) => entry.name === "read_file_chunks")!
      .inputSchema,
  );
});

it("canonical File extraction separates granular content grants and retains bounded chunks", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  const operation = spec.paths["/api/v1/files/extraction"].get;
  expect(operation.security).toEqual([
    { ownerSession: [] },
    { integration: [] },
  ]);
  expect(operation["x-required-grants"]).toEqual([
    "files:read",
    "files:content",
  ]);
  expect(operation.parameters).toContainEqual(
    expect.objectContaining({
      name: "version",
      in: "query",
      required: true,
      schema: expect.objectContaining({ minimum: 1 }),
    }),
  );
  expect(operation.responses["200"].content["application/json"].schema).toEqual(
    { $ref: "#/components/schemas/FileExtractionDocument" },
  );
  expect(
    spec.components.schemas.FileExtractionDocument.properties.chunks.maxItems,
  ).toBe(2048);
  expect(
    spec.components.schemas.FileExtractionChunk.properties.text.maxLength,
  ).toBe(4000);
  expect(
    operation.responses["422"].content["application/json"].schema.properties
      .error.enum,
  ).toContain("FILE_EXTRACTION_UNSAFE_CONTENT");
});

it("File replay contracts retain original identities and bounded raw binary transport", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  const register = spec.paths["/api/v1/files/register"].post;
  const schema = register.requestBody.content["application/json"].schema;
  expect(register.security).toEqual([{ ownerSession: [] }]);
  expect(schema.additionalProperties).toBe(false);
  expect(schema.properties.stableId.pattern).toBe(stableUuidPattern);
  expect(schema.properties.deviceId.pattern).toBe(stableUuidPattern);
  expect(schema.properties.syncCommand).toEqual({
    $ref: "#/components/schemas/FileReplayCommand",
  });
  expect(schema.dependentRequired).toEqual({
    stableId: ["deviceId", "syncCommand"],
    deviceId: ["stableId", "syncCommand"],
  });
  for (const action of ["rename", "delete"]) {
    const operation = spec.paths[`/api/v1/files/${action}`].post;
    expect(operation.security).toEqual([{ ownerSession: [] }]);
    expect(
      operation.requestBody.content["application/json"].schema.properties
        .syncCommand,
    ).toEqual({ $ref: "#/components/schemas/FileReplayCommand" });
  }
  const chunk = spec.paths["/api/v1/files/binary/chunk"].post;
  expect(Object.keys(chunk.requestBody.content)).toEqual([
    "application/octet-stream",
  ]);
  expect(
    chunk.requestBody.content["application/octet-stream"].schema,
  ).toMatchObject({
    format: "binary",
    maxLength: 262144,
  });
  expect(chunk.parameters).toContainEqual(
    expect.objectContaining({
      name: "X-File-Chunk-Hash",
      in: "header",
      required: true,
    }),
  );
  expect(
    Object.keys(spec.paths["/api/v1/files/bytes"].get.responses["200"].content),
  ).toEqual(["application/octet-stream"]);
  expect(spec.components.schemas.LibraryFile.properties).not.toHaveProperty(
    "base64",
  );
  expect(spec.components.schemas.LibraryFile.properties).not.toHaveProperty(
    "bytes",
  );
});

it("OpenAPI references resolve and versioned aliases preserve unique operations", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  const operations = new Set<string>();
  for (const path of ["/api/v1/plans/preview", "/api/v1/plans/publish"]) {
    const schema =
      spec.paths[path].post.requestBody.content["application/json"].schema;
    expect(schema.properties.syncCommand).toEqual({
      $ref: "#/components/schemas/PlanReplayCommand",
    });
    expect(
      spec.paths[path].post.responses["200"].content["application/json"].schema
        .oneOf,
    ).toContainEqual({ $ref: "#/components/schemas/PlanReplayReceipt" });
  }
  const preview =
    spec.paths["/api/v1/plans/preview"].post.requestBody.content[
      "application/json"
    ].schema;
  expect(preview.properties.stableId.pattern).toBe(stableUuidPattern);
  expect(preview.dependentRequired.stableId).toEqual([
    "deviceId",
    "baseRevision",
    "documentRevision",
    "syncCommand",
  ]);
  expect(
    spec.components.schemas.PlanReplayCommand.properties.effects.items
      .properties.collection.enum,
  ).toEqual([
    "items",
    "edges",
    "categories",
    "workflows",
    "library",
    "projectMaterials",
  ]);
  for (const path of ["/api/link/create", "/api/v1/link/create"]) {
    const schema =
      spec.paths[path].post.requestBody.content["application/json"].schema;
    expect(schema.properties.stableId.pattern).toBe(stableUuidPattern);
    expect(schema.properties.deviceId.pattern).toBe(stableUuidPattern);
    expect(schema.properties.syncCommand).toEqual({
      $ref: "#/components/schemas/LinkedKnowledgeReplayCommand",
    });
    expect(schema.dependentRequired).toEqual({
      stableId: ["deviceId", "syncCommand"],
      deviceId: ["stableId", "syncCommand"],
    });
  }
  for (const path of ["/api/link/delete", "/api/v1/link/delete"])
    expect(
      spec.paths[path].post.requestBody.content["application/json"].schema
        .properties.syncCommand,
    ).toEqual({ $ref: "#/components/schemas/LinkedKnowledgeReplayCommand" });
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref") {
        expect(typeof child).toBe("string");
        expect((child as string).startsWith("#/")).toBe(true);
        const target = (child as string)
          .slice(2)
          .split("/")
          .reduce(
            (current, part) =>
              current?.[part.replace(/~1/g, "/").replace(/~0/g, "~")],
            spec,
          );
        expect(target, String(child)).toBeDefined();
      } else if (key === "operationId") {
        expect(operations.has(child as string), String(child)).toBe(false);
        operations.add(child as string);
      }
      walk(child);
    }
  };
  walk(spec);
  const release = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  expect(spec.info.version).toBe(release.version);
  expect(spec.components.schemas.CreateWork.properties.stableId.pattern).toBe(
    stableUuidPattern,
  );
  expect(spec.components.schemas.CreateWork.properties.deviceId.pattern).toBe(
    stableUuidPattern,
  );
  expect(spec.components.schemas.CreateWork.dependentRequired).toEqual({
    stableId: ["deviceId"],
    deviceId: ["stableId"],
  });
  for (const path of ["/api/edge/create", "/api/v1/edge/create"]) {
    const schema =
      spec.paths[path].post.requestBody.content["application/json"].schema;
    expect(schema.properties.stableId.pattern).toBe(stableUuidPattern);
    expect(schema.properties.deviceId.pattern).toBe(stableUuidPattern);
    expect(schema.dependentRequired).toEqual({
      stableId: ["deviceId"],
      deviceId: ["stableId"],
    });
  }
  expect(
    spec.components.schemas.WorkReplayCommand.properties.commandId.pattern,
  ).toBe(stableUuidPattern);
  expect(
    spec.components.schemas.WorkReplayCommand.properties.deviceId.pattern,
  ).toBe(stableUuidPattern);
  expect(spec.components.schemas.WorkReplayCommand.additionalProperties).toBe(
    false,
  );
  for (const path of [
    "/api/work/create",
    "/api/work/update",
    "/api/work/delete",
    "/api/edge/create",
    "/api/edge/delete",
  ]) {
    const request =
      spec.paths[path].post.requestBody.content["application/json"].schema;
    const schema = request.$ref
      ? spec.components.schemas[request.$ref.split("/").at(-1)]
      : request;
    expect(schema.properties.syncCommand).toEqual({
      $ref: "#/components/schemas/WorkReplayCommand",
    });
    expect(
      spec.paths[path].post.responses["200"].content["application/json"].schema
        .oneOf,
    ).toContainEqual({ $ref: "#/components/schemas/WorkReplayReceipt" });
  }
  expect(spec.components.schemas.WorkReplayReceipt.required).toEqual([
    "commandId",
    "deviceId",
    "result",
    "effects",
  ]);
  for (const name of ["note", "library"])
    for (const action of ["save", "delete"]) {
      const request =
        spec.paths[`/api/${name}/${action}`].post.requestBody.content[
          "application/json"
        ].schema;
      const schema = request.$ref
        ? spec.components.schemas[request.$ref.split("/").at(-1)]
        : request;
      expect(schema.properties.syncCommand).toEqual({
        $ref: "#/components/schemas/KnowledgeReplayCommand",
      });
      if (action === "save")
        expect(schema.dependentRequired).toEqual({
          stableId: ["deviceId"],
          deviceId: ["stableId"],
        });
      expect(
        spec.paths[`/api/${name}/${action}`].post.responses["200"].content[
          "application/json"
        ].schema.oneOf,
      ).toContainEqual({ $ref: "#/components/schemas/KnowledgeReplayReceipt" });
    }
  expect(
    spec.components.schemas.WorkReplayReceipt.properties.effects.items.required,
  ).toEqual(["collection", "id", "op", "version", "value"]);
  const reminder = spec.paths["/api/reminders/save"].post;
  expect(
    spec.paths["/api/manual-orders/move"].post.requestBody.content[
      "application/json"
    ].schema.properties.syncCommand,
  ).toEqual({ $ref: "#/components/schemas/ManualOrderReplayCommand" });
  expect(
    spec.components.schemas.ManualOrderReplayCommand.properties.effects.items
      .properties.collection.enum,
  ).toEqual(["manualOrders"]);
  expect(
    spec.paths["/api/manual-orders/move"].post.responses["200"].content[
      "application/json"
    ].schema.oneOf,
  ).toContainEqual({ $ref: "#/components/schemas/ManualOrderReplayReceipt" });
  const calendar = spec.components.pathItems.CalendarSettings.post;
  expect(
    spec.components.schemas.NavigationReplayCommand.properties.effects.items
      .properties.collection.enum,
  ).toEqual(["navigationPreference"]);
  expect(
    spec.components.pathItems.NavigationPreference.post.responses["200"]
      .content["application/json"].schema.oneOf,
  ).toContainEqual({ $ref: "#/components/schemas/NavigationReplayReceipt" });
  const calendarRequest =
    calendar.requestBody.content["application/json"].schema;
  const calendarSchema = calendarRequest.$ref
    ? spec.components.schemas[calendarRequest.$ref.split("/").at(-1)]
    : calendarRequest;
  expect(calendarSchema.properties.syncCommand).toEqual({
    $ref: "#/components/schemas/CalendarReplayCommand",
  });
  expect(
    spec.components.schemas.CalendarReplayCommand.properties.effects.items
      .properties.id,
  ).toEqual({ const: "workspace" });
  expect(
    calendar.responses["200"].content["application/json"].schema.oneOf,
  ).toContainEqual({ $ref: "#/components/schemas/CalendarReplayReceipt" });
  expect(
    reminder.requestBody.content["application/json"].schema.properties
      .syncCommand,
  ).toEqual({ $ref: "#/components/schemas/ReminderReplayCommand" });
  expect(
    spec.components.schemas.ReminderReplayCommand.properties.effects.maxItems,
  ).toBe(1);
  expect(
    spec.components.schemas.ReminderReplayCommand.properties.effects.items
      .properties.collection.enum,
  ).toEqual(["reminders"]);
  expect(
    reminder.responses["200"].content["application/json"].schema.oneOf,
  ).toContainEqual({ $ref: "#/components/schemas/ReminderReplayReceipt" });
  for (const [path, item] of Object.entries(spec.paths)) {
    if (path.startsWith("/api/v1/")) continue;
    const alias = spec.paths[path.replace("/api/", "/api/v1/")];
    expect(alias, path).toBeDefined();
    const withoutId = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, field) =>
          key === "operationId" ? undefined : field,
        ),
      );
    expect(withoutId(alias), path).toEqual(withoutId(item));
  }
});
it("owned workspace create contract is shared by versioned and legacy APIs without implicit activation", async () => {
  const { ownedWorkspaceCreateSchema } = await import(
    "@arclattice/application"
  );
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const prefix of ["/api", "/api/v1"]) {
    expect(spec.paths[prefix + "/workspaces/create"]).toEqual({
      $ref: "#/components/pathItems/CreateOwnedWorkspace",
    });
    const operation = spec.components.pathItems.CreateOwnedWorkspace.post;
    expect(operation.security).toEqual([{ ownerSession: [] }]);
    expect(operation.requestBody.content["application/json"].schema).toEqual(
      ownedWorkspaceCreateSchema,
    );
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({ name: "Idempotency-Key", required: true }),
    );
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({ name: "X-Workspace-Id", required: false }),
    );
  }
});

it("explicit deleted knowledge recovery is documented as human-only and transactional on both API aliases", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  for (const prefix of ["/api", "/api/v1"])
    for (const collection of ["note", "library"]) {
      const operation = spec.paths[`${prefix}/${collection}/save`].post;
      const declared = operation.requestBody.content["application/json"].schema;
      const schema = declared.$ref
        ? spec.components.schemas[declared.$ref.split("/").at(-1)]
        : declared;
      expect(schema.properties.restoreDeleted).toMatchObject({
        type: "boolean",
        enum: [true],
      });
      expect(schema.properties.restoreDeleted.description).toContain(
        "human-only",
      );
      expect(schema.properties.restoreDeleted.description).toContain(
        "rolls back",
      );
    }
});
