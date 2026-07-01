import type { Env } from "./env";
import { normalizeReportKey } from "./report-storage";

const REPORT_RETENTION_DAYS_KEY = "report_retention_days";
const MAX_RETENTION_DAYS = 3650;
const BATCH_SIZE = 100;

export function parseReportRetentionDays(value: string | undefined | null): number {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_RETENTION_DAYS);
}

export async function getReportRetentionDays(env: Env): Promise<number> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind(REPORT_RETENTION_DAYS_KEY)
    .first<{ value: string }>();
  return parseReportRetentionDays(row?.value);
}

/** Delete R2 JSON for runs older than the retention window; keep D1 rows, clear report_bytes. */
export async function purgeExpiredReports(env: Env): Promise<void> {
  const days = await getReportRetentionDays(env);
  if (days <= 0) return;

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, report_key FROM runs
     WHERE run_at < ? AND report_bytes IS NOT NULL
     ORDER BY run_at ASC
     LIMIT ?`
  )
    .bind(cutoff, BATCH_SIZE)
    .all<{ id: number; report_key: string }>();

  for (const run of results ?? []) {
    const key = normalizeReportKey(run.report_key);
    if (!key) continue;
    try {
      await env.REPORTS.delete(key);
    } catch (err) {
      console.error(`Report retention: failed to delete ${key}:`, err);
      continue;
    }
    await env.DB.prepare(`UPDATE runs SET report_bytes = NULL WHERE id = ?`)
      .bind(run.id)
      .run();
  }
}

export { REPORT_RETENTION_DAYS_KEY, MAX_RETENTION_DAYS };
