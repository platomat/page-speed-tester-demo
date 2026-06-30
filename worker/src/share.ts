import type { Env } from "./env";
import { constantTimeEqual, normalizeAccessKey } from "./access-key";
import { json } from "./http";
import { getTimezone } from "./settings";
import {
  normalizeReportKey,
  resolveReportObject,
} from "./report-storage";
import { listShareAnnotations } from "./annotations";

async function resolveShareProject(
  env: Env,
  projectId: string,
  token: string
): Promise<{ id: string; name: string } | null> {
  const project = await env.DB.prepare(
    `SELECT id, name, share_token FROM projects WHERE id = ?`
  )
    .bind(projectId)
    .first<{ id: string; name: string; share_token: string | null }>();

  if (!project?.share_token || !constantTimeEqual(project.share_token, token)) {
    return null;
  }
  return { id: project.id, name: project.name };
}

function looksLikeReportKey(value: string): boolean {
  return value.startsWith("reports/");
}

/** Share token from query string — never treat report_key / report page `key` as the token. */
function shareKeyFromRequest(request: Request): string | null {
  const params = new URL(request.url).searchParams;
  const shareKey = params.get("share_key")?.trim();
  if (shareKey) return shareKey;

  const share = params.get("share")?.trim();
  if (share) return share;

  const key = params.get("key")?.trim();
  if (!key || looksLikeReportKey(key)) return null;

  const reportKey = params.get("report_key")?.trim();
  if (reportKey && key === reportKey) return null;

  return key;
}

export async function publicShareProject(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const token = shareKeyFromRequest(request);
  if (!token) {
    return json(request, env, { error: "key query parameter required" }, 400);
  }

  const project = await resolveShareProject(env, projectId, token);
  if (!project) {
    return json(request, env, { error: "Invalid project or share key" }, 403);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, name, url FROM urls WHERE project_id = ? AND enabled = 1 ORDER BY name`
  )
    .bind(projectId)
    .all<{ id: string; name: string; url: string }>();

  const timezone = await getTimezone(env);

  return json(request, env, {
    project,
    urls: results ?? [],
    timezone,
  });
}

export async function publicShareMetrics(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const url = new URL(request.url);
  const token = shareKeyFromRequest(request);
  const urlId = url.searchParams.get("url_id")?.trim();
  const strategy = url.searchParams.get("strategy") ?? "desktop";

  if (!token) {
    return json(request, env, { error: "key query parameter required" }, 400);
  }
  if (!urlId) {
    return json(request, env, { error: "url_id required" }, 400);
  }

  const project = await resolveShareProject(env, projectId, token);
  if (!project) {
    return json(request, env, { error: "Invalid project or share key" }, 403);
  }

  const urlRow = await env.DB.prepare(
    `SELECT id FROM urls WHERE project_id = ? AND id = ? AND enabled = 1`
  )
    .bind(projectId, urlId)
    .first();
  if (!urlRow) {
    return json(request, env, { error: "URL not found" }, 404);
  }

  const { results } = await env.DB.prepare(
    `SELECT r.id, r.project_id, r.url_id, u.name AS url_name, u.url, r.strategy, r.run_at,
            r.performance, r.lcp_ms, r.cls, r.fcp_ms, r.tbt_ms, r.speed_index, r.report_key
     FROM runs r
     JOIN urls u ON u.id = r.url_id
     WHERE r.project_id = ? AND r.url_id = ? AND r.strategy = ?
     ORDER BY r.run_at ASC`
  )
    .bind(projectId, urlId, strategy)
    .all();

  return json(request, env, { project_id: projectId, url_id: urlId, strategy, runs: results ?? [] });
}

export async function publicShareAnnotations(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const token = shareKeyFromRequest(request);
  if (!token) {
    return json(request, env, { error: "key query parameter required" }, 400);
  }
  const project = await resolveShareProject(env, projectId, token);
  if (!project) {
    return json(request, env, { error: "Invalid project or share key" }, 403);
  }
  const annotations = await listShareAnnotations(env, projectId);
  return json(request, env, { project_id: projectId, annotations });
}

export async function publicShareReports(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const url = new URL(request.url);
  const token = shareKeyFromRequest(request);
  const urlId = url.searchParams.get("url_id")?.trim();

  if (!token) {
    return json(request, env, { error: "key query parameter required" }, 400);
  }
  if (!urlId) {
    return json(request, env, { error: "url_id required" }, 400);
  }

  const project = await resolveShareProject(env, projectId, token);
  if (!project) {
    return json(request, env, { error: "Invalid project or share key" }, 403);
  }

  const urlRow = await env.DB.prepare(
    `SELECT id FROM urls WHERE project_id = ? AND id = ? AND enabled = 1`
  )
    .bind(projectId, urlId)
    .first();
  if (!urlRow) {
    return json(request, env, { error: "URL not found" }, 404);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, project_id, url_id, strategy, run_at, report_key, performance, trigger_source,
            report_bytes, has_fullpage_screenshots, has_timing_screenshots
     FROM runs WHERE project_id = ? AND url_id = ?
     ORDER BY run_at DESC LIMIT 50`
  )
    .bind(projectId, urlId)
    .all();

  return json(request, env, { project_id: projectId, url_id: urlId, reports: results ?? [] });
}

export async function publicShareReportJson(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const token = shareKeyFromRequest(request);
  const reportKey = url.searchParams.get("report_key")?.trim();

  if (!token) {
    return json(request, env, { error: "key query parameter required" }, 400);
  }
  if (!reportKey) {
    return json(request, env, { error: "report_key required" }, 400);
  }

  const sub = reportKey.match(/^reports\/([^/]+)\/(.+)$/);
  if (!sub) {
    return json(request, env, { error: "Invalid report key" }, 400);
  }

  const projectId = sub[1];
  const normalized = normalizeReportKey(reportKey);
  const project = await resolveShareProject(env, projectId, token);
  if (!project) {
    return json(request, env, { error: "Invalid project or share key" }, 403);
  }

  const resolved = await resolveReportObject(env, normalized, projectId);
  if (!resolved) {
    return json(request, env, { error: "Report not found", report_key: normalized }, 404);
  }

  const body = await resolved.object.text();
  const lighthouse = JSON.parse(body) as Record<string, unknown>;
  const run = await env.DB.prepare(
    `SELECT project_id, url_id, strategy, report_key, run_at
     FROM runs WHERE report_key = ? OR report_key = ?`
  )
    .bind(normalized, resolved.key)
    .first<{
      project_id: string;
      url_id: string;
      strategy: string;
      report_key: string;
      run_at: string;
    }>();

  const timezone = await getTimezone(env);

  return json(request, env, { lighthouse, run: run ?? null, timezone });
}

export function normalizeShareToken(value: string): string | null {
  return normalizeAccessKey(value);
}
