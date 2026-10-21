import type {
  AgentRun,
  ConnectedStore,
  EntityRef,
  KnowledgeLink,
} from "./connected";
import { requireCanonicalFile } from "./local-canonical-file";
import { localObject } from "./local-dto";
import type { LocalMutationTransaction } from "./local-mutation-transaction";
import type { LocalRecordRepository } from "./local-record-repository";

export class LocalConnectedStore implements ConnectedStore {
  constructor(
    private readonly records: LocalRecordRepository,
    private readonly stage: LocalMutationTransaction,
  ) {}
  links() {
    return this.records.list<KnowledgeLink>("links");
  }
  saveLink(value: KnowledgeLink, expected: number) {
    return this.records.save(
      "links",
      value.id,
      value,
      expected,
      "LINK_CHANGED",
    );
  }
  runs() {
    return this.records.list<AgentRun>("runs");
  }
  getRun(id: string) {
    return this.records.get<AgentRun>("runs", id);
  }
  saveRun(value: AgentRun, expected: number) {
    return this.records.save(
      "runs",
      value.id,
      value,
      expected,
      "AGENT_RUN_CHANGED",
    );
  }
  async exists(ref: EntityRef): Promise<boolean> {
    const collection =
      ref.kind === "WORK"
        ? "items"
        : ref.kind === "NOTE"
          ? "notes"
          : ref.kind === "FILE"
            ? "files"
            : "library";
    const entity = await this.stage.get(collection, ref.id);
    if (!entity) return false;
    const value = localObject(entity.value);
    if (value.localTombstone === true || value.deletedAt !== null) return false;
    if (ref.kind === "FILE")
      requireCanonicalFile(
        entity.value,
        ref.id,
        entity.workspaceId,
        entity.version,
      );
    if (
      (ref.kind === "SPACE" && value.kind !== "SPACE") ||
      (ref.kind === "DOCUMENT" && value.kind !== "DOCUMENT")
    )
      return false;
    if (
      (ref.kind === "DOCUMENT" || ref.kind === "FILE") &&
      typeof value.spaceId === "string"
    ) {
      const space = await this.stage.get("library", value.spaceId);
      if (!space) return false;
      const parent = localObject(space.value);
      if (parent.kind !== "SPACE" || parent.deletedAt !== null) return false;
    }
    if (ref.kind === "FILE" && typeof value.parentDocumentId === "string") {
      return this.exists({ kind: "DOCUMENT", id: value.parentDocumentId });
    }
    return true;
  }
}
