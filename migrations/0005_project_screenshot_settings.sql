-- Per-project screenshot storage flags (replaces global settings keys).
ALTER TABLE projects ADD COLUMN store_fullpage_screenshots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN store_timing_screenshots INTEGER NOT NULL DEFAULT 0;

UPDATE projects
SET store_fullpage_screenshots = 1
WHERE EXISTS (
  SELECT 1 FROM settings
  WHERE key = 'store_screenshots'
    AND lower(trim(value)) IN ('1', 'true', 'yes')
);

UPDATE projects
SET store_timing_screenshots = 1
WHERE EXISTS (
  SELECT 1 FROM settings
  WHERE key = 'store_timing_screenshots'
    AND lower(trim(value)) IN ('1', 'true', 'yes')
);

DELETE FROM settings WHERE key IN ('store_screenshots', 'store_timing_screenshots');
