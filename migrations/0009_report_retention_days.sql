-- Report JSON retention in R2 (days); 0 = disabled. Runs stay in D1; report_bytes cleared after purge.
INSERT OR IGNORE INTO settings (key, value) VALUES ('report_retention_days', '0');
