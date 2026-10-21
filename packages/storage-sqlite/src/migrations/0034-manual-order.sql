CREATE TABLE manual_order_scope (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(workspace_id,id)
);
CREATE TRIGGER sync_manual_order_insert AFTER INSERT ON manual_order_scope BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'manualOrders',NEW.id,'UPSERT',NEW.version);
END;
CREATE TRIGGER sync_manual_order_update AFTER UPDATE ON manual_order_scope BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(NEW.workspace_id,'manualOrders',NEW.id,'UPSERT',NEW.version);
END;
CREATE TRIGGER sync_manual_order_delete AFTER DELETE ON manual_order_scope BEGIN
  INSERT INTO workspace_change(workspace_id,collection,entity_id,op,version)
  VALUES(OLD.workspace_id,'manualOrders',OLD.id,'DELETE',OLD.version);
END;
