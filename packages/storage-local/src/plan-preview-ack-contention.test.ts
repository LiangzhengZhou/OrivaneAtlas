import {
  LocalRuntime,
  LocalWorkspace,
  planLocalCommands,
  prepareLocalWorkReplayAcknowledgement,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each([false, true])(
  "publishes reviewed tasks exactly once when preview ACK arrives during publication=%s",
  async (during) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open("plan-ack-race", factory);
    const second = await IndexedDbLocalStore.open("plan-ack-race", factory);
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
    };
    const binding = {
      workspaceId: identity.workspaceId,
      remoteWorkspaceId: crypto.randomUUID(),
      remotePrincipalId: identity.principalId,
      serverOrigin: "https://example.test",
      epoch: "plan-ack",
      cursor: 0,
      version: 1,
    };
    let acknowledge: (() => Promise<void>) | undefined;
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        {
          ...first.metadata,
          list: async (workspace, collection) => {
            const rows = await first.metadata.list(workspace, collection);
            if (collection === "workflows" && acknowledge) {
              const apply = acknowledge;
              acknowledge = undefined;
              await apply();
            }
            return rows;
          },
        },
        { get: async () => null, put: async () => {} },
        identity,
        { extract: () => [], resolve: () => [] },
        { now: () => "2026-10-24T00:00:00.000Z" },
        { next: () => crypto.randomUUID() },
      ),
    );
    try {
      await first.identity.ensure(identity);
      const preview = await runtime.previewPlan(null, {
        version: 1,
        tasks: [
          {
            tempId: "first",
            title: "First",
            descriptionMd: "原始 **Markdown**",
          },
          { tempId: "next", title: "Next", dependsOn: ["first"] },
        ],
      });
      await second.syncState.save(binding, null);
      const plan = (
        await planLocalCommands(
          runtime.context,
          second.metadata,
          await second.outbox.list(identity.workspaceId),
        )
      ).find((entry) => entry.command?.name === "plan.preview")!;
      const mutations = await second.outbox.transitionMany(
        plan.mutations.map((mutation) => ({
          workspaceId: identity.workspaceId,
          mutationId: mutation.id,
          binding,
          expectedState: "PENDING" as const,
          expectedAttemptCount: 0,
          expectedLastAttemptAt: null,
          nextState: "SENDING" as const,
          at: "2026-10-24T00:00:01.000Z",
        })),
      );
      const canonical = {
        ...preview,
        workspaceId: binding.remoteWorkspaceId,
        createdAt: "2026-10-24T00:00:01.000Z",
        updatedAt: "2026-10-24T00:00:01.000Z",
      };
      acknowledge = async () => {
        const commit = await prepareLocalWorkReplayAcknowledgement(
          runtime.context,
          binding,
          { ...plan, state: "RECEIPT_REQUIRED", mutations },
          {
            commandId: plan.id,
            deviceId: identity.deviceId,
            result: canonical,
            effects: [
              {
                collection: "workflows",
                id: preview.id,
                op: "UPSERT",
                version: 1,
                value: canonical,
              },
            ],
          },
          await second.outbox.list(identity.workspaceId),
          second.metadata,
        );
        await second.replica.commit(commit);
      };
      if (!during) {
        await acknowledge();
        acknowledge = undefined;
      }
      const published = await runtime.publishPlan(preview.id, preview.version);
      expect(published).toMatchObject({
        version: 2,
        createdAt: canonical.createdAt,
        payload: { published: true },
      });
      const snapshot = await runtime.service.snapshot(runtime.context, true);
      expect(snapshot.items.map((item) => item.title).sort()).toEqual([
        "First",
        "Next",
      ]);
      expect(
        snapshot.items.find((item) => item.title === "First")?.descriptionMd,
      ).toBe("原始 **Markdown**");
      expect(snapshot.edges).toHaveLength(1);
      const commands = await planLocalCommands(
        runtime.context,
        second.metadata,
        await second.outbox.list(identity.workspaceId),
      );
      expect(
        commands.filter((entry) => entry.command?.name === "plan.publish"),
      ).toHaveLength(1);
      expect(
        (await second.outbox.list(identity.workspaceId)).find(
          (entry) => entry.id === plan.id,
        )?.state,
      ).toBeUndefined();
      expect(await runtime.publishPlan(preview.id, preview.version)).toEqual(
        published,
      );
      expect(
        (await runtime.service.snapshot(runtime.context, true)).items,
      ).toHaveLength(2);
    } finally {
      first.close();
      second.close();
    }
  },
);
