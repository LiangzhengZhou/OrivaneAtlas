CREATE TABLE arclattice.manual_order_scope (
  workspace_id TEXT NOT NULL REFERENCES arclattice.workspace(id),
  id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK(version > 0),
  payload JSONB NOT NULL,
  PRIMARY KEY(workspace_id,id)
);
CREATE TRIGGER sync_manual_order AFTER INSERT OR UPDATE OR DELETE
ON arclattice.manual_order_scope FOR EACH ROW
EXECUTE FUNCTION arclattice.record_workspace_change('manualOrders');
