-- A general FolderLink is a reusable-resource membership. Project and Space
-- folder associations have dedicated tables; reject new generic rows for those
-- target kinds without deleting legacy rows that may exist from old clients.
CREATE FUNCTION arclattice.guard_folder_link_target_kind() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_kind NOT IN ('NOTE','DOCUMENT','FILE') THEN
    RAISE EXCEPTION 'folder_link_target_kind' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER folder_link_target_kind_guard
BEFORE INSERT OR UPDATE OF target_kind ON arclattice.folder_link
FOR EACH ROW EXECUTE FUNCTION arclattice.guard_folder_link_target_kind();
