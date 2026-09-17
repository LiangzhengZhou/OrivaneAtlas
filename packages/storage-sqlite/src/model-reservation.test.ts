import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  ConnectedService,
  NotebookService,
  validateApprovedContext,
} from "@arclattice/application";
import { expect, test } from "vitest";
import { snapshotToNewFile } from "./database";
import { restoreDatabase } from "./index";
import { context, sqliteHarness } from "./testing";

const h = sqliteHarness();
const auth = { require: async () => {} };
const clock = { now: () => "2026-09-17T12:00:00.000Z" };
const ids = { next: randomUUID };
const route = {
  fingerprint: "test",
  provider: "test",
  model: "test",
  maxInputChars: 1000,
  maxOutputTokens: 100,
  timeoutMs: 1000,
  maxRunsPerDay: 10,
};
test("send reservation is atomic, single-winner and survives independent backup restore", async () => {
  const file = h.file();
  const db = await h.open(file);
  await db.provisionWorkspace({ id: context.workspaceId, name: "Test" }, [
    { id: context.principalId, kind: "USER", displayName: "Owner" },
  ]);
  const approved = await db.request(
    context,
    null,
    async (_uow, notes, store) => {
      await new NotebookService(notes, auth, clock, ids).save(
        context,
        null,
        0,
        {
          title: "Private",
          bodyMd: "Never silently permit",
          kind: "NOTE",
          day: null,
        },
      );
      const service = new ConnectedService(store, auth, clock, ids);
      const run = await service.propose(context, "Hello", route);
      return service.decide(context, run.id, run.version, true, route);
    },
  );
  const reserve = () =>
    db.request(context, null, (_uow, _notes, store) =>
      new ConnectedService(store, auth, clock, ids).reserve(
        context,
        approved.id,
        approved.version,
      ),
    );
  await expect(
    db.request(context, null, async (_uow, _notes, store) => {
      await new ConnectedService(store, auth, clock, ids).reserve(
        context,
        approved.id,
        approved.version,
      );
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  const results = await Promise.allSettled([reserve(), reserve()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const snapshot = h.file();
  const reader = new DatabaseSync(file);
  try {
    await snapshotToNewFile(reader, snapshot);
  } finally {
    reader.close();
  }
  const restoredFile = h.file();
  await restoreDatabase(snapshot, restoredFile);
  const restored = await h.open(restoredFile);
  await restored.request(context, null, async (_uow, notes, store, library) => {
    const run = await store.getRun(approved.id);
    expect(run.attempt).toMatchObject({
      outcome: "RESERVED",
      inputChars: 5,
      reservedOutputTokens: 100,
      settledAt: null,
    });
    const note = (await notes.list())[0]!;
    expect(note.aiPolicy?.aiAccess).toBe("DENY");
    await expect(
      validateApprovedContext(
        context,
        {
          ...run,
          context: [
            {
              ref: { kind: "NOTE", id: note.id },
              version: note.version,
              title: note.title,
              bodyMd: note.bodyMd,
            },
          ],
        },
        notes,
        library,
      ),
    ).rejects.toThrow();
    await expect(
      new ConnectedService(store, auth, clock, ids).reserve(
        context,
        run.id,
        run.version,
      ),
    ).rejects.toThrow();
    const interrupted = await new ConnectedService(
      store,
      auth,
      clock,
      ids,
    ).finish(context, run.id, null, "HOST_RESTARTED", true);
    expect(interrupted.attempt?.outcome).toBe("UNKNOWN");
  });
});

test("reported usage settles once, rejects invalid counters and survives backup restore", async () => {
  const file = h.file();
  const db = await h.open(file);
  await db.provisionWorkspace({ id: context.workspaceId, name: "Usage" }, [
    { id: context.principalId, kind: "USER", displayName: "Owner" },
  ]);
  const reserved = await db.request(
    context,
    null,
    async (_uow, _notes, store) => {
      const service = new ConnectedService(store, auth, clock, ids);
      const proposed = await service.propose(context, "Hello", route);
      const approved = await service.decide(
        context,
        proposed.id,
        proposed.version,
        true,
        route,
      );
      return service.reserve(context, approved.id, approved.version);
    },
  );
  const finish = (inputTokens: number, actor = context) =>
    db.request(context, null, (_uow, _notes, store) =>
      new ConnectedService(store, auth, clock, ids).finish(
        actor,
        reserved.id,
        null,
        "MODEL_REQUEST_FAILED",
        false,
        { inputTokens, outputTokens: 7, source: "PROVIDER_REPORTED" },
      ),
    );
  await expect(finish(-1)).rejects.toThrow();
  await expect(finish(Number.NaN)).rejects.toThrow();
  await expect(
    finish(11, { ...context, principalId: "not-the-creator" }),
  ).rejects.toThrow();
  await finish(11);
  await expect(finish(99)).rejects.toThrow();
  const snapshot = h.file();
  const reader = new DatabaseSync(file);
  try {
    await snapshotToNewFile(reader, snapshot);
  } finally {
    reader.close();
  }
  const restoredFile = h.file();
  await restoreDatabase(snapshot, restoredFile);
  const restored = await h.open(restoredFile);
  await restored.request(context, null, async (_uow, _notes, store) => {
    const run = await store.getRun(reserved.id);
    expect(run.status).toBe("FAILED");
    expect(run.attempt).toMatchObject({
      id: reserved.attempt!.id,
      outcome: "UNKNOWN",
      usage: { inputTokens: 11, outputTokens: 7, source: "PROVIDER_REPORTED" },
      settledAt: clock.now(),
    });
  });
});
