-- A general FolderLink is a reusable-resource membership. Project and Space
-- folder associations have dedicated tables; reject new generic rows for those
-- target kinds without deleting legacy rows that may exist from old clients.
CREATE TRIGGER folder_link_target_kind_insert
BEFORE INSERT ON folder_link
WHEN NEW.target_kind NOT IN ('NOTE','DOCUMENT','FILE')
BEGIN
  SELECT RAISE(ABORT, 'folder_link_target_kind');
END;
CREATE TRIGGER folder_link_target_kind_update
BEFORE UPDATE OF target_kind ON folder_link
WHEN NEW.target_kind NOT IN ('NOTE','DOCUMENT','FILE')
BEGIN
  SELECT RAISE(ABORT, 'folder_link_target_kind');
END;
