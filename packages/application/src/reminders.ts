import {
  type ActorContext,
  DomainError,
  type Reminder,
  type ReminderInput,
  requireReminder,
} from "@arclattice/domain";
import type {
  AuthorizationService,
  Clock,
  IdGenerator,
  UnitOfWork,
} from "./index";
import { stableEntityIds } from "./stable-entity-ids";

export class ReminderService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  async list(context: ActorContext) {
    await this.authorization.require(context, "work:read");
    return this.uow.run(context.workspaceId, (tx) => tx.reminders());
  }
  /** Caller uses the authenticated business/receipt transaction. */
  async createWithStableId(
    contextInput: ActorContext,
    id: string,
    input: ReminderInput,
    deleted = false,
  ) {
    const context = Object.freeze({ ...contextInput }),
      captured = structuredClone(input);
    await this.authorization.require(
      context,
      deleted ? "work:delete" : "work:update",
    );
    const ids = stableEntityIds(this.ids, "REMINDER", id);
    const uow: UnitOfWork = {
      run: (workspaceId, operation) =>
        this.uow.run(workspaceId, async (tx) => {
          if (workspaceId !== context.workspaceId)
            throw new DomainError("FORBIDDEN");
          if ((await tx.reminders()).some((reminder) => reminder.id === id))
            throw new DomainError("VERSION_CONFLICT");
          return operation(tx);
        }),
    };
    return new ReminderService(uow, this.authorization, this.clock, ids).save(
      context,
      null,
      0,
      captured,
      deleted,
    );
  }
  async save(
    context: ActorContext,
    id: string | null,
    version: number,
    input: ReminderInput,
    deleted = false,
  ): Promise<Reminder> {
    await this.authorization.require(
      context,
      deleted ? "work:delete" : "work:update",
    );
    if (
      !Number.isSafeInteger(version) ||
      version < 0 ||
      (id === null && version !== 0)
    )
      throw new DomainError("VALIDATION_ERROR");
    const value = requireReminder(input);
    return this.uow.run(context.workspaceId, async (tx) => {
      const old = id
        ? (await tx.reminders()).find((entry) => entry.id === id)
        : undefined;
      if (id && !old) throw new DomainError("NOT_FOUND");
      if ((old?.version ?? 0) !== version)
        throw new DomainError("VERSION_CONFLICT");
      for (const [linkedId, type] of [
        [value.linkedProjectId, "PROJECT"],
        [value.linkedTaskId, "TASK"],
      ] as const) {
        if (!linkedId) continue;
        const linked = await tx.get(linkedId);
        if (linked.type !== type || linked.deletedAt)
          throw new DomainError("VALIDATION_ERROR");
      }
      const now = this.clock.now();
      const reminder: Reminder = {
        ...value,
        id: old?.id ?? this.ids.nextFor?.("REMINDER") ?? this.ids.next(),
        workspaceId: context.workspaceId,
        version: version + 1,
        createdAt: old?.createdAt ?? now,
        createdBy: old?.createdBy ?? context.principalId,
        updatedAt: now,
        updatedBy: context.principalId,
        deletedAt: deleted ? now : null,
      };
      await tx.saveReminder(reminder, version);
      return reminder;
    });
  }
}
