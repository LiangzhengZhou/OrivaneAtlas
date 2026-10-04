export interface WorkspaceChange {
  seq: number;
  workspaceId: string;
  collection: string;
  entityId: string;
  op: "UPSERT" | "DELETE";
  version: number;
}
export interface WorkspaceChangePage {
  epoch: string;
  cursor: number;
  changes: WorkspaceChange[];
  recovery: boolean;
  hasMore: boolean;
}
