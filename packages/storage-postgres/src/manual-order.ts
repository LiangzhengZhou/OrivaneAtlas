import type { WorkTransaction } from "@arclattice/application";
import { DomainError, type ManualOrderState } from "@arclattice/domain";
import type { PoolClient } from "pg";

export function manualOrderPort(
  client: PoolClient,
  workspaceId: string,
  schedule: <T>(operation: () => Promise<T>) => Promise<T>,
): Pick<WorkTransaction, "manualOrders" | "saveManualOrder"> {
  return {
    manualOrders: () =>
      schedule(async () =>
        (
          await client.query(
            "SELECT payload FROM arclattice.manual_order_scope WHERE workspace_id=$1 ORDER BY id",
            [workspaceId],
          )
        ).rows.map((row) => row.payload as ManualOrderState),
      ),
    saveManualOrder: (value, expected) => {
      const state = structuredClone(value);
      return schedule(async () => {
        if (state.workspaceId !== workspaceId)
          throw new DomainError("FORBIDDEN");
        if (state.version !== expected + 1)
          throw new DomainError("VERSION_CONFLICT");
        const payload = JSON.stringify(state);
        const result =
          expected === 0
            ? await client.query(
                "INSERT INTO arclattice.manual_order_scope(workspace_id,id,version,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING",
                [workspaceId, state.id, state.version, payload],
              )
            : await client.query(
                "UPDATE arclattice.manual_order_scope SET version=$1,payload=$2::jsonb WHERE workspace_id=$3 AND id=$4 AND version=$5",
                [state.version, payload, workspaceId, state.id, expected],
              );
        if (result.rowCount !== 1) throw new DomainError("VERSION_CONFLICT");
      });
    },
  };
}
