import {
  type AccountStore,
  AgentHarness,
  type AgentRun,
  AgentSessionService,
  AiCapabilityService,
  type AuthorizationService,
  type Clock,
  ConnectedService,
  type HarnessState,
  type IdGenerator,
  LibraryService,
  type ModelEvent,
  ModelNotSentError,
  type ModelPort,
  type ModelProviderAdapter,
  parseAiCapabilityCall,
  RetrievalContextResolver,
  RetrievalService,
  settleGatewayMoney,
  validateApprovedContext,
  validateContextPolicy,
  WorkflowService,
  WorkService,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";
import type { SqliteUnitOfWork } from "@arclattice/storage-sqlite";
import { adaptModelProvider } from "../../application/src/provider-adapter";
import { planDocumentPublisher } from "./plan-documents";

export interface AtlasRuntimeInput {
  db: SqliteUnitOfWork;
  actor: ActorContext;
  run: AgentRun;
  model: ModelPort;
  authorization: AuthorizationService;
  clock: Clock;
  ids: IdGenerator;
  checkAccess: (store: AccountStore) => void;
  signal: AbortSignal;
  notify(): void;
  onEvent(event: ModelEvent): void;
}
/** Every loop boundary re-reads persisted approval, context and conversation versions. */
export async function runAtlasHarness(
  input: AtlasRuntimeInput,
): Promise<HarnessState> {
  const { db, actor, model, authorization, clock, ids, checkAccess } = input;
  let current = input.run;
  let stepRun = current;
  const state: HarnessState = current.harness ?? {
    status: "RUNNING",
    steps: 0,
    toolCalls: 0,
    writes: 0,
    startedAt: Date.now(),
    messages: [{ role: "user", text: current.prompt }],
    pending: [],
  };
  type Transaction = Parameters<SqliteUnitOfWork["request"]>[2];
  const transaction = async <T>(
    operation: (...args: Parameters<Transaction>) => Promise<T>,
    contextCheck = true,
  ): Promise<T> =>
    db.request(
      actor,
      null,
      async (...args) => {
        const [, notes, connected, library, , , sessions] = args;
        const persisted = await connected.getRun(current.id);
        if (
          persisted.version !== current.version ||
          persisted.status !== "RUNNING" ||
          persisted.createdBy !== actor.principalId ||
          persisted.approvedBy !== actor.principalId ||
          !persisted.approvedAt
        )
          throw new DomainError("VERSION_CONFLICT");
        const session = await new AgentSessionService(
          sessions,
          authorization,
          clock,
          ids,
        ).get(actor, persisted.sessionId!);
        if (session.version !== persisted.sessionVersion)
          throw new DomainError("VERSION_CONFLICT");
        if (model.route.fingerprint !== persisted.route.fingerprint)
          throw new DomainError("VERSION_CONFLICT");
        if (contextCheck)
          await validateApprovedContext(actor, persisted, notes, library);
        return operation(...args);
      },
      checkAccess,
    );
  const save = async (next: HarnessState) => {
    current = await transaction(
      async (
        _uow,
        _notes,
        connected,
        _library,
        _organization,
        _projects,
        sessions,
      ) => {
        const sessionService = new AgentSessionService(
          sessions,
          authorization,
          clock,
          ids,
        );
        let session = await sessionService.get(actor, current.sessionId!);
        const newResults = next.messages.filter(
          (message) =>
            message.role === "tool" &&
            !current.harness?.messages.some(
              (previous) =>
                previous.role === "tool" &&
                previous.toolCallId === message.toolCallId,
            ),
        );
        for (const result of newResults) {
          const call = next.messages
            .flatMap((message) => message.toolCalls ?? [])
            .find((call) => call.id === result.toolCallId);
          if (!call) throw new DomainError("VALIDATION_ERROR");
          session = await sessionService.append(
            actor,
            session.id,
            session.version,
            {
              kind: "TOOL_CALL",
              text: JSON.stringify(call),
              runId: current.id,
            },
          );
          session = await sessionService.append(
            actor,
            session.id,
            session.version,
            {
              kind: "TOOL_RESULT",
              text: JSON.stringify({
                id: call.id,
                name: call.name,
                output: JSON.parse(result.text),
              }),
              runId: current.id,
            },
          );
        }
        const saved: AgentRun = {
          ...current,
          sessionVersion: session.version,
          harness: structuredClone(next),
          version: current.version + 1,
          updatedAt: clock.now(),
          updatedBy: actor.principalId,
        };
        await connected.saveRun(saved, current.version);
        return saved;
      },
      !["ERROR", "INTERRUPTED", "LIMIT_REACHED"].includes(next.status),
    );
    input.notify();
  };
  const adapter = adaptModelProvider(model);
  const providerCall = async <T>(
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(abort, model.route.timeoutMs);
    let rejectAbort: () => void = () => {};
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectAbort = () =>
        reject(new Error(signal.aborted ? "INTERRUPTED" : "MODEL_TIMEOUT"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    try {
      return await Promise.race([operation(controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", rejectAbort);
    }
  };
  let selectedRoute = model.route;
  const routed: ModelProviderAdapter = {
    ...adapter,
    complete: (prompt, signal, usage) =>
      providerCall(signal, async (timedSignal) => {
        if (!adapter.capabilities.streaming)
          return adapter.complete(prompt, timedSignal, usage);
        let text = "",
          completed = false;
        for await (const event of adapter.stream(prompt, timedSignal)) {
          if (event.type === "text-delta") {
            text += event.text;
            if (text.length > 100000) throw new DomainError("VALIDATION_ERROR");
            input.onEvent(event);
          } else if (event.type === "usage") usage?.(event.usage);
          else if (event.type === "completed") completed = true;
          else if (
            event.type === "error" ||
            event.type === "tool-call" ||
            event.type === "tool-result"
          )
            throw new DomainError("VALIDATION_ERROR");
        }
        if (!completed) throw new Error("MODEL_STREAM_FAILED");
        // Plain streamed answers remain final answers. Only a complete, validated JSON envelope can request an action.
        return text.trimStart().startsWith("{")
          ? text
          : JSON.stringify({ kind: "FINAL", text });
      }),
    ...(adapter.respond
      ? {
          respond: (messages, tools, outerSignal) =>
            providerCall(outerSignal, async (signal) => {
              const candidates = [model, ...(model.fallbacks ?? [])];
              let failure: unknown;
              for (const candidate of candidates) {
                if (signal.aborted) throw new Error("INTERRUPTED");
                try {
                  const candidateAdapter = adaptModelProvider(candidate);
                  if (
                    !candidateAdapter.respond ||
                    !candidateAdapter.capabilities.tools
                  )
                    throw new Error("UNSUPPORTED_TOOLS");
                  // Approval is bound to the exact configured primary/fallback fingerprints.
                  if (
                    ![
                      current.route,
                      ...(current.route.fallbackRoutes ?? []),
                    ].some(
                      (route) =>
                        route.fingerprint === candidate.route.fingerprint,
                    )
                  )
                    throw new DomainError("VERSION_CONFLICT");
                  await transaction(async (_uow, notes, _store, library) =>
                    validateApprovedContext(
                      actor,
                      { ...current, route: candidate.route },
                      notes,
                      library,
                    ),
                  );
                  selectedRoute = candidate.route;
                  return await candidateAdapter.respond(
                    messages,
                    tools,
                    signal,
                  );
                } catch (error) {
                  failure = error;
                  // Never replay an uncertain sent request on another paid provider.
                  if (
                    !(error instanceof ModelNotSentError) &&
                    !(
                      error instanceof Error &&
                      error.message === "UNSUPPORTED_TOOLS"
                    )
                  )
                    throw error;
                }
              }
              throw failure;
            }),
        }
      : {}),
  };
  try {
    return await new AgentHarness({
      beforeModel: async (next) => {
        await transaction(async (_uow, _notes, connected) => {
          if (next.steps === 0) {
            stepRun = current;
            return;
          }
          // Additional provider calls are separate persisted attempts, so limits and budgets count every step.
          const service = new ConnectedService(
            connected,
            authorization,
            clock,
            ids,
          );
          const proposed = await service.propose(
            actor,
            JSON.stringify(next.messages),
            current.route,
          );
          const child = {
            ...proposed,
            parentRunId: current.id,
            version: proposed.version + 1,
            updatedAt: clock.now(),
          };
          await connected.saveRun(child, proposed.version);
          const approved = await service.decide(
            actor,
            child.id,
            child.version,
            true,
            model.route,
          );
          stepRun = await service.reserve(actor, approved.id, approved.version);
        });
      },
      afterModel: async (response) => {
        await transaction(async (_uow, _notes, connected) => {
          if (stepRun.id === current.id) {
            if (response.usage) {
              const saved = {
                ...current,
                version: current.version + 1,
                updatedAt: clock.now(),
                attempt: {
                  ...current.attempt!,
                  usage: response.usage,
                  ...(current.attempt?.money
                    ? {
                        money: settleGatewayMoney(current, response.usage, {
                          routeFingerprint: selectedRoute.fingerprint,
                          notSent: false,
                        })!,
                      }
                    : {}),
                },
              };
              await connected.saveRun(saved, current.version);
              current = saved;
            }
            return;
          }
          await new ConnectedService(
            connected,
            authorization,
            clock,
            ids,
          ).finish(
            actor,
            stepRun.id,
            response.text || JSON.stringify(response.toolCalls),
            null,
            false,
            response.usage,
            { routeFingerprint: selectedRoute.fingerprint, notSent: false },
          );
        });
      },
      approval: async (call) =>
        transaction(async () => {
          const approval = current.toolApprovals?.[call.id];
          return approval && approval.sessionVersion === current.sessionVersion
            ? approval.decision
            : "PENDING";
        }),
      execute: async (call, next) =>
        transaction(
          async (
            uow,
            _notes,
            connected,
            library,
            _organization,
            projects,
            sessions,
          ) => {
            const work = new WorkService(uow, authorization, clock, ids);
            const scope = new RetrievalContextResolver().resolve({
              ...(await work.snapshot(actor)),
              library: await library.list(),
              projectMaterials: await projects.list(),
              workspaceId: actor.workspaceId,
              ...current.retrievalScope,
              workspaceFallback: true,
            });
            const capabilities = new AiCapabilityService(
              authorization,
              work,
              library,
              new LibraryService(
                library,
                authorization,
                clock,
                ids,
                "EXTERNAL_AI",
              ),
              new RetrievalService(library, authorization),
              new ConnectedService(connected, authorization, clock, ids),
              true,
              new WorkflowService(
                uow,
                authorization,
                clock,
                ids,
                planDocumentPublisher(
                  uow,
                  projects,
                  library,
                  authorization,
                  clock,
                  ids,
                ),
              ),
            );
            const parsed = parseAiCapabilityCall(
              call.name,
              call.input as Record<string, unknown>,
              scope,
            );
            const rawResult = await capabilities.execute(
              actor,
              parsed,
              "REVIEW_WRITES",
              !!current.toolApprovals?.[call.id],
            );
            const compact = (value: unknown): unknown => {
              if (!value || typeof value !== "object") return value;
              const row = value as Record<string, unknown>;
              if (row.document && typeof row.document === "object") {
                const doc = row.document as Record<string, unknown>;
                return {
                  id: doc.id,
                  title: doc.title,
                  version: doc.version,
                  excerpt: String(row.snippet ?? doc.bodyMd ?? "").slice(
                    0,
                    800,
                  ),
                };
              }
              if (typeof row.bodyMd === "string")
                return {
                  id: row.id,
                  title: row.title,
                  version: row.version,
                  bodyMd: row.bodyMd.slice(0, 8000),
                  truncated: row.bodyMd.length > 8000,
                };
              if (row.type === "TASK" || row.type === "PROJECT")
                return {
                  id: row.id,
                  title: row.title,
                  version: row.version,
                  type: row.type,
                  status: row.status,
                  priority: row.priority,
                  startDate: row.startDate,
                  dueDate: row.dueDate,
                  projectIds: row.projectIds,
                };
              return value;
            };
            const result = Array.isArray(rawResult)
              ? {
                  items: rawResult.slice(0, 12).map(compact),
                  total: rawResult.length,
                  truncated: rawResult.length > 12,
                }
              : compact(rawResult);
            const evidenceIds =
              call.name === "read_document"
                ? [(call.input as { id: string }).id]
                : call.name === "search_documents" && Array.isArray(rawResult)
                  ? rawResult.map((value) => {
                      const row = value as { document: { id: string } };
                      return row.document.id;
                    })
                  : [];
            const evidence = [...(current.context ?? [])];
            for (const id of evidenceIds) {
              if (
                evidence.some((source) => source.ref.id === id) ||
                evidence.length >= 20
              )
                continue;
              const document = await library.get(id);
              validateContextPolicy(actor, selectedRoute, document);
              evidence.push({
                ref: { kind: "DOCUMENT", id },
                title: document.title,
                version: document.version,
                bodyMd: document.bodyMd,
                source: "retrieved",
                tokenEstimate: Math.ceil(document.bodyMd.length / 4),
                ...(document.aiPolicy ? { permission: document.aiPolicy } : {}),
              });
            }
            const sessionService = new AgentSessionService(
              sessions,
              authorization,
              clock,
              ids,
            );
            const called = await sessionService.append(
              actor,
              current.sessionId!,
              current.sessionVersion!,
              {
                kind: "TOOL_CALL",
                text: JSON.stringify(call),
                runId: current.id,
              },
            );
            const finished = await sessionService.append(
              actor,
              called.id,
              called.version,
              {
                kind: "TOOL_RESULT",
                text: JSON.stringify({
                  id: call.id,
                  name: call.name,
                  output: result,
                }),
                runId: current.id,
              },
            );
            // Persist the result with the mutation. Restart cannot replay a committed write.
            const resultText = JSON.stringify(result ?? null);
            if (resultText.length > 16000)
              throw new DomainError("VALIDATION_ERROR");
            const advanced: HarnessState = {
              ...structuredClone(next),
              pending: next.pending.slice(1),
              writes:
                next.writes +
                ([
                  "create_task",
                  "update_task",
                  "complete_task",
                  "reschedule_task",
                  "set_task_priority",
                  "move_task_to_project",
                  "publish_plan",
                  "create_document",
                  "move_document",
                  "link_documents",
                ].includes(call.name)
                  ? 1
                  : 0),
              messages: [
                ...next.messages,
                {
                  role: "tool",
                  text: resultText,
                  toolCallId: call.id,
                  toolName: call.name,
                },
              ],
            };
            const saved = {
              ...current,
              context: evidence,
              sessionVersion: finished.version,
              harness: advanced,
              version: current.version + 1,
              updatedAt: clock.now(),
            };
            await connected.saveRun(saved, current.version);
            current = saved;
            return result;
          },
        ),
      persist: save,
    }).run(routed, state, "REVIEW_WRITES", input.signal);
  } finally {
    // A failed or interrupted provider call must release its persisted child reservation.
    if (stepRun.id !== current.id) {
      await db.request(
        actor,
        null,
        async (_uow, _notes, connected) => {
          const child = await connected.getRun(stepRun.id);
          if (child.status === "RUNNING")
            await new ConnectedService(
              connected,
              authorization,
              clock,
              ids,
            ).finish(
              actor,
              child.id,
              null,
              input.signal.aborted
                ? "MODEL_INTERRUPTED"
                : "MODEL_REQUEST_FAILED",
              input.signal.aborted,
            );
        },
        checkAccess,
      );
    }
  }
}
