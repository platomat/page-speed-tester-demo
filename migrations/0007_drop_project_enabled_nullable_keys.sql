-- Remove projects.enabled; empty keys disable public trigger / share (cron empty = no schedule).
PRAGMA foreign_keys=off;

CREATE TABLE projects_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  access_key TEXT UNIQUE,
  share_token TEXT UNIQUE,
  cron_expression TEXT NOT NULL DEFAULT '',
  last_scheduled_at TEXT,
  created_at TEXT NOT NULL,
  store_fullpage_screenshots INTEGER NOT NULL DEFAULT 0,
  store_timing_screenshots INTEGER NOT NULL DEFAULT 0,
  lh_warmup INTEGER NOT NULL DEFAULT 0
);

INSERT INTO projects_new (
  id, name, access_key, share_token, cron_expression, last_scheduled_at, created_at,
  store_fullpage_screenshots, store_timing_screenshots, lh_warmup
)
SELECT
  id,
  name,
  CASE WHEN enabled = 1 THEN access_key ELSE NULL END,
  CASE WHEN enabled = 1 THEN share_token ELSE NULL END,
  CASE WHEN enabled = 1 THEN cron_expression ELSE '' END,
  last_scheduled_at,
  created_at,
  store_fullpage_screenshots,
  store_timing_screenshots,
  lh_warmup
FROM projects;

DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;

PRAGMA foreign_keys=on;
