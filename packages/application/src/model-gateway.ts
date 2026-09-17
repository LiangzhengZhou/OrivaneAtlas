import {
  type ActorContext,
  DomainError,
  evaluateModelProcessing,
} from "@arclattice/domain";
import type { AgentRun, ModelPort, ModelUsage } from "./connected";
import { type ContentPolicy, contentPolicy } from "./content-policy";
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
  usage?: ModelUsage;
  output: string | null;
  error: "MODEL_INTERRUPTED" | "MODEL_REQUEST_FAILED" | null;
  interrupted: boolean;
}

/** Internal application boundary. Callers supply trusted persisted runs, not request JSON. */
export async function executeApprovedModel(
  actor: ActorContext,
  run: AgentRun,
  authorize: () => Promise<void>,
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
      await authorize();
      if (controller.signal.aborted) throw new Error("ABORTED");
      const model = resolve();
      if (
        !model ||
        model.route.fingerprint !== run.route.fingerprint ||
        typeof run.prompt !== "string" ||
        !run.prompt.trim() ||
        run.prompt.length > model.route.maxInputChars
      )
        throw new Error("MODEL_ROUTE_CHANGED");
      const output = await model.complete(
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
      if (
        controller.signal.aborted ||
        typeof output !== "string" ||
        !output ||
        output.length > 100_000
      )
        throw new Error("INVALID_OUTPUT");
      return output;
    };
    return {
      output: await Promise.race([operation(), aborted]),
      ...(usage ? { usage } : {}),
      error: null,
      interrupted: false,
    };
  } catch {
    return {
      output: null,
      ...(usage ? { usage } : {}),
      error: controller.signal.aborted
        ? "MODEL_INTERRUPTED"
        : "MODEL_REQUEST_FAILED",
      interrupted: controller.signal.aborted,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    if (rejectAbort)
      controller.signal.removeEventListener("abort", rejectAbort);
  }
}
