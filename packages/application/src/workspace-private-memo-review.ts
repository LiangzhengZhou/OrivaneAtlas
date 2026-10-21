import {
  type ActorContext,
  DomainError,
  requireEntityMemoOwner,
  requireEntityMemoRecord,
} from "@arclattice/domain";
import type { EntityMemoIdentity } from "./entity-memos";
import { localDto, localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import type { LocalEntity } from "./local-persistence";

/** Explicit import review only. Ordinary bootstrap remains metadata-only.
 * The caller must pin account/service scope and recheck the workspace cursor
 * after this read, before exposing or applying any review decision. */
export async function readWorkspacePrivateMemoReview(
  actorInput: ActorContext,
  revision: { epoch: string; cursor: number },
  readPage: (after: number) => Promise<unknown>,
  identity: Pick<EntityMemoIdentity, "forTarget">,
): Promise<LocalEntity[]> {
  const actor = { ...actorInput },
    expected = { ...revision };
  function invalid(): never {
    throw new DomainError("VALIDATION_ERROR", { field: "privateMemoReview" });
  }
  if (
    !actor.workspaceId ||
    !actor.principalId ||
    !expected.epoch ||
    !Number.isSafeInteger(expected.cursor) ||
    expected.cursor < 0
  )
    invalid();
  const result = new Map<string, LocalEntity>();
  let after = 0;
  for (;;) {
    const page = localObject(localDto(await readPage(after)));
    if (
      page.recovery !== false ||
      page.epoch !== expected.epoch ||
      (page.cursor !== expected.cursor &&
        (typeof page.cursor !== "number" || page.cursor > expected.cursor))
    )
      throw new DomainError("VERSION_CONFLICT");
    if (
      page.snapshot !== null ||
      typeof page.cursor !== "number" ||
      !Number.isSafeInteger(page.cursor) ||
      page.cursor < after ||
      typeof page.hasMore !== "boolean" ||
      !Array.isArray(page.records) ||
      page.records.length > 2000
    )
      invalid();
    const changes = localObject(page.changes!),
      collections = localObject(changes.collections!);
    if (
      Object.keys(localObject(changes.values!)).length ||
      Object.keys(collections).some((key) => key !== "entityMemos")
    )
      invalid();
    const logged = new Map<string, { op: string; version: number }>();
    let seq = after;
    for (const raw of page.records) {
      const record = localObject(raw);
      if (
        record.collection !== "entityMemos" ||
        record.workspaceId !== actor.workspaceId ||
        typeof record.seq !== "number" ||
        !Number.isSafeInteger(record.seq) ||
        record.seq <= seq ||
        record.seq > page.cursor ||
        typeof record.entityId !== "string" ||
        !record.entityId ||
        typeof record.version !== "number" ||
        !Number.isSafeInteger(record.version) ||
        record.version < 1 ||
        !["UPSERT", "DELETE"].includes(String(record.op))
      )
        invalid();
      seq = record.seq;
      logged.set(record.entityId, {
        op: String(record.op),
        version: record.version,
      });
    }
    const delta =
      collections.entityMemos === undefined
        ? { upserts: [], removed: [] }
        : localObject(collections.entityMemos);
    if (!Array.isArray(delta.upserts) || !Array.isArray(delta.removed))
      invalid();
    const seen = new Set<string>();
    for (const raw of delta.upserts) {
      const memo = requireEntityMemoRecord(raw);
      requireEntityMemoOwner(actor, memo);
      const log = logged.get(memo.id);
      if (
        seen.has(memo.id) ||
        !log ||
        log.op !== "UPSERT" ||
        memo.version < log.version ||
        memo.id !== (await identity.forTarget(actor, memo))
      )
        invalid();
      const previous = result.get(memo.id);
      if (
        previous &&
        (memo.version < previous.version ||
          (memo.version === previous.version &&
            !equalLocalJson(localDto(memo), previous.value)))
      )
        throw new DomainError("VERSION_CONFLICT");
      seen.add(memo.id);
      result.set(memo.id, {
        workspaceId: actor.workspaceId,
        collection: "entityMemos",
        id: memo.id,
        version: memo.version,
        value: localDto(memo),
      });
    }
    for (const id of delta.removed) {
      if (
        typeof id !== "string" ||
        seen.has(id) ||
        logged.get(id)?.op !== "DELETE"
      )
        invalid();
      seen.add(id);
      result.delete(id);
    }
    if (seen.size !== logged.size) invalid();
    if (page.hasMore && page.cursor === after) invalid();
    after = page.cursor;
    if (!page.hasMore) {
      if (after !== expected.cursor) throw new DomainError("VERSION_CONFLICT");
      return [...result.values()];
    }
  }
}
