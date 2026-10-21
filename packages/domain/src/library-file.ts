import type { ProcessingData } from "./data-policy";
import { DomainError } from "./index";

export type FileContentPolicy = Pick<
  ProcessingData,
  "classification" | "processingBoundary" | "aiAccess"
>;
export type FileProvenance =
  | "HUMAN"
  | "EXTERNAL_AI"
  | "ATLAS_DERIVED"
  | "IMPORT";
export type FileExtractionStatus =
  | "NOT_APPLICABLE"
  | "PENDING"
  | "READY"
  | "FAILED";
export type FileIndexStatus = "PENDING" | "READY" | "FAILED";

/** Original binary identity is independent of Markdown or Project materials. */
export interface LibraryFile {
  readonly id: string;
  readonly workspaceId: string;
  readonly spaceId: string | null;
  readonly parentDocumentId: string | null;
  readonly name: string;
  readonly originalName: string;
  readonly extension: string | null;
  readonly mime: string;
  readonly size: number;
  readonly contentHash: string;
  readonly blobId: string;
  readonly version: number;
  readonly provenance: FileProvenance;
  readonly aiPolicy: FileContentPolicy;
  readonly extractionStatus: FileExtractionStatus;
  readonly indexStatus: FileIndexStatus;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface BlobDescriptor {
  readonly id: string;
  readonly contentHash: string;
  readonly size: number;
  readonly mime: string;
}

export function requireFileName(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value].length > 255 ||
    /[\x00-\x1f\x7f/\\]/.test(value) ||
    value === "." ||
    value === ".."
  )
    throw new DomainError("VALIDATION_ERROR");
  return value;
}

export function fileExtension(name: string): string | null {
  requireFileName(name);
  const dot = name.lastIndexOf(".");
  return dot <= 0 || dot === name.length - 1
    ? null
    : name.slice(dot + 1).toLowerCase();
}

/** Parser selection is a capability hint, never permission or actual extraction. */
export function fileReadTier(
  extension: string | null,
): "TEXT" | "STRUCTURED" | "STORAGE" {
  if (["md", "txt", "csv", "tsv", "json"].includes(extension ?? ""))
    return "TEXT";
  if (["pdf", "docx", "xlsx", "pptx"].includes(extension ?? ""))
    return "STRUCTURED";
  return "STORAGE";
}
