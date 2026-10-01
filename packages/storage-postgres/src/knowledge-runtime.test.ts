import { expect, it } from "vitest";
import {
  knowledgeRuntimeRoundTrip,
  knowledgeRuntimeScenario,
} from "../../../tests/contracts/knowledge-runtime";
import { context, postgresHarness } from "./testing";

const harness = postgresHarness();
it("runs the shared knowledge application scenario on PostgreSQL", async () => {
  const db = await harness.create();
  const state = await db.knowledge(context, knowledgeRuntimeScenario);
  await db.knowledge(context, async (_uow, library, _projects, sessions) =>
    knowledgeRuntimeRoundTrip(library, sessions, state),
  );
  await db.knowledge(
    { ...context, workspaceId: "workspace-b" },
    async (_uow, library, projects, sessions) => {
      expect(await library.list()).toEqual([]);
      expect(await projects.list()).toEqual([]);
      expect(await sessions.list()).toEqual([]);
      await expect(library.get(state.rootId)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(sessions.get(state.sessionId!)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    },
  );
}, 30000);
