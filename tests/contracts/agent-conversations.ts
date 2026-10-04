import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  AgentSessionService,
  type AgentSessionStore,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

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
