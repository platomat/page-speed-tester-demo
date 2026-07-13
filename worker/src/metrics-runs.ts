import type { Env } from "./env";
import { appendRunAtRange } from "./date-range";

export type MetricStrategy = "desktop" | "mobile" | "both";

export function isMetricStrategy(value: string): value is MetricStrategy {
  return value === "desktop" || value === "mobile" || value === "both";
}

const METRICS_SELECT = `SELECT r.id, r.project_id, r.url_id, u.name AS url_name, u.url, r.strategy, r.run_at,
            r.performance, r.lcp_ms, r.cls, r.fcp_ms, r.tbt_ms, r.speed_index, r.report_key
     FROM runs r
     JOIN urls u ON u.id = r.url_id`;

export async function fetchMetricRuns(
  env: Env,
  projectId: string,
  urlId: string,
  strategy: "desktop" | "mobile",
  range: { from: string | null; to: string | null }
): Promise<unknown[]> {
  const bindings: unknown[] = [projectId, urlId, strategy];
  let sql = `${METRICS_SELECT} WHERE r.project_id = ? AND r.url_id = ? AND r.strategy = ?`;
  sql = appendRunAtRange(sql, range, bindings, "r.run_at");
  sql += ` ORDER BY r.run_at ASC`;

  const { results } = await env.DB.prepare(sql).bind(...bindings).all();
  return results ?? [];
}

export async function fetchMetricsPayload(
  env: Env,
  projectId: string,
  urlId: string,
  strategy: MetricStrategy,
  range: { from: string | null; to: string | null }
): Promise<Record<string, unknown>> {
  if (strategy === "both") {
    const [desktopRuns, mobileRuns] = await Promise.all([
      fetchMetricRuns(env, projectId, urlId, "desktop", range),
      fetchMetricRuns(env, projectId, urlId, "mobile", range),
    ]);
    return {
      project_id: projectId,
      url_id: urlId,
      strategy: "both",
      desktop: { runs: desktopRuns },
      mobile: { runs: mobileRuns },
    };
  }

  const runs = await fetchMetricRuns(env, projectId, urlId, strategy, range);
  return { project_id: projectId, url_id: urlId, strategy, runs };
}
