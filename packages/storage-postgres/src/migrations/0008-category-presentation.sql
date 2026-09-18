ALTER TABLE arclattice.project_category ADD COLUMN icon TEXT NOT NULL DEFAULT '' CHECK(length(icon)<=16);
ALTER TABLE arclattice.project_category ADD COLUMN color TEXT NOT NULL DEFAULT '#7863c5' CHECK(color ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE arclattice.project_category ADD COLUMN position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0);
