import { DomainError } from "@arclattice/domain";
import { describe, expect, it, vi } from "vitest";
import {
  AgentHarness,
  defaultHarnessLimits,
  type HarnessPort,
  type HarnessState,
  parsePlannerResponse,
} from "./agent-harness";
import type { ModelProviderAdapter, ModelResponse } from "./provider-adapter";

function fixture(responses: ModelResponse[]) {
  const state: HarnessState = {
    status: "RUNNING",
    steps: 0,
    toolCalls: 0,
    writes: 0,
    startedAt: Date.now(),
    messages: [{ role: "user", text: "Help" }],
    pending: [],
  };
  const port: HarnessPort = {
    beforeModel: vi.fn(async () => {}),
    afterModel: vi.fn(async () => {}),
    execute: vi.fn(async () => ({ id: "task" })),
    approval: vi.fn(async () => "PENDING" as const),
    persist: vi.fn(async () => {}),
  };
  const adapter: ModelProviderAdapter = {
    capabilities: {
      tools: true,
      streaming: false,
      jsonSchema: true,
      vision: false,
      embedding: false,
    },
    respond: vi.fn(async () => responses.shift()!),
    complete: vi.fn(async () => ""),
    stream: async function* () {},
    listModels: async () => [],
  };
  return { state, port, adapter, signal: new AbortController().signal };
}
describe("bounded agent harness", () => {
  it("rejects corrupt persisted counters before calling a provider", async () => {
    const f = fixture([]);
    f.state.writes = -1;
    await expect(
      new AgentHarness(f.port).run(f.adapter, f.state, "AUTO_SAFE", f.signal),
    ).rejects.toThrow("VALIDATION_ERROR");
    expect(f.adapter.respond).not.toHaveBeenCalled();
  });
  it("rejects malformed native responses without executing tools", async () => {
    const f = fixture([]);
    const result = await new AgentHarness(f.port).run(
      f.adapter,
      f.state,
      "AUTO_SAFE",
      f.signal,
    );
    expect(result.status).toBe("ERROR");
    expect(f.port.execute).not.toHaveBeenCalled();
  });
  it("feeds authorized read results back to the provider before final answer", async () => {
    const f = fixture([
      {
        text: "",
        toolCalls: [
          { id: "read", name: "get_project", input: { id: "project" } },
        ],
      },
      { text: "Done", toolCalls: [] },
    ]);
    const result = await new AgentHarness(f.port).run(
      f.adapter,
      f.state,
      "REVIEW_WRITES",
      f.signal,
    );
    expect(result.status).toBe("FINAL");
    expect(result.steps).toBe(2);
    expect(result.messages[1]!.toolCalls).toEqual([
      { id: "read", name: "get_project", input: { id: "project" } },
    ]);
    expect(result.messages[2]).toMatchObject({
      role: "tool",
      toolCallId: "read",
    });
    expect(f.port.approval).not.toHaveBeenCalled();
  });
  it("persists and resumes a write only after real approval", async () => {
    const f = fixture([
      {
        text: "",
        toolCalls: [
          { id: "write", name: "create_task", input: { title: "Study" } },
        ],
      },
      { text: "Created", toolCalls: [] },
    ]);
    const harness = new AgentHarness(f.port);
    const waiting = await harness.run(
      f.adapter,
      f.state,
      "REVIEW_WRITES",
      f.signal,
    );
    expect(waiting.status).toBe("WAITING_APPROVAL");
    expect(f.port.execute).not.toHaveBeenCalled();
    f.port.approval = vi.fn(async () => "APPROVED" as const);
    const done = await harness.run(
      f.adapter,
      waiting,
      "REVIEW_WRITES",
      f.signal,
    );
    expect(done.status).toBe("FINAL");
    expect(done.writes).toBe(1);
    expect(f.port.execute).toHaveBeenCalledTimes(1);
  });
  it("rejection is a tool result and never executes the write", async () => {
    const f = fixture([
      {
        text: "",
        toolCalls: [
          { id: "write", name: "create_task", input: { title: "Study" } },
        ],
      },
      { text: "Not created", toolCalls: [] },
    ]);
    f.port.approval = vi.fn(async () => "REJECTED" as const);
    const done = await new AgentHarness(f.port).run(
      f.adapter,
      f.state,
      "REVIEW_WRITES",
      f.signal,
    );
    expect(done.status).toBe("FINAL");
    expect(f.port.execute).not.toHaveBeenCalled();
    expect(done.messages[2]?.text).toContain("HUMAN_REJECTED");
  });
  it.each([
    { name: "unknown", input: {} },
    { name: "complete_task", input: { id: "task", version: 0 } },
    { name: "create_task", input: { title: "Test", approved: true } },
  ])("rejects invalid or unauthorized tool envelope %s", async (call) => {
    const f = fixture([{ text: "", toolCalls: [{ id: "bad", ...call }] }]);
    expect(
      (
        await new AgentHarness(f.port).run(
          f.adapter,
          f.state,
          "AUTO_SAFE",
          f.signal,
        )
      ).status,
    ).toBe("ERROR");
    expect(f.port.execute).not.toHaveBeenCalled();
  });
  it("enforces model step and write caps", async () => {
    const f = fixture([
      {
        text: "",
        toolCalls: [
          { id: "read", name: "get_project", input: { id: "project" } },
        ],
      },
    ]);
    const result = await new AgentHarness(f.port, {
      ...defaultHarnessLimits,
      maxSteps: 1,
    }).run(f.adapter, f.state, "AUTO_SAFE", f.signal);
    expect(result.status).toBe("LIMIT_REACHED");
    expect(f.adapter.respond).toHaveBeenCalledTimes(1);
    const w = fixture([
      {
        text: "",
        toolCalls: [1, 2].map((n) => ({
          id: `write-${n}`,
          name: "create_task",
          input: { title: `Task ${n}` },
        })),
      },
    ]);
    const limited = await new AgentHarness(w.port, {
      ...defaultHarnessLimits,
      maxWrites: 1,
    }).run(w.adapter, w.state, "AUTO_SAFE", w.signal);
    expect(limited.status).toBe("LIMIT_REACHED");
    expect(w.port.execute).toHaveBeenCalledTimes(1);
  });
  it("never guesses tool calls from natural language", () => {
    expect(() =>
      parsePlannerResponse('Please call create_task with title "Study"'),
    ).toThrow();
    expect(() =>
      parsePlannerResponse(
        '{"kind":"ACTION","name":"create_task","input":{"title":"Study"}}',
      ),
    ).not.toThrow();
  });
  it("returns a typed tool failure to the model without exposing server errors", async () => {
    const f = fixture([
      {
        text: "",
        toolCalls: [
          { id: "read", name: "get_project", input: { id: "missing" } },
        ],
      },
      { text: "Project unavailable", toolCalls: [] },
    ]);
    f.port.execute = vi.fn(async () => {
      throw new DomainError("NOT_FOUND");
    });
    const result = await new AgentHarness(f.port).run(
      f.adapter,
      f.state,
      "REVIEW_WRITES",
      f.signal,
    );
    expect(result.status).toBe("FINAL");
    expect(result.messages[2]?.text).toBe('{"error":"NOT_FOUND"}');
  });
  it("hard-stops even when a provider ignores AbortSignal", async () => {
    const f = fixture([]);
    f.adapter.respond = async () => new Promise(() => {});
    const result = await new AgentHarness(f.port, {
      ...defaultHarnessLimits,
      maxWallTimeMs: 20,
    }).run(f.adapter, f.state, "REVIEW_WRITES", f.signal);
    expect(result.status).toBe("INTERRUPTED");
    expect(f.port.execute).not.toHaveBeenCalled();
  });
  it("requires human publication approval even under AUTO_SAFE", async () => {
    const f = fixture([
      {
        text: "",
        toolCalls: [
          {
            id: "publish",
            name: "publish_plan",
            input: { id: "plan", version: 1 },
          },
        ],
      },
    ]);
    const result = await new AgentHarness(f.port).run(
      f.adapter,
      f.state,
      "AUTO_SAFE",
      f.signal,
    );
    expect(result.status).toBe("WAITING_APPROVAL");
    expect(f.port.execute).not.toHaveBeenCalled();
  });
});
