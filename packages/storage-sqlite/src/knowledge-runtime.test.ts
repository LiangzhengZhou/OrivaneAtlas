import { expect, it } from "vitest";
import {
  knowledgeRuntimeRoundTrip,
  knowledgeRuntimeScenario,
} from "../../../tests/contracts/knowledge-runtime";
import { context, sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("runs the shared knowledge application scenario on SQLite", async () => {
  const db = await harness.create();
  const state = await db.request(
    context,
    null,
    (uow, _notes, _connected, library, _organization, projects, sessions) =>
      knowledgeRuntimeScenario(uow, library, projects, sessions),
  );
  await db.request(
    context,
    null,
    (_uow, _notes, _connected, library, _organization, _projects, sessions) =>
      knowledgeRuntimeRoundTrip(library, sessions, state),
  );
  await db.request(
    { ...context, workspaceId: "workspace-b" },
    null,
    async (
      _uow,
      _notes,
      _connected,
      library,
      _organization,
      projects,
      sessions,
    ) => {
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
});
