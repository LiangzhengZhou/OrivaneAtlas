export type FileExtractionKind = "TEXT" | "PAGE" | "SHEET" | "SLIDE" | "TABLE";

/** Derived text never replaces the immutable original File. */
export interface FileExtraction {
  readonly workspaceId: string;
  readonly fileId: string;
  readonly fileVersion: number;
  readonly contentHash: string;
  readonly indexVersion: number;
  readonly kind: FileExtractionKind;
  readonly locator: string;
  readonly title?: string;
  readonly text: string;
}

export interface FileExtractionDocument {
  readonly workspaceId: string;
  readonly fileId: string;
  readonly fileVersion: number;
  readonly contentHash: string;
  readonly indexVersion: number;
  readonly chunks: readonly FileExtraction[];
}
