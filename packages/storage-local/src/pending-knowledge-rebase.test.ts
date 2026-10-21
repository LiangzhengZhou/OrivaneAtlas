import { randomUUID } from "node:crypto";
import {
  bodyManifest,
  buildLocalKnowledgeReplayRequest,
  type LibraryEntry,
  type LocalMutation,
  type LocalSyncState,
  listLocalWorkConflictReviews,
  localDto,
  localObject,
  planLocalCommands,
  prepareLocalDeletedKnowledge,
  prepareLocalPendingWorkRebase,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, test } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

async function fixture(reviewed = false, deleted = false) {
  const factory = new IDBFactory(),
    name = randomUUID();
  const own = {
    schemaVersion: 1 as const,
    workspaceId: randomUUID(),
    principalId: randomUUID(),
    deviceId: randomUUID(),
  };
  const actor = { workspaceId: own.workspaceId, principalId: own.principalId };
  const binding: LocalSyncState = {
    workspaceId: own.workspaceId,
    remoteWorkspaceId: "remote",
    remotePrincipalId: "owner",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 10,
    version: 1,
  };
  const at = "2026-10-15T00:00:00Z",
    commandId = randomUUID(),
    nextId = randomUUID();
  const base: LibraryEntry = {
    id: "doc",
    workspaceId: own.workspaceId,
    version: 1,
    kind: "DOCUMENT",
    spaceId: "space",
    parentDocumentId: null,
    aliases: [],
    title: "Original title",
    bodyMd: "one\nmiddle\nthree",
    createdAt: at,
    updatedAt: at,
    createdBy: own.principalId,
    updatedBy: own.principalId,
    deletedAt: null,
    provenance: "HUMAN",
  };
  const payload = { ...base, version: 2, bodyMd: "local one\nmiddle\nthree" };
  const remote = {
    ...base,
    workspaceId: "remote",
    title: "Remote title",
    version: 2,
    bodyMd: reviewed
      ? "remote one\nmiddle\nthree"
      : "one\nmiddle\nremote three",
    updatedBy: "owner",
    deletedAt: deleted ? at : null,
  };
  const mutation: LocalMutation = {
    id: commandId,
    commandId,
    workspaceId: own.workspaceId,
    principalId: own.principalId,
    deviceId: own.deviceId,
    entityType: "library",
    entityId: "doc",
    operation: "PATCH",
    baseVersion: 1,
    basePayload: localDto(base),
    payload: localDto(payload),
    createdAt: at,
    attemptCount: reviewed ? 1 : 0,
    lastAttemptAt: reviewed ? at : null,
    state: reviewed ? "CONFLICT" : "PENDING",
    order: { transactionVersion: 1, operationIndex: 0 },
  };
  const store = await IndexedDbLocalStore.open(name, factory);
  await store.metadata.restoreEmptyWorkspace!(
    {
      schemaVersion: 2,
      identity: own,
      syncState: binding,
      mutations: [mutation],
      entities: [
        ...(deleted
          ? [
              {
                workspaceId: own.workspaceId,
                collection: "library",
                id: "space",
                version: 1,
                value: localDto(
                  bodyManifest({
                    ...base,
                    id: "space",
                    kind: "SPACE",
                    spaceId: null,
                    bodyMd: "",
                  }),
                ),
              },
              {
                workspaceId: own.workspaceId,
                collection: "$local.libraryBody",
                id: "space",
                version: 1,
                value: { noteVersion: 1, bodyMd: "" },
              },
            ]
          : []),
        {
          workspaceId: own.workspaceId,
          collection: "$local.workspace",
          id: "revision",
          version: 1,
          value: { revision: 1 },
        },
        {
          workspaceId: own.workspaceId,
          collection: "library",
          id: "doc",
          version: 2,
          value: localDto(bodyManifest(payload)),
        },
        {
          workspaceId: own.workspaceId,
          collection: "$local.libraryBody",
          id: "doc",
          version: 1,
          value: { noteVersion: 2, bodyMd: payload.bodyMd },
        },
        {
          workspaceId: own.workspaceId,
          collection: "$local.command",
          id: commandId,
          version: 1,
          value: localDto({
            schemaVersion: 1,
            id: commandId,
            workspaceId: own.workspaceId,
            principalId: own.principalId,
            name: "library.save",
            mutationIds: [commandId],
            input: {
              id: "doc",
              version: 1,
              create: false,
              input: {
                title: payload.title,
                kind: "DOCUMENT",
                spaceId: "space",
                parentDocumentId: null,
                aliases: [],
                bodyMd: payload.bodyMd,
              },
            },
          }),
        },
        {
          workspaceId: own.workspaceId,
          collection: "$local.remoteBase",
          id: JSON.stringify(["library", "doc"]),
          version: 1,
          value: localDto({
            ...binding,
            collection: "library",
            id: "doc",
            version: 2,
            value: remote,
          }),
        },
      ],
    },
    own.deviceId,
  );
  const wiki = {
    resolve: (
      links: readonly import("@arclattice/application").DocumentWikiLink[],
    ) => [...links],
    extract: (_id: string, body: string) =>
      body.includes("[[Wiki]]")
        ? [
            {
              sourceDocumentId: "doc",
              targetDocumentId: null,
              targetText: "Wiki",
              alias: null,
              heading: null,
            },
          ]
        : [],
  };
  const prepare = async (choice?: "LOCAL" | "REMOTE") => {
    const pending = await store.outbox.list(own.workspaceId);
    const plans = await planLocalCommands(actor, store.metadata, pending);
    const captured = choice
      ? (
          await listLocalWorkConflictReviews(
            actor,
            binding,
            store.metadata,
            store.outbox,
          )
        )[0]
      : undefined;
    return prepareLocalPendingWorkRebase(
      actor,
      binding,
      plans[0]!,
      pending,
      store.metadata,
      { next: () => nextId },
      { now: () => at },
      captured && choice ? { captured, choice } : undefined,
      wiki,
    );
  };
  return {
    store,
    actor,
    own,
    binding,
    factory,
    name,
    payload,
    remote,
    commandId,
    nextId,
    prepare,
  };
}

test.each(["RESTORE", "REMOTE", "COPY"] as const)(
  "deleted Markdown %s retains original intent and commits the selected disposition across restart",
  async (choice) => {
    const f = await fixture(true, true);
    try {
      const before = await f.store.metadata.exportWorkspace!(f.own.workspaceId);
      const [captured] = await listLocalWorkConflictReviews(
        f.actor,
        f.binding,
        f.store.metadata,
        f.store.outbox,
      );
      const prepared = await prepareLocalDeletedKnowledge(
        f.actor,
        captured!,
        choice,
        f.store.metadata,
        f.store.outbox,
        {
          put: async () => {
            throw new Error("NO_BINARY_WRITES");
          },
          get: async () => null,
        },
        { extract: () => [], resolve: (links) => [...links] },
        { now: () => "2026-10-15T01:00:00Z" },
        { next: randomUUID },
      );
      expect(
        await f.store.metadata.exportWorkspace!(f.own.workspaceId),
      ).toEqual(before);
      await f.store.deletedKnowledge.commit(prepared);
      const pending = await f.store.outbox.list(f.own.workspaceId);
      expect(pending.some((entry) => entry.id === captured!.original.id)).toBe(
        false,
      );
      expect(
        await f.store.metadata.get(
          f.own.workspaceId,
          "$local.command",
          f.commandId,
        ),
      ).toEqual(captured!.originalCommand);
      expect(
        await f.store.metadata.get(
          f.own.workspaceId,
          "$local.superseded",
          f.commandId,
        ),
      ).toMatchObject({
        value: {
          choice,
          original: captured!.original,
          originalCommand: captured!.originalCommand,
        },
      });
      const original = await f.store.metadata.get(
        f.own.workspaceId,
        "library",
        "doc",
      );
      expect(original).toMatchObject({
        version: choice === "RESTORE" ? 4 : 2,
        value: { deletedAt: choice === "RESTORE" ? null : f.remote.deletedAt },
      });
      if (choice === "REMOTE") expect(pending).toEqual([]);
      else {
        expect(pending).toHaveLength(choice === "RESTORE" ? 2 : 1);
        const plans = await planLocalCommands(
          f.actor,
          f.store.metadata,
          pending,
        );
        const request = buildLocalKnowledgeReplayRequest(plans[0]!);
        expect(request).not.toBeNull();
        expect(request!.body).toMatchObject({
          input: { bodyMd: f.payload.bodyMd },
          ...(choice === "RESTORE"
            ? { restoreDeleted: true, version: 2 }
            : { stableId: prepared.resultId }),
        });
      }
      f.store.close();
      const reopened = await IndexedDbLocalStore.open(f.name, f.factory);
      try {
        expect(
          await reopened.metadata.get(
            f.own.workspaceId,
            "$local.libraryBody",
            prepared.resultId,
          ),
        ).toMatchObject({
          value: {
            bodyMd: choice === "REMOTE" ? f.remote.bodyMd : f.payload.bodyMd,
          },
        });
        expect(await reopened.syncState.get(f.own.workspaceId)).toEqual(
          f.binding,
        );
      } finally {
        reopened.close();
      }
    } finally {
      f.store.close();
    }
  },
);

test("Markdown rebase atomically preserves source command, both edits, revisions and indexed search across restart", async () => {
  const f = await fixture();
  try {
    const prepared = await f.prepare();
    expect(prepared).not.toBeNull();
    await f.store.pendingWorkRebase.commit(prepared!);
    const body = "local one\nmiddle\nremote three";
    expect(
      await f.store.metadata.get(
        f.own.workspaceId,
        "$local.libraryBody",
        "doc",
      ),
    ).toMatchObject({ value: { noteVersion: 3, bodyMd: body } });
    expect(
      await f.store.metadata.get(
        f.own.workspaceId,
        "$local.libraryRevision",
        JSON.stringify(["doc", 3]),
      ),
    ).toMatchObject({
      value: { bodyMd: body, title: "Remote title", version: 3 },
    });
    expect(
      await f.store.metadata.get(f.own.workspaceId, "library", "doc"),
    ).toMatchObject({
      version: 3,
      value: { bodyState: "UNLOADED", title: "Remote title" },
    });
    expect(
      await f.store.metadata.searchCandidates!(
        f.own.workspaceId,
        "$local.librarySearch",
        "rem",
      ),
    ).toHaveLength(1);
    const replay = buildLocalKnowledgeReplayRequest(
      (
        await planLocalCommands(
          f.actor,
          f.store.metadata,
          await f.store.outbox.list(f.own.workspaceId),
        )
      )[0]!,
    );
    expect(replay).toMatchObject({
      path: "/api/v1/library/save",
      body: {
        id: "doc",
        version: 2,
        input: { bodyMd: body, title: "Remote title" },
      },
    });
    expect((await f.store.outbox.list(f.own.workspaceId))[0]).toMatchObject({
      id: f.nextId,
      baseVersion: 2,
      payload: { bodyMd: body, title: "Remote title" },
    });
    expect(
      await f.store.metadata.get(
        f.own.workspaceId,
        "$local.command",
        f.commandId,
      ),
    ).not.toBeNull();
    expect(
      await f.store.metadata.get(
        f.own.workspaceId,
        "$local.superseded",
        f.commandId,
      ),
    ).toMatchObject({
      value: { original: { payload: { bodyMd: f.payload.bodyMd } } },
    });
    const before = await f.store.metadata.exportWorkspace!(f.own.workspaceId);
    f.store.close();
    const reopened = await IndexedDbLocalStore.open(f.name, f.factory);
    try {
      expect(
        await reopened.metadata.exportWorkspace!(f.own.workspaceId),
      ).toEqual(before);
    } finally {
      reopened.close();
    }
  } finally {
    f.store.close();
  }
});

test.each(["LOCAL", "REMOTE"] as const)(
  "same-line Markdown review requires explicit %s choice and preserves remote metadata",
  async (choice) => {
    const f = await fixture(true);
    try {
      const prepared = await f.prepare(choice);
      expect(prepared).not.toBeNull();
      await f.store.pendingWorkRebase.commit(prepared!);
      expect(
        await f.store.metadata.get(
          f.own.workspaceId,
          "$local.libraryBody",
          "doc",
        ),
      ).toMatchObject({
        value: {
          bodyMd: choice === "LOCAL" ? f.payload.bodyMd : f.remote.bodyMd,
        },
      });
      const next = (await f.store.outbox.list(f.own.workspaceId))[0]!;
      expect(localObject(next.payload).title).toBe("Remote title");
      expect(
        await f.store.metadata.get(
          f.own.workspaceId,
          "$local.command",
          f.commandId,
        ),
      ).not.toBeNull();
    } finally {
      f.store.close();
    }
  },
);

test("incomplete knowledge projections fail atomically without losing local Markdown or Outbox", async () => {
  const f = await fixture();
  try {
    const prepared = await f.prepare();
    expect(prepared).not.toBeNull();
    const before = await f.store.metadata.exportWorkspace!(f.own.workspaceId);
    await expect(
      f.store.pendingWorkRebase.commit({
        ...prepared!,
        projections: prepared!.projections!.slice(1),
      }),
    ).rejects.toThrow("INVALID_WRITE");
    expect(await f.store.metadata.exportWorkspace!(f.own.workspaceId)).toEqual(
      before,
    );
  } finally {
    f.store.close();
  }
});

test("a changed knowledge projection prevents every part of the rebase from committing", async () => {
  const f = await fixture();
  try {
    const prepared = await f.prepare();
    expect(prepared).not.toBeNull();
    const before = await f.store.metadata.exportWorkspace!(f.own.workspaceId);
    const projections = prepared!.projections!.map((record) =>
      record.entity.collection === "$local.librarySearch"
        ? {
            expectedVersion: (record.expectedVersion ?? 0) + 1,
            entity: { ...record.entity, version: record.entity.version + 1 },
          }
        : record,
    );
    await expect(
      f.store.pendingWorkRebase.commit({ ...prepared!, projections }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(await f.store.metadata.exportWorkspace!(f.own.workspaceId)).toEqual(
      before,
    );
  } finally {
    f.store.close();
  }
});

test("reviewing an earlier Markdown conflict leaves the later body and command byte-identical", async () => {
  const f = await fixture(true);
  const archive = await f.store.metadata.exportWorkspace!(f.own.workspaceId);
  f.store.close();
  const first = archive.mutations[0]!,
    followerId = randomUUID();
  const latest = {
    ...f.payload,
    version: 3,
    bodyMd: "later local body\n[[Wiki]]",
  };
  const follower: LocalMutation = {
    ...first,
    id: followerId,
    commandId: followerId,
    state: "PENDING",
    attemptCount: 0,
    lastAttemptAt: null,
    baseVersion: 2,
    basePayload: first.payload,
    payload: localDto(latest),
    order: { transactionVersion: 2, operationIndex: 0 },
  };
  const store = await IndexedDbLocalStore.open(randomUUID(), new IDBFactory());
  try {
    await store.metadata.restoreEmptyWorkspace!(
      {
        ...archive,
        mutations: [first, follower],
        entities: [
          ...archive.entities.map((entity) =>
            entity.collection === "library"
              ? { ...entity, version: 3, value: localDto(bodyManifest(latest)) }
              : entity.collection === "$local.libraryBody"
                ? {
                    ...entity,
                    version: 2,
                    value: { noteVersion: 3, bodyMd: latest.bodyMd },
                  }
                : entity,
          ),
          {
            workspaceId: f.own.workspaceId,
            collection: "$local.command",
            id: followerId,
            version: 1,
            value: localDto({
              schemaVersion: 1,
              id: followerId,
              workspaceId: f.own.workspaceId,
              principalId: f.own.principalId,
              name: "library.save",
              mutationIds: [followerId],
              input: {
                id: "doc",
                version: 2,
                create: false,
                input: {
                  title: latest.title,
                  kind: latest.kind,
                  spaceId: latest.spaceId,
                  parentDocumentId: latest.parentDocumentId,
                  aliases: [],
                  bodyMd: latest.bodyMd,
                },
              },
            }),
          },
        ],
      },
      f.own.deviceId,
    );
    const captured = (
      await listLocalWorkConflictReviews(
        f.actor,
        f.binding,
        store.metadata,
        store.outbox,
      )
    )[0]!;
    expect(captured.followers).toEqual([follower]);
    const pending = await store.outbox.list(f.own.workspaceId);
    const firstPlan = (
      await planLocalCommands(f.actor, store.metadata, pending)
    )[0]!;
    const prepared = await prepareLocalPendingWorkRebase(
      f.actor,
      f.binding,
      firstPlan,
      pending,
      store.metadata,
      { next: () => f.nextId },
      { now: () => "2026-10-15T00:00:00Z" },
      { captured, choice: "REMOTE" },
      { extract: () => [], resolve: (links) => [...links] },
    );
    expect(prepared).not.toBeNull();
    const before = await store.metadata.exportWorkspace!(f.own.workspaceId);
    const corrupt = structuredClone(prepared!);
    corrupt.followers = [{ ...follower, attemptCount: 1 }];
    await expect(store.pendingWorkRebase.commit(corrupt)).rejects.toThrow(
      "INVALID_WRITE",
    );
    expect(await store.metadata.exportWorkspace!(f.own.workspaceId)).toEqual(
      before,
    );
    await store.pendingWorkRebase.commit(prepared!);
    const after = await store.metadata.exportWorkspace!(f.own.workspaceId);
    for (const record of before.entities.filter(
      (entity) =>
        entity.collection === "library" ||
        entity.collection === "$local.libraryBody",
    ))
      expect(
        after.entities.find(
          (entity) =>
            entity.collection === record.collection && entity.id === record.id,
        ),
      ).toEqual(record);
    expect(after.mutations.find((entry) => entry.id === followerId)).toEqual(
      follower,
    );
    expect(
      (await planLocalCommands(f.actor, store.metadata, after.mutations)).map(
        (plan) => plan.id,
      ),
    ).toEqual([f.nextId, followerId]);
    expect(
      after.mutations.find((entry) => entry.id === f.nextId),
    ).toMatchObject({ payload: { bodyMd: f.remote.bodyMd } });
  } finally {
    store.close();
  }
});
