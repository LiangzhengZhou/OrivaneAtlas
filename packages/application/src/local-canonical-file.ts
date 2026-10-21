import {
  DomainError,
  fileExtension,
  type LibraryFile,
  requireFileName,
} from "@arclattice/domain";
import { contentPolicy } from "./content-policy";
import { localDto, localObject } from "./local-dto";

export function requireCanonicalFile(
  value: unknown,
  id: string,
  workspaceId: string,
  version: number,
): LibraryFile {
  const file = localObject(localDto(value)),
    invalid = (): never => {
      throw new DomainError("VALIDATION_ERROR", { field: "canonicalFile" });
    };
  const fields = [
    "id",
    "workspaceId",
    "spaceId",
    "parentDocumentId",
    "name",
    "originalName",
    "extension",
    "mime",
    "size",
    "contentHash",
    "blobId",
    "version",
    "provenance",
    "aiPolicy",
    "extractionStatus",
    "indexStatus",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt",
    "deletedAt",
  ];
  if (
    Object.keys(file).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(file, key)) ||
    file.id !== id ||
    file.workspaceId !== workspaceId ||
    file.version !== version ||
    !id ||
    id.length > 240 ||
    !workspaceId ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    invalid();
  for (const key of ["createdBy", "updatedBy", "createdAt", "updatedAt"])
    if (typeof file[key] !== "string" || !file[key]) invalid();
  for (const key of ["spaceId", "parentDocumentId"])
    if (
      file[key] !== null &&
      (typeof file[key] !== "string" || !file[key] || file[key].length > 240)
    )
      invalid();
  if (
    (file.parentDocumentId !== null && file.spaceId === null) ||
    typeof file.name !== "string" ||
    typeof file.originalName !== "string" ||
    typeof file.mime !== "string" ||
    file.mime.length > 127 ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(file.mime) ||
    typeof file.size !== "number" ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > 100 * 1024 * 1024 ||
    typeof file.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(file.contentHash) ||
    file.blobId !== file.contentHash ||
    !["HUMAN", "EXTERNAL_AI", "ATLAS_DERIVED", "IMPORT"].some(
      (v) => v === file.provenance,
    ) ||
    !["NOT_APPLICABLE", "PENDING", "READY", "FAILED"].some(
      (v) => v === file.extractionStatus,
    ) ||
    !["PENDING", "READY", "FAILED"].some((v) => v === file.indexStatus) ||
    (file.deletedAt !== null &&
      (typeof file.deletedAt !== "string" ||
        !Number.isFinite(Date.parse(file.deletedAt)))) ||
    !Number.isFinite(Date.parse(String(file.createdAt))) ||
    !Number.isFinite(Date.parse(String(file.updatedAt)))
  )
    invalid();
  requireFileName(file.name as string);
  requireFileName(file.originalName as string);
  if (file.extension !== fileExtension(file.originalName as string)) invalid();
  contentPolicy(file.aiPolicy as unknown as LibraryFile["aiPolicy"]);
  return structuredClone(file) as unknown as LibraryFile;
}
