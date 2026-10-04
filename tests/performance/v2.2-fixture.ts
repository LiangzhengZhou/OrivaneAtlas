import type {
  AgentSession,
  LibraryEntry,
} from "../../packages/application/src/index";
import type {
  ActorContext,
  WorkEdge,
  WorkItem,
} from "../../packages/domain/src/index";
import { work } from "../fixtures";

/** Real storage fixture; no runtime switches or mocked application results. */
export function v22PerformanceFixture(actor: ActorContext, today: string) {
  const stamp = `${today}T08:00:00.000Z`;
  const item = (id: string): WorkItem => ({
    ...work(id, actor.workspaceId),
    createdBy: actor.principalId,
    updatedBy: actor.principalId,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const projects = Array.from(
    { length: 150 },
    (_, index): WorkItem => ({
      ...item(`perf-project-${index}`),
      type: "PROJECT",
      title: `Perf project ${String(index).padStart(3, "0")}`,
      lifecycle: "ACTIVE",
      parentProjectId: index < 15 ? null : `perf-project-${index % 15}`,
    }),
  );
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 7);
  const future = tomorrow.toISOString().slice(0, 10);
  const tasks = Array.from(
    { length: 1500 },
    (_, index): WorkItem => ({
      ...item(`perf-task-${index}`),
      title: `Perf task ${String(index).padStart(4, "0")}`,
      projectIds: [projects[index % 150]!.id],
      status: index % 15 === 0 ? "DONE" : "TODO",
      completedAt: index % 15 === 0 ? stamp : null,
      activationState: index % 5 === 0 ? "SCHEDULED" : "ACTIVE",
      activationPolicy: index % 5 === 0 ? "AT_SCHEDULED_TIME" : "MANUAL",
      startDate: index % 5 === 0 ? future : today,
      dueDate: today,
    }),
  );
  const edges: WorkEdge[] = [];
  for (let index = 0; index < tasks.length; index++)
    for (const offset of [1, 2])
      if (index + offset < tasks.length)
        edges.push({
          id: `perf-edge-${index}-${offset}`,
          workspaceId: actor.workspaceId,
          fromId: tasks[index]!.id,
          toId: tasks[index + offset]!.id,
          type: "BLOCKS",
          createdBy: actor.principalId,
          createdAt: stamp,
        });
  for (let index = 0; index < 3; index++)
    edges.push({
      id: `perf-edge-boundary-${index}`,
      workspaceId: actor.workspaceId,
      fromId: tasks[index]!.id,
      toId: tasks[1499 - index]!.id,
      type: "BLOCKS",
      createdBy: actor.principalId,
      createdAt: stamp,
    });
  const common = {
    workspaceId: actor.workspaceId,
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    createdBy: actor.principalId,
    updatedBy: actor.principalId,
    deletedAt: null,
    provenance: "HUMAN" as const,
  };
  const space: LibraryEntry = {
    ...common,
    id: "perf-space",
    kind: "SPACE",
    spaceId: null,
    title: "Performance knowledge",
    bodyMd: "",
  };
  const documents = Array.from({ length: 2000 }, (_, index): LibraryEntry => {
    const links = Array.from(
      { length: index < 1000 ? 3 : 2 },
      (_, offset) =>
        `[[Perf document ${String((index + offset + 1) % 2000).padStart(4, "0")}]]`,
    ).join("\n");
    const prefix = `# Perf document ${index}\nFirst line\nSecond line\n${links}\n`;
    const target =
      index === 0 ? 50 * 1024 : index === 1 ? 100 * 1024 : prefix.length;
    return {
      ...common,
      id: `perf-document-${index}`,
      kind: "DOCUMENT",
      spaceId: space.id,
      title: `Perf document ${String(index).padStart(4, "0")}`,
      bodyMd: (
        prefix +
        "Markdown paragraph with **emphasis** and a useful sentence.\n".repeat(
          Math.ceil(target / 55),
        )
      ).slice(0, target),
    };
  });
  const sessions = Array.from(
    { length: 100 },
    (_, index): AgentSession => ({
      id: `perf-session-${index}`,
      workspaceId: actor.workspaceId,
      createdBy: actor.principalId,
      version: 1,
      title: `Perf conversation ${String(index).padStart(3, "0")}`,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
      archivedAt: null,
      projectId: projects[index % 150]!.id,
      spaceId: space.id,
      messages: Array.from({ length: 1000 }, (_, ordinal) => ({
        id: `perf-message-${index}-${ordinal}`,
        kind: ordinal % 2 === 0 ? "USER" : "ASSISTANT",
        text: `Conversation ${index}, message ${ordinal}.\nA preserved Markdown message with **emphasis**.`,
        runId: null,
        createdAt: stamp,
      })),
    }),
  );
  return { projects, tasks, edges, space, documents, sessions };
}
