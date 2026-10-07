import { DomainError } from "@arclattice/domain";
import {
  type ExecutionApproval,
  requiresExecutionApproval,
} from "./ai-context";
import {
  capabilityDefinition,
  capabilityRegistry,
  validateCapabilityInput,
} from "./capability-registry";
import type {
  ModelMessage,
  ModelProviderAdapter,
  ModelResponse,
  ModelToolCall,
} from "./provider-adapter";
import { providerDiagnostic } from "./provider-error";

export interface HarnessLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxWrites: number;
  maxWallTimeMs: number;
  maxContextChars: number;
}
export const defaultHarnessLimits: Readonly<HarnessLimits> = {
  maxSteps: 8,
  maxToolCalls: 12,
  maxWrites: 5,
  maxWallTimeMs: 120000,
  maxContextChars: 64000,
};
export interface HarnessState {
  status:
    | "RUNNING"
    | "WAITING_APPROVAL"
    | "FINAL"
    | "ERROR"
    | "INTERRUPTED"
    | "LIMIT_REACHED";
  steps: number;
  toolCalls: number;
  writes: number;
  startedAt: number;
  activeMs?: number;
  messages: ModelMessage[];
  pending: ModelToolCall[];
  error?: string;
}
/** Host callbacks perform fresh authorization, version checks and durable atomic writes. */
export interface HarnessPort {
  beforeModel(state: Readonly<HarnessState>): Promise<void>;
  afterModel(
    response: ModelResponse,
    state: Readonly<HarnessState>,
  ): Promise<void>;
  execute(call: ModelToolCall, state: Readonly<HarnessState>): Promise<unknown>;
  approval(call: ModelToolCall): Promise<"APPROVED" | "REJECTED" | "PENDING">;
  persist(state: Readonly<HarnessState>): Promise<void>;
}

export function parsePlannerResponse(text: string): ModelResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DomainError("VALIDATION_ERROR");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError("VALIDATION_ERROR");
  const row = value as Record<string, unknown>;
  if (
    row.kind === "FINAL" &&
    typeof row.text === "string" &&
    Object.keys(row).every((key) => ["kind", "text"].includes(key))
  )
    return { text: row.text, toolCalls: [] };
  if (
    row.kind !== "ACTION" ||
    typeof row.name !== "string" ||
    Object.keys(row).some((key) => !["kind", "name", "input"].includes(key))
  )
    throw new DomainError("VALIDATION_ERROR");
  validateCapabilityInput(
    capabilityDefinition(row.name).inputSchema,
    row.input,
  );
  return {
    text: "",
    toolCalls: [{ id: "planner", name: row.name, input: row.input }],
  };
}

export class AgentHarness {
  constructor(
    private readonly port: HarnessPort,
    private readonly limits: HarnessLimits = defaultHarnessLimits,
    private readonly now: () => number = Date.now,
  ) {
    if (
      Object.values(limits).some(
        (value) => !Number.isSafeInteger(value) || value < 1,
      ) ||
      limits.maxSteps > 8 ||
      limits.maxToolCalls > 12 ||
      limits.maxWrites > 5 ||
      limits.maxWallTimeMs > 120000 ||
      limits.maxContextChars > 64000
    )
      throw new DomainError("VALIDATION_ERROR");
  }
  async run(
    adapter: ModelProviderAdapter,
    initial: HarnessState,
    policy: ExecutionApproval,
    signal: AbortSignal,
  ): Promise<HarnessState> {
    if (
      [
        initial.steps,
        initial.toolCalls,
        initial.writes,
        initial.activeMs ?? 0,
      ].some((value) => !Number.isSafeInteger(value) || value < 0) ||
      !Array.isArray(initial.messages) ||
      !Array.isArray(initial.pending)
    )
      throw new DomainError("VALIDATION_ERROR");
    const state: HarnessState = structuredClone(initial);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const invocationStart = this.now();
    const previousActive = state.activeMs ?? 0;
    const elapsed = () => previousActive + this.now() - invocationStart;
    const persist = async () => {
      state.activeMs = elapsed();
      await this.port.persist(state);
    };
    const remaining = this.limits.maxWallTimeMs - previousActive;
    const timer = setTimeout(abort, Math.max(1, remaining));
    const bounded = async <T>(operation: Promise<T>): Promise<T> => {
      let rejectAbort: () => void = () => {};
      const interrupted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new Error("INTERRUPTED"));
        controller.signal.addEventListener("abort", rejectAbort, {
          once: true,
        });
        if (controller.signal.aborted) rejectAbort();
      });
      try {
        return await Promise.race([operation, interrupted]);
      } finally {
        controller.signal.removeEventListener("abort", rejectAbort);
      }
    };
    const check = () => {
      if (controller.signal.aborted) throw new Error("INTERRUPTED");
      if (
        elapsed() >= this.limits.maxWallTimeMs ||
        JSON.stringify(state.messages).length > this.limits.maxContextChars
      )
        throw new Error("LIMIT_REACHED");
    };
    try {
      if (!["RUNNING", "WAITING_APPROVAL"].includes(state.status)) return state;
      if (remaining <= 0) throw new Error("LIMIT_REACHED");
      state.status = "RUNNING";
      while (true) {
        check();
        while (state.pending.length) {
          const call = state.pending[0]!;
          const definition = capabilityDefinition(call.name);
          validateCapabilityInput(definition.inputSchema, call.input);
          let approved = "APPROVED";
          if (
            call.name === "publish_plan" ||
            (definition.previewOnly
              ? policy === "REVIEW_EVERYTHING"
              : requiresExecutionApproval(definition.risk, policy))
          )
            approved = await this.port.approval(call);
          if (approved === "PENDING") {
            state.status = "WAITING_APPROVAL";
            await persist();
            return state;
          }
          check();
          const writing =
            definition.risk === "WRITE" || definition.risk === "DESTRUCTIVE";
          if (
            approved === "APPROVED" &&
            writing &&
            state.writes >= this.limits.maxWrites
          )
            throw new Error("LIMIT_REACHED");
          let output: unknown = { error: "HUMAN_REJECTED" };
          if (approved !== "REJECTED") {
            try {
              output = await this.port.execute(call, state);
            } catch (error) {
              if (!(error instanceof DomainError)) throw error;
              output = { error: error.code };
            }
          }
          if (approved === "APPROVED" && writing) state.writes++;
          const result = JSON.stringify(output ?? null);
          if (result.length > 16000) throw new Error("TOOL_RESULT_TOO_LARGE");
          state.messages.push({
            role: "tool",
            text: result,
            toolCallId: call.id,
            toolName: call.name,
          });
          state.pending.shift();
          await persist();
        }
        if (state.steps >= this.limits.maxSteps)
          throw new Error("LIMIT_REACHED");
        await this.port.beforeModel(state);
        check();
        const response = await bounded(
          adapter.capabilities.tools && adapter.respond
            ? adapter.respond(
                state.messages,
                capabilityRegistry.map((entry) => ({
                  name: entry.name,
                  description: entry.description,
                  inputSchema: entry.inputSchema as unknown as Record<
                    string,
                    unknown
                  >,
                })),
                controller.signal,
              )
            : adapter
                .complete(
                  JSON.stringify({
                    instructions:
                      'Return only {"kind":"FINAL","text":"..."} or {"kind":"ACTION","name":"allowed tool","input":{...}}. Never claim human approval. Use preview_plan for batch imports.',
                    tools: capabilityRegistry,
                    messages: state.messages,
                  }),
                  controller.signal,
                )
                .then(parsePlannerResponse),
        );
        check();
        if (
          !response ||
          typeof response.text !== "string" ||
          response.text.length > 100000 ||
          !Array.isArray(response.toolCalls)
        )
          throw new DomainError("VALIDATION_ERROR");
        state.steps++;
        await this.port.afterModel(response, state);
        if (
          response.toolCalls.length >
          this.limits.maxToolCalls - state.toolCalls
        )
          throw new Error("LIMIT_REACHED");
        const seen = new Set(
          state.messages.flatMap(
            (message) => message.toolCalls?.map((call) => call.id) ?? [],
          ),
        );
        const calls = response.toolCalls.map((call, index) => {
          const id =
            call.id === "planner" ? `planner-${state.steps}-${index}` : call.id;
          if (!id || id.length > 240 || seen.has(id))
            throw new DomainError("VALIDATION_ERROR");
          seen.add(id);
          validateCapabilityInput(
            capabilityDefinition(call.name).inputSchema,
            call.input,
          );
          return { ...call, id };
        });
        state.toolCalls += calls.length;
        state.messages.push({
          role: "assistant",
          text: response.text,
          toolCalls: calls,
          ...(response.providerData === undefined
            ? {}
            : { providerData: response.providerData }),
        });
        // Queue consumption must not mutate the assistant's audited tool-call array.
        state.pending = [...calls];
        state.status = calls.length ? "RUNNING" : "FINAL";
        await persist();
        if (state.status === "FINAL") return state;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "HARNESS_ERROR";
      state.status = controller.signal.aborted
        ? "INTERRUPTED"
        : reason === "LIMIT_REACHED"
          ? "LIMIT_REACHED"
          : "ERROR";
      state.error =
        error instanceof DomainError
          ? error.code
          : (providerDiagnostic(error) ?? reason);
      await persist();
      return state;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}
