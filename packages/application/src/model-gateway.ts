import {
  type ActorContext,
  DomainError,
  evaluateModelProcessing,
} from "@arclattice/domain";
import type { AgentRun, ModelPort, ModelRoute, ModelUsage } from "./connected";
import { type ContentPolicy, contentPolicy } from "./content-policy";
import {
  type GatewaySettlement,
  ModelNotSentError,
  validateGatewayPolicy,
} from "./gateway-policy";
import type { LibraryStore } from "./library";
import type { NotebookStore } from "./notebook";

/** All currently supported remote adapters are conservatively cloud routes. */
export function validateContextPolicy(
  actor: ActorContext,
  route: AgentRun["route"],
  entity: {
    id: string;
    workspaceId: string;
    version: number;
    deletedAt: string | null;
    aiPolicy?: ContentPolicy;
  },
) {
  const base = {
    id: "approved-policy",
    workspaceId: actor.workspaceId,
    version: 1,
    deletedAt: null,
  };
  const identity = { providerId: route.provider, modelId: route.model };
  const result = evaluateModelProcessing({
    workspaceId: actor.workspaceId,
    executionLocation: "SERVER",
    dataPolicy: {
      ...base,
      allowedDataIds: [entity.id],
      trustedCloudProviderIds: [],
      secretAiAllowedDataIds: [],
    },
    modelPolicy: { ...base, allowedModels: [identity] },
    route: { ...base, ...identity, location: "CLOUD" },
    data: [
      {
        id: entity.id,
        workspaceId: entity.workspaceId,
        version: entity.version,
        deletedAt: entity.deletedAt,
        ...contentPolicy(entity.aiPolicy),
      },
    ],
  });
  if (result.decision === "BLOCK") throw new DomainError("FORBIDDEN");
}

/** Re-read approved context inside the host's authorized storage transaction. */
export async function validateApprovedContext(
  actor: ActorContext,
  run: AgentRun,
  notes: Pick<NotebookStore, "get">,
  library: Pick<LibraryStore, "get">,
): Promise<void> {
  for (const source of run.context ?? []) {
    const kind = source.ref.kind;
    if (!["NOTE", "SPACE", "DOCUMENT"].includes(kind))
      throw new Error("CONTEXT_CHANGED");
    const entity =
      kind === "NOTE"
        ? await notes.get(source.ref.id)
        : await library.get(source.ref.id);
    if (
      entity.workspaceId !== actor.workspaceId ||
      entity.deletedAt ||
      entity.version !== source.version ||
      entity.title !== source.title ||
      entity.bodyMd !== source.bodyMd ||
      (kind !== "NOTE" && entity.kind !== kind)
    )
      throw new Error("CONTEXT_CHANGED");
    validateContextPolicy(actor, run.route, entity);
    if (kind === "DOCUMENT") {
      if (!("spaceId" in entity) || !entity.spaceId)
        throw new Error("CONTEXT_CHANGED");
      const parent = await library.get(entity.spaceId);
      if (
        parent.workspaceId !== actor.workspaceId ||
        parent.deletedAt ||
        parent.kind !== "SPACE"
      )
        throw new Error("CONTEXT_CHANGED");
      validateContextPolicy(actor, run.route, parent);
    }
    const scope = run.route.scope ?? "personal";
    if (
      scope.startsWith("SPACE:") &&
      entity.id !== scope.slice(6) &&
      (!("spaceId" in entity) || entity.spaceId !== scope.slice(6))
    )
      throw new Error("CONTEXT_CHANGED");
  }
}

export interface ModelExecutionResult {
  settlement?: GatewaySettlement;
  usage?: ModelUsage;
  output: string | null;
  error: "MODEL_INTERRUPTED" | "MODEL_REQUEST_FAILED" | null;
  interrupted: boolean;
}

/** Internal application boundary. Callers supply trusted persisted runs, not request JSON. */
export async function executeApprovedModel(
  actor: ActorContext,
  run: AgentRun,
  authorize: (route: ModelRoute) => Promise<void>,
  resolve: () => ModelPort | null,
  signal: AbortSignal,
): Promise<ModelExecutionResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (() => void) | undefined;
  let usage: ModelUsage | undefined;
  let notSent = true;
  let routeFingerprint: string | undefined;
  try {
    if (
      run.workspaceId !== actor.workspaceId ||
      run.createdBy !== actor.principalId ||
      run.status !== "RUNNING" ||
      run.deletedAt ||
      run.approvedBy !== actor.principalId ||
      !run.approvedAt ||
      !Number.isSafeInteger(run.route.timeoutMs) ||
      run.route.timeoutMs < 1 ||
      run.route.timeoutMs > 120_000
    )
      throw new Error("INVALID_APPROVAL");
    timer = setTimeout(abort, run.route.timeoutMs);
    const aborted = new Promise<never>((_accept, reject) => {
      rejectAbort = () => reject(new Error("ABORTED"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    const operation = async () => {
      const candidates = [run.route, ...(run.route.fallbackRoutes ?? [])];
      if (
        candidates.length > 3 ||
        new Set(candidates.map((candidate) => candidate.fingerprint)).size !==
          candidates.length
      )
        throw new Error("INVALID_APPROVAL");
      for (const [index, candidate] of candidates.entries()) {
        await authorize(candidate);
        if (controller.signal.aborted) throw new Error("ABORTED");
        const primary = resolve();
        const model = index === 0 ? primary : primary?.fallbacks?.[index - 1];
        if (
          !model ||
          primary?.route.fingerprint !== run.route.fingerprint ||
          model.route.fingerprint !== candidate.fingerprint ||
          typeof run.prompt !== "string" ||
          !run.prompt.trim() ||
          run.prompt.length > model.route.maxInputChars
        )
          throw new Error("MODEL_ROUTE_CHANGED");
        if (candidate.gateway) {
          validateGatewayPolicy(candidate.gateway);
          if (
            !candidate.gateway.enabled ||
            candidate.gateway.capability !== run.route.gateway?.capability
          )
            throw new Error("MODEL_ROUTE_CHANGED");
        }
        routeFingerprint = candidate.fingerprint;
        notSent = false;
        let output: string;
        try {
          output = await model.complete(
            run.prompt,
            controller.signal,
            (reported) => {
              if (
                reported.source === "PROVIDER_REPORTED" &&
                Number.isSafeInteger(reported.inputTokens) &&
                reported.inputTokens >= 0 &&
                Number.isSafeInteger(reported.outputTokens) &&
                reported.outputTokens >= 0
              ) {
                usage = {
                  inputTokens: reported.inputTokens,
                  outputTokens: reported.outputTokens,
                  source: "PROVIDER_REPORTED",
                };
              }
            },
          );
        } catch (error) {
          if (error instanceof ModelNotSentError && !usage) {
            notSent = true;
            if (!controller.signal.aborted && index + 1 < candidates.length)
              continue;
          }
          throw error;
        }
        if (
          controller.signal.aborted ||
          typeof output !== "string" ||
          !output ||
          output.length > 100_000
        )
          throw new Error("INVALID_OUTPUT");
        return output;
      }
      throw new Error("MODEL_NOT_CONFIGURED");
    };
    return {
      output: await Promise.race([operation(), aborted]),
      ...(usage ? { usage } : {}),
      error: null,
      interrupted: false,
      ...(run.route.gateway
        ? {
            settlement: {
              notSent,
              ...(routeFingerprint ? { routeFingerprint } : {}),
            },
          }
        : {}),
    };
  } catch {
    return {
      output: null,
      ...(usage ? { usage } : {}),
      error: controller.signal.aborted
        ? "MODEL_INTERRUPTED"
        : "MODEL_REQUEST_FAILED",
      interrupted: controller.signal.aborted,
      ...(run.route.gateway
        ? {
            settlement: {
              notSent,
              ...(routeFingerprint ? { routeFingerprint } : {}),
            },
          }
        : {}),
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    if (rejectAbort)
      controller.signal.removeEventListener("abort", rejectAbort);
  }
}
