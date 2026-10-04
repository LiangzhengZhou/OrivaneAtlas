import { randomUUID } from "node:crypto";
import {
  AgentSessionService,
  type AgentSessionStore,
  ReminderService,
  type UnitOfWork,
  WorkflowService,
  WorkService,
} from "../../packages/application/src/index";
import type { ActorContext } from "../../packages/domain/src/index";

const auth = { require: async () => {} };
const clock = { now: () => "2026-10-04T12:00:00.000Z" };
const ids = { next: randomUUID };

export async function seedV22Backup(
  actor: ActorContext,
  uow: UnitOfWork,
  sessions: AgentSessionStore,
) {
  const work = new WorkService(uow, auth, clock, ids);
  const project = await work.create(actor, {
    type: "PROJECT",
    title: "Backup project",
  });
  const task = await work.create(actor, {
    title: "Linked task",
    projectIds: [project.id],
    descriptionMd: "First\nSecond\n[[Original]]",
  });
  await new ReminderService(uow, auth, clock, ids).save(actor, null, 0, {
    title: "Backup reminder",
    bodyMd: "First\nSecond",
    day: "2026-10-05",
    time: "09:30",
    timezone: "Asia/Shanghai",
    notifyMode: "MINUTES_BEFORE",
    notifyOffsetMinutes: 15,
    linkedProjectId: project.id,
    linkedTaskId: task.id,
    state: "ACTIVE",
  });
  const workflow = new WorkflowService(uow, auth, clock, ids);
  const definition = await workflow.saveRecurrence(actor, {
    version: 0,
    deleted: false,
    rule: {
      title: "Backup series",
      descriptionMd: "Original",
      frequency: "DAILY",
      interval: 1,
      startDate: "2026-10-04",
      timezone: "UTC",
      closeIncomplete: true,
    },
  });
  await workflow.tick(actor, definition.id);
  const occurrence = (await workflow.list(actor)).find(
    (entry) =>
      entry.payload.kind === "OCCURRENCE" && entry.payload.status === "OPEN",
  );
  if (!occurrence) throw new Error("Missing backup occurrence");
  await workflow.skipOccurrence(actor, occurrence.id, occurrence.version);
  const api = new AgentSessionService(sessions, auth, clock, ids);
  const session = await api.create(actor, "Backup conversation");
  await sessions.save(
    {
      ...session,
      version: 2,
      projectId: project.id,
      archivedAt: clock.now(),
      messages: Array.from({ length: 120 }, (_, index) => ({
        id: randomUUID(),
        kind: "USER" as const,
        text: `Original message ${index}`,
        runId: null,
        createdAt: clock.now(),
      })),
    },
    1,
  );
  return readV22Backup(actor, uow, sessions);
}

export async function readV22Backup(
  actor: ActorContext,
  uow: UnitOfWork,
  sessions: AgentSessionStore,
) {
  const entities = await uow.run(actor.workspaceId, async (tx) => ({
    items: await tx.list(true),
    reminders: await tx.reminders(),
    workflows: await tx.workflows(),
    changes: await tx.workspaceChanges(0),
  }));
  const summaries = await sessions.summaries();
  const messages = await sessions.page(summaries[0]!.id, null, 50);
  return { ...entities, summaries, messages };
}
