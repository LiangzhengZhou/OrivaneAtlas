-- ADR0138: organization.kind gains FOLDER for stable note folders.
ALTER TABLE organization DROP CONSTRAINT IF EXISTS organization_kind_check;
ALTER TABLE organization ADD CONSTRAINT organization_kind_check CHECK(kind IN ('WORK','NOTE','FOLDER'));
