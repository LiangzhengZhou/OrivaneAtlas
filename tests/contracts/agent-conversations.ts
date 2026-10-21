import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  AgentSessionService,
  type AgentSessionStore,
  ConnectedService,
  type ConnectedStore,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

export async function contextualPromotionScenario(
  run: <T>(
    actor: ActorContext,
    operation: (
      sessions: AgentSessionStore,
      connected: ConnectedStore,
    ) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" },
    auth = { require: async () => {} },
    clock = { now: () => "2026-10-15T00:00:00Z" },
    ids = { next: randomUUID };
  const service = (sessions: AgentSessionStore) =>
    new AgentSessionService(sessions, auth, clock, ids);
  const original = await run(actor, async (_sessions, connected) => {
    const proposed = await new ConnectedService(
      connected,
      auth,
      clock,
      ids,
    ).propose(
      actor,
      "Model instruction and private canonical data",
      {
        fingerprint: "promotion",
        provider: "ci",
        model: "ci",
        maxInputChars: 32000,
        maxOutputTokens: 100,
        maxRunsPerDay: 10,
        timeoutMs: 5000,
      },
      [
        {
          ref: { kind: "FILE", id: "canonical-file" },
          version: 1,
          title: "Source file",
          bodyMd: "Private extracted original",
        },
      ],
      { userPrompt: "Human question" },
    );
    const finished = {
      ...proposed,
      status: "SUCCEEDED" as const,
      version: 2,
      output: "Canonical answer",
    };
    await connected.saveRun(finished, 1);
    return finished;
  });
  const refs = [{ id: original.id, version: original.version }];
  await expect(
    run(actor, async (sessions, connected) => {
      await service(sessions).promoteRuns(
        actor,
        connected,
        "Rolled back",
        refs,
      );
      throw new Error("ROLLBACK");
    }),
  ).rejects.toThrow("ROLLBACK");
  expect(
    await run(actor, (sessions) => service(sessions).summaries(actor)),
  ).toEqual([]);
  expect(
    (await run(actor, (_sessions, connected) => connected.getRun(original.id)))
      .version,
  ).toBe(2);
  await expect(
    run(actor, (sessions, connected) =>
      service(sessions).promoteRuns(actor, connected, "Duplicate", [
        ...refs,
        ...refs,
      ]),
    ),
  ).rejects.toThrow("VALIDATION_ERROR");
  await expect(
    run({ ...actor, principalId: "other" }, (sessions, connected) =>
      service(sessions).promoteRuns(
        { ...actor, principalId: "other" },
        connected,
        "Foreign",
        refs,
      ),
    ),
  ).rejects.toThrow("FORBIDDEN");
  const promoted = await run(actor, (sessions, connected) =>
    service(sessions).promoteRuns(actor, connected, "Saved discussion", refs),
  );
  expect(
    promoted.messages.map((message) => [
      message.kind,
      message.text,
      message.runId,
    ]),
  ).toEqual([
    ["USER", "Human question", original.id],
    ["ASSISTANT", "Canonical answer", original.id],
  ]);
  expect(JSON.stringify(promoted)).not.toContain("private canonical data");
  expect(JSON.stringify(promoted)).not.toContain("Private extracted original");
  expect(promoted.messages[1]?.evidence).toContainEqual({
    ref: { kind: "FILE", id: "canonical-file" },
    version: 1,
    title: "Source file",
    source: "current",
  });
  const canonical = await run(actor, (_sessions, connected) =>
    connected.getRun(original.id),
  );
  expect(canonical).toMatchObject({
    sessionId: promoted.id,
    version: 3,
    userPrompt: "Human question",
    output: "Canonical answer",
  });
  await expect(
    run(actor, (sessions, connected) =>
      service(sessions).promoteRuns(actor, connected, "Again", [
        { id: original.id, version: 3 },
      ]),
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  expect(
    await run(actor, (sessions) => service(sessions).summaries(actor)),
  ).toHaveLength(1);
}

export async function conversationScenario(
  run: <T>(
    actor: ActorContext,
    operation: (store: AgentSessionStore) => Promise<T>,
  ) => Promise<T>,
) {
  const actor = { workspaceId: "workspace-a", principalId: "human" };
  const service = (store: AgentSessionStore) =>
    new AgentSessionService(
      store,
      { require: async () => {} },
      { now: () => "2026-10-04T12:00:00Z" },
      { next: randomUUID },
    );
  const created = await run(actor, (store) =>
    service(store).create(actor, "Conversation"),
  );
  await run(actor, (store) =>
    store.save(
      {
        ...created,
        version: 2,
        messages: Array.from({ length: 120 }, (_, i) => ({
          id: `message-${i}`,
          kind: "USER" as const,
          text: `Message ${i} ${"x".repeat(2000)}`,
          runId: null,
          createdAt: created.createdAt,
        })),
      },
      1,
    ),
  );
  const summaries = await run(actor, (store) =>
    service(store).summaries(actor),
  );
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatchObject({
    id: created.id,
    messageCount: 120,
    projectId: null,
    spaceId: null,
    archivedAt: null,
  });
  expect(summaries[0]).not.toHaveProperty("messages");
  expect(summaries[0]?.preview.length).toBe(160);
  const recent = await run(actor, (store) =>
    service(store).page(actor, created.id),
  );
  expect(recent.session.messages).toHaveLength(50);
  expect(recent.session.messages[0]?.id).toBe("message-70");
  expect(recent.before).toBe(70);
  const middle = await run(actor, (store) =>
    service(store).page(actor, created.id, recent.before),
  );
  expect(middle.session.messages[0]?.id).toBe("message-20");
  const first = await run(actor, (store) =>
    service(store).page(actor, created.id, middle.before),
  );
  expect(first.session.messages).toHaveLength(20);
  expect(first.hasMore).toBe(false);
  expect(
    new Set(
      [
        ...first.session.messages,
        ...middle.session.messages,
        ...recent.session.messages,
      ].map((message) => message.id),
    ).size,
  ).toBe(120);
  await expect(
    run(actor, (store) => service(store).page(actor, created.id, -1)),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const renamed = await run(actor, (store) =>
    service(store).update(actor, created.id, 2, {
      title: "Renamed",
      archivedAt: created.createdAt,
    }),
  );
  await expect(
    run(actor, (store) =>
      service(store).update(actor, created.id, 2, { title: "Stale" }),
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  const deleted = await run(actor, (store) =>
    service(store).update(actor, created.id, renamed.version, {
      deletedAt: created.createdAt,
    }),
  );
  expect(await run(actor, (store) => service(store).summaries(actor))).toEqual(
    [],
  );
  await expect(
    run(actor, (store) => service(store).page(actor, created.id)),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await run(actor, (store) =>
    service(store).update(actor, created.id, deleted.version, {
      deletedAt: null,
      archivedAt: null,
    }),
  );
  expect(
    (await run(actor, (store) => service(store).summaries(actor)))[0],
  ).toMatchObject({ title: "Renamed", archivedAt: null, messageCount: 120 });
  const other = { ...actor, workspaceId: "workspace-b" };
  expect(await run(other, (store) => service(store).summaries(other))).toEqual(
    [],
  );
  await expect(
    run(other, (store) => service(store).page(other, created.id)),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
}
