-- Per-project cache warmup before Lighthouse audits (off by default).
ALTER TABLE projects ADD COLUMN lh_warmup INTEGER NOT NULL DEFAULT 0;
