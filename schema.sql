CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  access_key TEXT NOT NULL UNIQUE,
  share_token TEXT UNIQUE,
  cron_expression TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scheduled_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS urls (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_urls_project ON urls(project_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_users (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', 'Europe/Berlin');
INSERT OR IGNORE INTO settings (key, value) VALUES ('cron_enabled', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('store_screenshots', '0');

CREATE TABLE IF NOT EXISTS runs (
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
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_project_url ON runs(project_id, url_id, strategy, run_at);

-- Existing databases (add column once):
-- ALTER TABLE projects ADD COLUMN share_token TEXT UNIQUE;
-- ALTER TABLE runs ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'manual';
