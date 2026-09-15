import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentConnection,
  type AgentDefinition,
  combineGuardrailDecisions,
  type DelegationRequest,
  evaluateDelegation,
  evaluateModelProcessing,
  type GovernanceResult,
  governanceResult,
  guardrailDecisions,
  type ModelLocation,
  type ModelProcessingRequest,
  processingBoundaries,
} from "./index";

const metadata = {
  workspaceId: "workspace-a",
  version: 1,
  deletedAt: null,
} as const;

function modelRequest(): ModelProcessingRequest {
  return {
    workspaceId: "workspace-a",
    executionLocation: "LOCAL",
    route: {
      ...metadata,
      id: "route-a",
      providerId: "provider-a",
      modelId: "model-a",
      location: "LOCAL",
    },
    dataPolicy: {
      ...metadata,
      id: "data-policy-a",
      allowedDataIds: ["note-a", "note-b"],
      trustedCloudProviderIds: ["provider-a"],
      secretAiAllowedDataIds: [],
    },
    modelPolicy: {
      ...metadata,
      id: "model-policy-a",
      allowedModels: [{ providerId: "provider-a", modelId: "model-a" }],
    },
    data: [
      {
        ...metadata,
        id: "note-a",
        classification: "PRIVATE",
        processingBoundary: "LOCAL_ONLY",
        aiAccess: "ALLOW",
      },
    ],
  };
}

function definition(id: string): AgentDefinition {
  return {
    ...metadata,
    id,
    name: id,
    description: null,
    runtimeType: "test",
    capabilities: ["work:read"],
    policies: {
      ACCESS: null,
      DATA: null,
      RUNTIME: null,
      MODEL: null,
      BUDGET: null,
      APPROVAL: null,
    },
    createdByPrincipalId: "user-a",
    createdAt: "2026-09-13T00:00:00Z",
    updatedAt: "2026-09-13T00:00:00Z",
  };
}

function delegation(): DelegationRequest {
  return {
    workspaceId: "workspace-a",
    source: definition("planner"),
    target: definition("researcher"),
    scopes: ["work:read"],
    interactive: false,
    connection: connection(),
  };
}

function connection(): AgentConnection {
  return {
    ...metadata,
    id: "connection-a",
    sourceAgentDefinitionId: "planner",
    sourceAgentDefinitionVersion: 1,
    targetAgentDefinitionId: "researcher",
    targetAgentDefinitionVersion: 1,
    canDelegate: true,
    acceptsDelegation: true,
    interactive: false,
    enabled: true,
    scopes: ["work:read", "document:read"],
    createdByPrincipalId: "user-a",
  };
}

describe("Model processing data gate", () => {
  const locations: readonly ModelLocation[] = ["LOCAL", "SELF_HOSTED", "CLOUD"];
  const cases = processingBoundaries.flatMap((boundary) =>
    (["LOCAL", "SERVER"] as const).flatMap((executionLocation) =>
      locations.map((location) => ({ boundary, executionLocation, location })),
    ),
  );
  it.each(cases)(
    "$boundary on $executionLocation with $location model",
    ({ boundary, executionLocation, location }) => {
      const request = modelRequest();
      const result = evaluateModelProcessing({
        ...request,
        executionLocation,
        route: { ...request.route, location },
        data: request.data.map((item) => ({
          ...item,
          processingBoundary: boundary,
        })),
      });
      const allowed =
        boundary === "LOCAL_ONLY"
          ? executionLocation === "LOCAL" && location === "LOCAL"
          : boundary === "SELF_HOSTED_ONLY"
            ? location !== "CLOUD"
            : true;
      expect(result.decision).toBe(allowed ? "ALLOW" : "BLOCK");
    },
  );

  it("blocks unregistered external execution even with ANY data", () => {
    const request = modelRequest();
    expect(
      evaluateModelProcessing({
        ...request,
        executionLocation: "EXTERNAL",
        data: request.data.map((item) => ({
          ...item,
          processingBoundary: "ANY",
        })),
      }).reasons,
    ).toContain("EXTERNAL_RUNTIME_UNSUPPORTED");
  });

  it("requires the trusted-cloud allowlist in addition to model permission", () => {
    const request = modelRequest();
    expect(
      evaluateModelProcessing({
        ...request,
        route: { ...request.route, location: "CLOUD" },
        data: request.data.map((item) => ({
          ...item,
          processingBoundary: "TRUSTED_CLOUD",
        })),
        dataPolicy: { ...request.dataPolicy, trustedCloudProviderIds: [] },
      }),
    ).toEqual(governanceResult("BLOCK", "CLOUD_PROVIDER_NOT_TRUSTED"));
  });

  it("ANY never bypasses model permission", () => {
    const request = modelRequest();
    expect(
      evaluateModelProcessing({
        ...request,
        modelPolicy: { ...request.modelPolicy, allowedModels: [] },
        data: request.data.map((item) => ({
          ...item,
          processingBoundary: "ANY",
        })),
      }).reasons,
    ).toContain("MODEL_NOT_ALLOWED");
  });

  it("does not create provider/model cross-product grants", () => {
    const request = modelRequest();
    expect(
      evaluateModelProcessing({
        ...request,
        modelPolicy: {
          ...request.modelPolicy,
          allowedModels: [
            { providerId: "provider-a", modelId: "model-b" },
            { providerId: "provider-b", modelId: "model-a" },
          ],
        },
      }).decision,
    ).toBe("BLOCK");
  });

  it("checks input and retrieved context together and rechecks fallback", () => {
    const request = modelRequest();
    const mixed: ModelProcessingRequest = {
      ...request,
      data: [
        ...request.data.map((item) => ({
          ...item,
          processingBoundary: "ANY" as const,
        })),
        ...request.data.map((item) => ({ ...item, id: "note-b" })),
      ],
    };
    expect(evaluateModelProcessing(mixed).decision).toBe("ALLOW");
    expect(
      evaluateModelProcessing({
        ...mixed,
        route: { ...mixed.route, location: "CLOUD" },
      }).reasons,
    ).toContain("PROCESSING_BOUNDARY_VIOLATION");
  });

  it.each(["PUBLIC", "WORKSPACE", "PRIVATE", "SENSITIVE"] as const)(
    "%s is a classification, not an automatic data grant",
    (classification) => {
      const request = modelRequest();
      expect(
        evaluateModelProcessing({
          ...request,
          data: request.data.map((item) => ({ ...item, classification })),
          dataPolicy: { ...request.dataPolicy, allowedDataIds: [] },
        }).reasons,
      ).toContain("DATA_NOT_ALLOWED");
    },
  );

  it("SECRET is Never AI by default even locally", () => {
    const request = modelRequest();
    expect(
      evaluateModelProcessing({
        ...request,
        data: request.data.map((item) => ({
          ...item,
          classification: "SECRET",
        })),
      }),
    ).toEqual(governanceResult("BLOCK", "SECRET_AI_DENIED"));
  });

  it("a scoped policy exception allows SECRET only when all other checks allow", () => {
    const request = modelRequest();
    const secret: ModelProcessingRequest = {
      ...request,
      data: request.data.map((item) => ({ ...item, classification: "SECRET" })),
      dataPolicy: { ...request.dataPolicy, secretAiAllowedDataIds: ["note-a"] },
    };
    expect(evaluateModelProcessing(secret).decision).toBe("ALLOW");
    expect(
      evaluateModelProcessing({
        ...secret,
        dataPolicy: {
          ...secret.dataPolicy,
          secretAiAllowedDataIds: ["note-b"],
        },
      }).reasons,
    ).toContain("SECRET_AI_DENIED");
    expect(
      evaluateModelProcessing({
        ...secret,
        dataPolicy: { ...secret.dataPolicy, allowedDataIds: [] },
      }).reasons,
    ).toContain("DATA_NOT_ALLOWED");
    expect(
      evaluateModelProcessing({
        ...secret,
        data: secret.data.map((item) => ({ ...item, aiAccess: "DENY" })),
      }).reasons,
    ).toContain("AI_ACCESS_DENIED");
    expect(
      evaluateModelProcessing({
        ...secret,
        route: { ...secret.route, location: "CLOUD" },
      }).reasons,
    ).toContain("PROCESSING_BOUNDARY_VIOLATION");
    expect(
      evaluateModelProcessing({
        ...secret,
        modelPolicy: { ...secret.modelPolicy, allowedModels: [] },
      }).reasons,
    ).toContain("MODEL_NOT_ALLOWED");
  });

  it("requires approval for ASK but never downgrades a simultaneous hard block", () => {
    const request = modelRequest();
    const ask: ModelProcessingRequest = {
      ...request,
      data: request.data.map((item) => ({ ...item, aiAccess: "ASK" })),
    };
    expect(evaluateModelProcessing(ask).decision).toBe("REQUIRE_APPROVAL");
    const blocked = evaluateModelProcessing({
      ...ask,
      data: ask.data.map((item) => ({ ...item, classification: "SECRET" })),
    });
    expect(blocked.decision).toBe("BLOCK");
    expect(blocked.reasons).toEqual([
      "AI_ACCESS_APPROVAL_REQUIRED",
      "SECRET_AI_DENIED",
    ]);
  });

  it.each(["route", "dataPolicy", "modelPolicy", "data"] as const)(
    "blocks foreign workspace in %s",
    (field) => {
      const request = modelRequest();
      const result = evaluateModelProcessing(
        field === "data"
          ? {
              ...request,
              data: request.data.map((item) => ({
                ...item,
                workspaceId: "other",
              })),
            }
          : {
              ...request,
              [field]: { ...request[field], workspaceId: "other" },
            },
      );
      expect(result).toEqual(governanceResult("BLOCK", "WORKSPACE_MISMATCH"));
    },
  );

  it.each(["route", "dataPolicy", "modelPolicy", "data"] as const)(
    "blocks deleted %s",
    (field) => {
      const request = modelRequest();
      const result = evaluateModelProcessing(
        field === "data"
          ? {
              ...request,
              data: request.data.map((item) => ({
                ...item,
                deletedAt: "deleted",
              })),
            }
          : {
              ...request,
              [field]: { ...request[field], deletedAt: "deleted" },
            },
      );
      expect(result.reasons).toContain("DELETED_GOVERNANCE_ENTITY");
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    "blocks invalid pinned version %s",
    (version) => {
      const request = modelRequest();
      expect(
        evaluateModelProcessing({
          ...request,
          route: { ...request.route, version },
        }).decision,
      ).toBe("BLOCK");
    },
  );

  it.each([
    { classification: "UNKNOWN" },
    { processingBoundary: "UNKNOWN" },
    { aiAccess: "INHERIT" },
    { id: "" },
  ])("fails closed on invalid or unresolved data metadata %j", (patch) => {
    const request = modelRequest();
    expect(
      evaluateModelProcessing({
        ...request,
        data: request.data.map((item) => ({ ...item, ...patch })),
      } as ModelProcessingRequest).reasons,
    ).toContain("INVALID_POLICY_INPUT");
  });

  it("does not assume undefined deletion metadata means active", () => {
    const request = modelRequest();
    expect(
      evaluateModelProcessing({
        ...request,
        route: { ...request.route, deletedAt: undefined },
      } as unknown as ModelProcessingRequest).decision,
    ).toBe("BLOCK");
  });

  it("rejects unknown route and execution locations", () => {
    const request = modelRequest();
    expect(
      evaluateModelProcessing({
        ...request,
        executionLocation: "UNKNOWN",
      } as unknown as ModelProcessingRequest).decision,
    ).toBe("BLOCK");
    expect(
      evaluateModelProcessing({
        ...request,
        route: { ...request.route, location: "UNKNOWN" },
      } as unknown as ModelProcessingRequest).decision,
    ).toBe("BLOCK");
  });

  it("still checks model permission with no context", () => {
    const request = modelRequest();
    expect(evaluateModelProcessing({ ...request, data: [] }).decision).toBe(
      "ALLOW",
    );
    expect(
      evaluateModelProcessing({
        ...request,
        data: [],
        modelPolicy: { ...request.modelPolicy, allowedModels: [] },
      }).decision,
    ).toBe("BLOCK");
  });

  it("property: adding denied context can never make a request less restrictive", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...processingBoundaries),
        fc.constantFrom(...locations),
        (boundary, location) => {
          const request = modelRequest();
          const before = {
            ...request,
            route: { ...request.route, location },
            data: request.data.map((item) => ({
              ...item,
              processingBoundary: boundary,
            })),
          };
          const after = {
            ...before,
            data: [
              ...before.data,
              ...request.data.map((item) => ({
                ...item,
                id: "note-b",
                aiAccess: "DENY" as const,
              })),
            ],
          };
          expect(evaluateModelProcessing(after).decision).toBe("BLOCK");
          expect(
            guardrailDecisions.indexOf(evaluateModelProcessing(after).decision),
          ).toBeGreaterThanOrEqual(
            guardrailDecisions.indexOf(
              evaluateModelProcessing(before).decision,
            ),
          );
        },
      ),
      { numRuns: 100, seed: 20260913 },
    );
  });
});

describe("Explicit definition-to-definition delegation", () => {
  it("allows an exact directed topology grant without claiming run authorization", () => {
    expect(evaluateDelegation(delegation())).toEqual(governanceResult("ALLOW"));
    // Definitions deliberately have no policy bindings: this is ONLY the topology gate.
  });
  it("never infers a connection from capabilities", () => {
    expect(
      evaluateDelegation({ ...delegation(), connection: null }).reasons,
    ).toContain("CONNECTION_REQUIRED");
  });
  it("does not reverse or transitively extend a grant", () => {
    const request = delegation();
    expect(
      evaluateDelegation({
        ...request,
        source: request.target,
        target: request.source,
      }).reasons,
    ).toContain("CONNECTION_ENDPOINT_MISMATCH");
    expect(
      evaluateDelegation({ ...request, target: definition("third-agent") })
        .reasons,
    ).toContain("CONNECTION_ENDPOINT_MISMATCH");
  });
  it.each(["enabled", "canDelegate", "acceptsDelegation"] as const)(
    "requires %s explicitly true",
    (field) => {
      expect(
        evaluateDelegation({
          ...delegation(),
          connection: { ...connection(), [field]: false },
        }).reasons,
      ).toContain("DELEGATION_DISABLED");
      expect(
        evaluateDelegation({
          ...delegation(),
          connection: { ...connection(), [field]: "true" } as AgentConnection,
        }).decision,
      ).toBe("BLOCK");
    },
  );
  it("requires a separate interactive grant", () => {
    expect(
      evaluateDelegation({ ...delegation(), interactive: true }).reasons,
    ).toContain("INTERACTIVE_DELEGATION_DISABLED");
    expect(
      evaluateDelegation({
        ...delegation(),
        interactive: true,
        connection: { ...connection(), interactive: true },
      }).decision,
    ).toBe("ALLOW");
  });
  it.each([{ scopes: [] }, { scopes: [""] }, { scopes: ["   "] }])(
    "rejects empty scope requests $scopes",
    ({ scopes }) => {
      expect(evaluateDelegation({ ...delegation(), scopes }).reasons).toContain(
        "INVALID_POLICY_INPUT",
      );
    },
  );
  it("requires every scope and does not interpret wildcards", () => {
    expect(
      evaluateDelegation({
        ...delegation(),
        scopes: ["work:read", "work:write"],
      }).reasons,
    ).toContain("DELEGATION_SCOPE_DENIED");
    expect(
      evaluateDelegation({
        ...delegation(),
        connection: { ...connection(), scopes: ["*"] },
      }).decision,
    ).toBe("BLOCK");
    expect(
      evaluateDelegation({ ...delegation(), scopes: ["work:read "] }).decision,
    ).toBe("BLOCK");
  });
  it.each(["source", "target", "connection"] as const)(
    "rejects foreign %s",
    (field) => {
      const request = delegation();
      const entity = field === "connection" ? connection() : request[field];
      expect(
        evaluateDelegation({
          ...request,
          [field]: { ...entity, workspaceId: "other" },
        }).reasons,
      ).toContain("WORKSPACE_MISMATCH");
    },
  );
  it.each(["source", "target", "connection"] as const)(
    "rejects deleted %s",
    (field) => {
      const request = delegation();
      const entity = field === "connection" ? connection() : request[field];
      expect(
        evaluateDelegation({
          ...request,
          [field]: { ...entity, deletedAt: "deleted" },
        }).decision,
      ).toBe("BLOCK");
    },
  );
  it.each(["source", "target"] as const)(
    "requires reconfirmation when %s definition changes",
    (field) => {
      const request = delegation();
      expect(
        evaluateDelegation({
          ...request,
          [field]: { ...request[field], version: 2 },
        }).reasons,
      ).toContain("CONNECTION_VERSION_MISMATCH");
    },
  );
  it("rejects self delegation even with an explicit loop", () => {
    const request = delegation();
    expect(
      evaluateDelegation({
        ...request,
        target: request.source,
        connection: {
          ...connection(),
          targetAgentDefinitionId: request.source.id,
        },
      }).reasons,
    ).toContain("SELF_DELEGATION_DENIED");
  });
});

describe("Guardrail decision composition (not a runtime pipeline)", () => {
  it("fails closed without checks or with an unknown decision", () => {
    expect(combineGuardrailDecisions([])).toEqual(
      governanceResult("BLOCK", "NO_GUARDRAIL_CHECKS"),
    );
    expect(
      combineGuardrailDecisions([
        { decision: "UNKNOWN", reasons: [] } as unknown as GovernanceResult,
      ]).decision,
    ).toBe("BLOCK");
  });
  it("keeps warnings and approval requirements above ALLOW", () => {
    expect(
      combineGuardrailDecisions([
        governanceResult("ALLOW"),
        governanceResult("ALLOW_WITH_WARNING"),
      ]).decision,
    ).toBe("ALLOW_WITH_WARNING");
    expect(
      combineGuardrailDecisions([
        governanceResult("ALLOW_WITH_WARNING"),
        governanceResult("REQUIRE_APPROVAL"),
      ]).decision,
    ).toBe("REQUIRE_APPROVAL");
  });
  it("deduplicates reasons and never uses approval to waive a block", () => {
    expect(
      combineGuardrailDecisions([
        governanceResult("BLOCK", "AI_ACCESS_DENIED"),
        governanceResult("ALLOW"),
        governanceResult("REQUIRE_APPROVAL", "AI_ACCESS_APPROVAL_REQUIRED"),
        governanceResult("BLOCK", "AI_ACCESS_DENIED"),
      ]),
    ).toEqual(
      governanceResult(
        "BLOCK",
        "AI_ACCESS_DENIED",
        "AI_ACCESS_APPROVAL_REQUIRED",
      ),
    );
  });
  it("property: composition is monotonic and independent of check order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...guardrailDecisions), {
          minLength: 1,
          maxLength: 30,
        }),
        (decisions) => {
          const results = decisions.map((decision) =>
            governanceResult(decision),
          );
          const combined = combineGuardrailDecisions(results).decision;
          expect(combined).toBe(
            guardrailDecisions[
              Math.max(
                ...decisions.map((decision) =>
                  guardrailDecisions.indexOf(decision),
                ),
              )
            ],
          );
          expect(
            combineGuardrailDecisions([...results].reverse()).decision,
          ).toBe(combined);
        },
      ),
      { numRuns: 150, seed: 20260913 },
    );
  });
});
