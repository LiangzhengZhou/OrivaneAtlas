import { DomainError } from "@arclattice/domain";
import { localObject } from "./local-dto";
import type { LocalMutationTransaction } from "./local-mutation-transaction";
import type { LocalRecordRepository } from "./local-record-repository";
import { requireLegacyProjectOriginalLifecycle } from "./project-knowledge-replay-effects";
import type {
  ProjectActivity,
  ProjectMaterial,
  ProjectStore,
} from "./project-materials";

/** Existing Space/Document bindings; first-class Files have a separate model. */
export class LocalProjectStore implements ProjectStore {
  constructor(
    private readonly records: LocalRecordRepository,
    private readonly stage: LocalMutationTransaction,
  ) {}
  list() {
    return this.records.list<ProjectMaterial>("projectMaterials");
  }
  get(id: string) {
    return this.records.get<ProjectMaterial>("projectMaterials", id);
  }
  async save(value: ProjectMaterial, expected: number, base64?: string) {
    if (base64 !== undefined || (value.kind === "FILE" && expected < 1))
      throw new DomainError("VALIDATION_ERROR", {
        reason: "FIRST_CLASS_FILE_REQUIRED",
      });
    if (value.kind === "FILE")
      requireLegacyProjectOriginalLifecycle(
        await this.get(value.id),
        value,
        expected,
      );
    return this.records.save(
      "projectMaterials",
      value.id,
      value,
      expected,
      "PROJECT_MATERIAL_CHANGED",
    );
  }
  async file(_id: string): Promise<string> {
    throw new DomainError("VALIDATION_ERROR", {
      reason: "FIRST_CLASS_FILE_REQUIRED",
    });
  }
  async activity(projectId: string): Promise<ProjectActivity[]> {
    const materials = new Map(
      (await this.list())
        .filter((value) => value.projectId === projectId)
        .map((value) => [value.id, value]),
    );
    return (await this.stage.list("$local.projectMaterialsActivity"))
      .map((entity) => ({ id: entity.id, value: localObject(entity.value) }))
      .filter(
        ({ value }) =>
          typeof value.entityId === "string" && materials.has(value.entityId),
      )
      .map(({ id, value }) => {
        if (
          typeof value.entityId !== "string" ||
          typeof value.principalId !== "string" ||
          typeof value.type !== "string" ||
          typeof value.occurredAt !== "string"
        )
          throw new Error("LOCAL_DATA_CORRUPT");
        return {
          id,
          projectId,
          materialId: value.entityId,
          principalId: value.principalId,
          type: value.type,
          occurredAt: value.occurredAt,
        };
      });
  }
}
