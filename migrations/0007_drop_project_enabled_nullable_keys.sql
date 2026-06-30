-- Remove projects.enabled; empty keys disable public trigger / share (cron empty = no schedule).
--
-- D1 runs migrations inside a transaction; PRAGMA foreign_keys=OFF is ignored there.
-- DROP TABLE projects would CASCADE-delete urls, runs, project_users, and annotations.
-- Safe pattern: copy child rows to temp tables, drop in dependency order, rebuild, restore.

CREATE TABLE _m0007_projects AS SELECT * FROM projects;
CREATE TABLE _m0007_urls AS SELECT * FROM urls;
CREATE TABLE _m0007_project_users AS SELECT * FROM project_users;
CREATE TABLE _m0007_runs AS SELECT * FROM runs;
CREATE TABLE _m0007_annotations AS SELECT * FROM annotations;

DROP TABLE runs;
DROP TABLE urls;
DROP TABLE project_users;
DROP TABLE annotations;
DROP TABLE projects;

CREATE TABLE projects (
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

INSERT INTO projects (
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
FROM _m0007_projects;

CREATE TABLE urls (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO urls SELECT * FROM _m0007_urls;

CREATE TABLE project_users (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO project_users SELECT * FROM _m0007_project_users;

CREATE TABLE annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  annotated_at TEXT NOT NULL,
  label TEXT NOT NULL,
  link TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO annotations SELECT * FROM _m0007_annotations;

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  url_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  run_at TEXT NOT NULL,
  performance REAL,
  lcp_ms REAL,
  cls REAL,
  fcp_ms REAL,
  tbt_ms REAL,
  speed_index REAL,
  report_key TEXT NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'manual' CHECK(trigger_source IN ('cron', 'manual')),
  report_bytes INTEGER,
  has_fullpage_screenshots INTEGER NOT NULL DEFAULT 0,
  has_timing_screenshots INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
);

INSERT INTO runs SELECT * FROM _m0007_runs;

CREATE INDEX IF NOT EXISTS idx_urls_project ON urls(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_project_url ON runs(project_id, url_id, strategy, run_at);
CREATE INDEX IF NOT EXISTS idx_annotations_project ON annotations(project_id, annotated_at);

DROP TABLE _m0007_projects;
DROP TABLE _m0007_urls;
DROP TABLE _m0007_project_users;
DROP TABLE _m0007_runs;
DROP TABLE _m0007_annotations;
