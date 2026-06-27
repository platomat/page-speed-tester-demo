-- Align runs column name with full-page screenshot semantics.
ALTER TABLE runs RENAME COLUMN has_screenshots TO has_fullpage_screenshots;
