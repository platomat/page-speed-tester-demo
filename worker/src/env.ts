export interface Env {
  DB: D1Database;
  REPORTS: R2Bucket;
  KV: KVNamespace;
  TRIGGER_SECRET: string;
  GH_PAT: string;
  /** Optional fallback when gh_owner / gh_repo are not set in D1 settings. */
  GH_OWNER?: string;
  GH_REPO?: string;
  WORKER_API_SECRET: string;
  SESSION_SECRET: string;
  COOKIE_DOMAIN?: string;
  /** Optional comma-separated dashboard origins for CORS (full URLs). */
  DASHBOARD_ORIGIN?: string;
}

export interface User {
  id: string;
  email: string;
  username: string;
  role: "admin" | "user";
}

export interface Project {
  id: string;
  name: string;
  access_key?: string;
  share_token?: string;
  cron_expression: string;
  enabled: number;
  last_scheduled_at: string | null;
  created_at: string;
}

export interface ProjectUrl {
  id: string;
  project_id: string;
  name: string;
  url: string;
  enabled: number;
}

export interface RunPayload {
  project_id: string;
  url_id: string;
  strategy: string;
  run_at: string;
  performance: number | null;
  lcp_ms: number | null;
  cls: number | null;
  fcp_ms: number | null;
  tbt_ms: number | null;
  speed_index: number | null;
  report_key: string;
  trigger_source?: "cron" | "manual";
}
