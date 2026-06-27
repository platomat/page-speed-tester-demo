-- store_timing_screenshots: optional filmstrip frames in Lighthouse JSON (off by default).
INSERT OR IGNORE INTO settings (key, value) VALUES ('store_timing_screenshots', '0');

-- report_bytes: JSON file size in R2 (set on new runs; null for older rows).
ALTER TABLE runs ADD COLUMN report_bytes INTEGER;
