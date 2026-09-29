-- Agentic Browsing category score from Lighthouse 13.5+ (0–100, same scale as performance).
-- NULL for older runs that predate this category.
ALTER TABLE runs ADD COLUMN agentic_browsing REAL;
