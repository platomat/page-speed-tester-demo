-- Whether stored JSON includes viewport/full-page and/or timing filmstrip screenshots.
ALTER TABLE runs ADD COLUMN has_screenshots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN has_timing_screenshots INTEGER NOT NULL DEFAULT 0;
