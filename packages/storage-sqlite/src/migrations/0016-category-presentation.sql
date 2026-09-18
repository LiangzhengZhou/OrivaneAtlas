ALTER TABLE project_category ADD COLUMN icon TEXT NOT NULL DEFAULT '' CHECK(length(icon)<=16);
ALTER TABLE project_category ADD COLUMN color TEXT NOT NULL DEFAULT '#7863c5' CHECK(length(color)=7 AND substr(color,1,1)='#' AND substr(color,2) NOT GLOB '*[^0-9a-fA-F]*');
ALTER TABLE project_category ADD COLUMN position INTEGER NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 2147483647);
