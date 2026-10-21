import type { DatabaseSync } from "node:sqlite";
import type { WorkTransaction } from "@arclattice/application";
import { DomainError, type ManualOrderState } from "@arclattice/domain";

export function manualOrderPort(
  db: DatabaseSync,
  workspaceId: string,
  guard: () => void,
): Pick<WorkTransaction, "manualOrders" | "saveManualOrder"> {
  return {
    manualOrders: async () => {
      guard();
      return db
        .prepare(
          "SELECT payload FROM manual_order_scope WHERE workspace_id=? ORDER BY id",
        )
        .all(workspaceId)
        .map((row) => JSON.parse(String(row.payload)) as ManualOrderState);
    },
    saveManualOrder: async (state, expected) => {
      guard();
      if (state.workspaceId !== workspaceId) throw new DomainError("FORBIDDEN");
      if (state.version !== expected + 1)
        throw new DomainError("VERSION_CONFLICT");
      const payload = JSON.stringify(state);
      const result =
        expected === 0
          ? db
              .prepare(
                "INSERT INTO manual_order_scope(workspace_id,id,version,payload) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
              )
              .run(workspaceId, state.id, state.version, payload)
          : db
              .prepare(
                "UPDATE manual_order_scope SET version=?,payload=? WHERE workspace_id=? AND id=? AND version=?",
              )
              .run(state.version, payload, workspaceId, state.id, expected);
      if (result.changes !== 1) throw new DomainError("VERSION_CONFLICT");
    },
  };
}
