import type { Env, Project, ProjectUrl, RunPayload, User } from "./env";
import { listAccessibleProjectIds, requireProjectAccess } from "./access";
import { constantTimeEqual, generateAccessKey, normalizeAccessKey } from "./access-key";
import { requireAdmin, requireUser } from "./auth";
import { dispatchProject } from "./github";
import { isValidCronExpression, normalizeCronExpression } from "./cron";
import { json } from "./http";
import { normalizeShareToken } from "./share";
import { slugifyId } from "./slug";
import {
  diagnoseReportLookup,
  normalizeReportKey,
  reportKeyParts,
  resolveReportObject,
} from "./report-storage";

const KEY_FORMAT_ERROR = "Key must be 1–64 characters (letters, numbers, _ -)";

function resolveKeyUpdate(
  raw: string | undefined,
  normalize: (value: string) => string | null
): { value: string | null } | { error: string } | undefined {
  if (raw === undefined) return undefined;
  if (raw === "generate") return { value: generateAccessKey() };
  if (raw.trim() === "") return { value: null };
  const value = normalize(raw);
  if (!value) return { error: KEY_FORMAT_ERROR };
  return { value };
}

/** Default bucket name on the REPORTS binding; real value comes from env (see generate-wrangler). */
const DEFAULT_REPORTS_BUCKET_NAME = "page-speed-tester-reports";

function reportsBucketName(env: Env): string {
  return env.REPORTS_BUCKET_NAME?.trim() || DEFAULT_REPORTS_BUCKET_NAME;
}

async function deleteRunObjects(
  env: Env,
  reportKeys: string[]
): Promise<void> {
  await Promise.all(reportKeys.map((key) => env.REPORTS.delete(key)));
}

/** Remove all Lighthouse JSON objects for a project (D1 keys + any orphans under the prefix). */
async function deleteAllProjectReportsFromR2(env: Env, projectId: string): Promise<void> {
  const reportKeys = await reportKeysForProject(env, projectId);
  await deleteRunObjects(env, reportKeys);

  const prefix = `reports/${projectId}/`;
  let cursor: string | undefined;
  do {
    const listing = await env.REPORTS.list({ prefix, limit: 100, cursor });
    await Promise.all(listing.objects.map((obj) => env.REPORTS.delete(obj.key)));
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

async function reportKeysForUrl(
  env: Env,
  projectId: string,
  urlId: string
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT report_key FROM runs WHERE project_id = ? AND url_id = ?`
  )
    .bind(projectId, urlId)
    .all<{ report_key: string }>();
  return (results ?? []).map((r) => r.report_key);
}

async function reportKeysForProject(env: Env, projectId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT report_key FROM runs WHERE project_id = ?`
  )
    .bind(projectId)
    .all<{ report_key: string }>();
  return (results ?? []).map((r) => r.report_key);
}

async function resolveUrlId(
  env: Env,
  projectId: string,
  requestedId: string | undefined,
  name: string,
  url: string
): Promise<{ id: string } | { error: string; status: number }> {
  const manual = requestedId?.trim();
  const base = slugifyId(manual || `${projectId}-${url || name}`);
  if (!base) {
    return { error: "Could not derive a valid URL id", status: 400 };
  }

  if (manual) {
    const existing = await env.DB.prepare(`SELECT project_id FROM urls WHERE id = ?`)
      .bind(base)
      .first<{ project_id: string }>();
    if (existing) {
      return {
        error:
          existing.project_id === projectId
            ? `URL id "${base}" already exists in this project`
            : `URL id "${base}" is already used by another project`,
        status: 409,
      };
    }
    return { id: base };
  }

  let candidate = base;
  for (let n = 2; n < 100; n++) {
    const existing = await env.DB.prepare(`SELECT id FROM urls WHERE id = ?`)
      .bind(candidate)
      .first();
    if (!existing) return { id: candidate };
    candidate = slugifyId(`${base}-${n}`);
  }
  return { error: "Could not allocate a unique URL id", status: 409 };
}

export async function listProjects(
  request: Request,
  env: Env,
  user: User
): Promise<Response> {
  const ids = await listAccessibleProjectIds(env, user);
  if (!ids.length) return json(request, env, { projects: [] });
  const placeholders = ids.map(() => "?").join(",");
  const cols =
    user.role === "admin"
      ? "id, name, access_key, share_token, cron_expression, store_fullpage_screenshots, store_timing_screenshots, lh_warmup, last_scheduled_at, created_at"
      : "id, name, cron_expression, last_scheduled_at, created_at";
  const { results } = await env.DB.prepare(
    `SELECT ${cols} FROM projects WHERE id IN (${placeholders}) ORDER BY name`
  )
    .bind(...ids)
    .all<Project>();

  return json(request, env, { projects: results ?? [] });
}

export async function createProject(
  request: Request,
  env: Env
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const body = (await request.json()) as {
    id?: string;
    name?: string;
    access_key?: string;
    cron_expression?: string;
    store_fullpage_screenshots?: boolean;
    store_timing_screenshots?: boolean;
    lh_warmup?: boolean;
  };
  if (!body.name) return json(request, env, { error: "name required" }, 400);
  const id = slugifyId(body.id ?? body.name);
  const cron = normalizeCronExpression(body.cron_expression);
  if (!isValidCronExpression(cron)) {
    return json(request, env, { error: "cron_expression must have 5 fields or be empty" }, 400);
  }
  const accessKey = body.access_key?.trim() ? normalizeAccessKey(body.access_key) : null;
  if (body.access_key?.trim() && !accessKey) {
    return json(request, env, { error: KEY_FORMAT_ERROR }, 400);
  }
  const storeFullpageScreenshots = body.store_fullpage_screenshots ? 1 : 0;
  const storeTimingScreenshots = body.store_timing_screenshots ? 1 : 0;
  const lhWarmup = body.lh_warmup ? 1 : 0;
  try {
    await env.DB.prepare(
      `INSERT INTO projects (id, name, access_key, share_token, cron_expression,
                             store_fullpage_screenshots, store_timing_screenshots, lh_warmup, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.name,
        accessKey,
        cron,
        storeFullpageScreenshots,
        storeTimingScreenshots,
        lhWarmup,
        new Date().toISOString()
      )
      .run();
  } catch {
    return json(request, env, { error: "Project id or access_key already exists" }, 409);
  }
  return json(
    request,
    env,
    {
      id,
      name: body.name,
      access_key: accessKey,
      share_token: null,
      cron_expression: cron,
      store_fullpage_screenshots: storeFullpageScreenshots,
      store_timing_screenshots: storeTimingScreenshots,
      lh_warmup: lhWarmup,
    },
    201
  );
}

export async function updateProject(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const body = (await request.json()) as {
    name?: string;
    access_key?: string;
    share_token?: string;
    cron_expression?: string;
    store_fullpage_screenshots?: boolean;
    store_timing_screenshots?: boolean;
    lh_warmup?: boolean;
  };
  const existing = await env.DB.prepare(`SELECT id FROM projects WHERE id = ?`)
    .bind(projectId)
    .first();
  if (!existing) return json(request, env, { error: "Not found" }, 404);
  if (body.name != null) {
    await env.DB.prepare(`UPDATE projects SET name = ? WHERE id = ?`)
      .bind(body.name, projectId)
      .run();
  }
  if (body.access_key != null) {
    const resolved = resolveKeyUpdate(body.access_key, normalizeAccessKey);
    if (resolved && "error" in resolved) {
      return json(request, env, { error: resolved.error }, 400);
    }
    if (resolved && "value" in resolved) {
      try {
        await env.DB.prepare(`UPDATE projects SET access_key = ? WHERE id = ?`)
          .bind(resolved.value, projectId)
          .run();
      } catch {
        return json(request, env, { error: "access_key already in use" }, 409);
      }
    }
  }
  if (body.share_token != null) {
    const resolved = resolveKeyUpdate(body.share_token, normalizeShareToken);
    if (!resolved || "error" in resolved) {
      return json(request, env, { error: resolved?.error ?? KEY_FORMAT_ERROR }, 400);
    }
    try {
      await env.DB.prepare(`UPDATE projects SET share_token = ? WHERE id = ?`)
        .bind(resolved.value, projectId)
        .run();
    } catch {
      return json(request, env, { error: "share_token already in use" }, 409);
    }
  }
  if (body.cron_expression != null) {
    const cron = normalizeCronExpression(body.cron_expression);
    if (!isValidCronExpression(cron)) {
      return json(request, env, { error: "cron_expression must have 5 fields or be empty" }, 400);
    }
    await env.DB.prepare(`UPDATE projects SET cron_expression = ? WHERE id = ?`)
      .bind(cron, projectId)
      .run();
  }
  if (body.store_fullpage_screenshots != null) {
    await env.DB.prepare(`UPDATE projects SET store_fullpage_screenshots = ? WHERE id = ?`)
      .bind(body.store_fullpage_screenshots ? 1 : 0, projectId)
      .run();
  }
  if (body.store_timing_screenshots != null) {
    await env.DB.prepare(`UPDATE projects SET store_timing_screenshots = ? WHERE id = ?`)
      .bind(body.store_timing_screenshots ? 1 : 0, projectId)
      .run();
  }
  if (body.lh_warmup != null) {
    await env.DB.prepare(`UPDATE projects SET lh_warmup = ? WHERE id = ?`)
      .bind(body.lh_warmup ? 1 : 0, projectId)
      .run();
  }
  return json(request, env, { status: "ok" });
}

export async function deleteProject(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  await deleteAllProjectReportsFromR2(env, projectId);
  await env.DB.prepare(`DELETE FROM urls WHERE project_id = ?`).bind(projectId).run();
  await env.DB.prepare(`DELETE FROM project_users WHERE project_id = ?`).bind(projectId).run();
  await env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(projectId).run();
  return json(request, env, { status: "ok" });
}

export async function listProjectUrls(
  request: Request,
  env: Env,
  projectId: string,
  user?: User
): Promise<Response> {
  if (user) {
    const access = await requireProjectAccess(request, env, user, projectId);
    if (access instanceof Response) return access;
  }
  const { results } = await env.DB.prepare(
    `SELECT id, project_id, name, url, enabled FROM urls WHERE project_id = ? ORDER BY name`
  )
    .bind(projectId)
    .all<ProjectUrl>();
  return json(request, env, { project_id: projectId, urls: results ?? [] });
}

export async function createProjectUrl(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const body = (await request.json()) as { id?: string; name?: string; url?: string };
  if (!body.name || !body.url) {
    return json(request, env, { error: "name and url required" }, 400);
  }
  const resolved = await resolveUrlId(env, projectId, body.id, body.name, body.url);
  if ("error" in resolved) {
    return json(request, env, { error: resolved.error }, resolved.status);
  }
  await env.DB.prepare(
    `INSERT INTO urls (id, project_id, name, url, enabled) VALUES (?, ?, ?, ?, 1)`
  )
    .bind(resolved.id, projectId, body.name, body.url)
    .run();
  return json(request, env, { id: resolved.id, project_id: projectId }, 201);
}

export async function updateProjectUrl(
  request: Request,
  env: Env,
  projectId: string,
  urlId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const body = (await request.json()) as {
    name?: string;
    url?: string;
    enabled?: boolean;
  };
  if (body.name != null) {
    await env.DB.prepare(`UPDATE urls SET name = ? WHERE id = ? AND project_id = ?`)
      .bind(body.name, urlId, projectId)
      .run();
  }
  if (body.url != null) {
    await env.DB.prepare(`UPDATE urls SET url = ? WHERE id = ? AND project_id = ?`)
      .bind(body.url, urlId, projectId)
      .run();
  }
  if (body.enabled != null) {
    await env.DB.prepare(`UPDATE urls SET enabled = ? WHERE id = ? AND project_id = ?`)
      .bind(body.enabled ? 1 : 0, urlId, projectId)
      .run();
  }
  return json(request, env, { status: "ok" });
}

export async function deleteProjectUrl(
  request: Request,
  env: Env,
  projectId: string,
  urlId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const reportKeys = await reportKeysForUrl(env, projectId, urlId);
  await deleteRunObjects(env, reportKeys);
  await env.DB.prepare(`DELETE FROM urls WHERE id = ? AND project_id = ?`)
    .bind(urlId, projectId)
    .run();
  return json(request, env, { status: "ok" });
}

export async function triggerProject(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  const access = await requireProjectAccess(request, env, user, projectId);
  if (access instanceof Response) return access;
  const result = await dispatchProject(env, projectId, {
    rateLimitKey: `last-run:${projectId}`,
  });
  if (!result.ok) {
    return json(request, env, JSON.parse(result.body), result.status);
  }
  return json(request, env, { status: "started", project_id: projectId }, 202);
}

export async function triggerProjectUrl(
  request: Request,
  env: Env,
  projectId: string,
  urlId: string
): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  const access = await requireProjectAccess(request, env, user, projectId);
  if (access instanceof Response) return access;
  const urlRow = await env.DB.prepare(
    `SELECT id FROM urls WHERE project_id = ? AND id = ? AND enabled = 1`
  )
    .bind(projectId, urlId)
    .first();
  if (!urlRow) return json(request, env, { error: "URL not found" }, 404);
  const result = await dispatchProject(env, projectId, {
    urlIds: [urlId],
    rateLimitKey: `last-run:${projectId}:${urlId}`,
  });
  if (!result.ok) {
    return json(request, env, JSON.parse(result.body), result.status);
  }
  return json(
    request,
    env,
    { status: "started", project_id: projectId, url_id: urlId },
    202
  );
}

export async function publicTriggerProject(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key")?.trim();
  const urlId = url.searchParams.get("url_id")?.trim() || undefined;

  if (!key) {
    return json(request, env, { error: "key query parameter required" }, 400);
  }

  const project = await env.DB.prepare(
    `SELECT id, access_key FROM projects WHERE id = ?`
  )
    .bind(projectId)
    .first<{ id: string; access_key: string | null }>();

  if (!project?.access_key || !constantTimeEqual(project.access_key, key)) {
    return json(request, env, { error: "Invalid project or access key" }, 403);
  }

  if (urlId) {
    const urlRow = await env.DB.prepare(
      `SELECT id FROM urls WHERE project_id = ? AND id = ? AND enabled = 1`
    )
      .bind(projectId, urlId)
      .first();
    if (!urlRow) return json(request, env, { error: "URL not found" }, 404);
    const result = await dispatchProject(env, projectId, {
      urlIds: [urlId],
      rateLimitKey: `last-run:${projectId}:${urlId}`,
    });
    if (!result.ok) {
      return json(request, env, JSON.parse(result.body), result.status);
    }
    return json(
      request,
      env,
      { status: "started", project_id: projectId, url_id: urlId },
      202
    );
  }

  const result = await dispatchProject(env, projectId, {
    rateLimitKey: `last-run:${projectId}`,
  });
  if (!result.ok) {
    return json(request, env, JSON.parse(result.body), result.status);
  }
  return json(request, env, { status: "started", project_id: projectId }, 202);
}

export async function internalProjectUrls(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const auth = request.headers.get("Authorization");
  if (!auth || auth !== `Bearer ${env.WORKER_API_SECRET}`) {
    return json(request, env, { error: "Unauthorized" }, 401);
  }
  const { results } = await env.DB.prepare(
    `SELECT id, name, url FROM urls WHERE project_id = ? AND enabled = 1`
  )
    .bind(projectId)
    .all<{ id: string; name: string; url: string }>();
  return json(request, env, { project_id: projectId, urls: results ?? [] });
}

export async function getMetrics(
  request: Request,
  env: Env,
  user: User,
  projectId: string,
  urlId: string,
  strategy: string
): Promise<Response> {
  const access = await requireProjectAccess(request, env, user, projectId);
  if (access instanceof Response) return access;
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

export async function getReports(
  request: Request,
  env: Env,
  user: User,
  projectId: string,
  urlId: string
): Promise<Response> {
  const access = await requireProjectAccess(request, env, user, projectId);
  if (access instanceof Response) return access;
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

export async function getReportJson(
  request: Request,
  env: Env,
  user: User,
  reportKey: string
): Promise<Response> {
  const parts = reportKeyParts(reportKey);
  if (!parts) return json(request, env, { error: "Invalid report key" }, 400);
  const normalized = normalizeReportKey(reportKey);
  const access = await requireProjectAccess(request, env, user, parts.projectId);
  if (access instanceof Response) return access;

  const resolved = await resolveReportObject(env, normalized, parts.projectId);
  if (!resolved) {
    const runInDb = await env.DB.prepare(`SELECT 1 FROM runs WHERE report_key = ?`)
      .bind(normalized)
      .first();
    const bucketName = reportsBucketName(env);
    const debug = await diagnoseReportLookup(
      env,
      normalized,
      parts.projectId,
      bucketName
    );
    const wiringLikelyWrong = !debug.bucket_has_any_reports;
    return json(
      request,
      env,
      {
        error: "Report not found",
        report_key: normalized,
        run_registered: Boolean(runInDb),
        hint: !runInDb
          ? "No run record exists for this report_key."
          : wiringLikelyWrong
            ? `The Worker R2 binding (bucket "${bucketName}") sees no objects under reports/ at all, yet the run is registered. The deployed binding reads a DIFFERENT bucket than GitHub Actions uploads to. Check: (1) R2_BUCKET secret equals binding bucket_name (set R2_BUCKET_NAME build var if your bucket differs from the default), (2) same Cloudflare account, (3) bucket jurisdiction — if R2_ENDPOINT contains ".eu." set R2_JURISDICTION=eu in the Worker build vars and redeploy.`
            : "Run is registered and the bucket has other reports, but not this exact key — likely a report_key/slug mismatch. See debug.sample_keys for what the binding actually stores.",
        debug,
      },
      404
    );
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
  return json(request, env, {
    lighthouse,
    run: run ?? null,
    report_key: resolved.key,
  });
}

export async function deleteReports(
  request: Request,
  env: Env,
  user: User
): Promise<Response> {
  const body = (await request.json()) as {
    project_id?: string;
    url_id?: string;
    report_keys?: string[];
  };
  if (!body.project_id || !body.url_id || !body.report_keys?.length) {
    return json(request, env, { error: "project_id, url_id, and report_keys required" }, 400);
  }

  const access = await requireProjectAccess(request, env, user, body.project_id);
  if (access instanceof Response) return access;

  const prefix = `reports/${body.project_id}/`;
  for (const key of body.report_keys) {
    if (!key.startsWith(prefix) || key.includes("..")) {
      return json(request, env, { error: "Invalid report_key" }, 400);
    }
    const row = await env.DB.prepare(
      `SELECT id FROM runs WHERE report_key = ? AND project_id = ? AND url_id = ?`
    )
      .bind(key, body.project_id, body.url_id)
      .first();
    if (!row) {
      return json(request, env, { error: `Run not found: ${key}` }, 404);
    }
  }

  await Promise.all(body.report_keys.map((key) => env.REPORTS.delete(key)));

  const placeholders = body.report_keys.map(() => "?").join(", ");
  await env.DB.prepare(
    `DELETE FROM runs WHERE project_id = ? AND url_id = ? AND report_key IN (${placeholders})`
  )
    .bind(body.project_id, body.url_id, ...body.report_keys)
    .run();

  return json(request, env, { status: "ok", deleted: body.report_keys.length });
}

export async function insertRun(
  request: Request,
  env: Env,
  payload: RunPayload
): Promise<Response> {
  const auth = request.headers.get("Authorization");
  if (!auth || auth !== `Bearer ${env.WORKER_API_SECRET}`) {
    return json(request, env, { error: "Unauthorized" }, 401);
  }
  const urlRow = await env.DB.prepare(
    `SELECT id FROM urls WHERE id = ? AND project_id = ?`
  )
    .bind(payload.url_id, payload.project_id)
    .first();
  if (!urlRow) {
    return json(request, env, { error: "Unknown url_id for project" }, 400);
  }
  const reportKey = normalizeReportKey(payload.report_key);

  // Best-effort visibility check. R2 reads via the Worker binding can lag a
  // freshly written object from the S3 API by a moment, so retry briefly.
  // Never fail registration on a miss — the upload already succeeded; a true
  // bucket mismatch surfaces later via the report loader's diagnostics.
  let r2Visible = false;
  let reportBytes: number | null =
    payload.report_bytes != null && Number.isFinite(payload.report_bytes)
      ? Math.max(0, Math.round(payload.report_bytes))
      : null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await env.REPORTS.head(reportKey);
    if (head) {
      r2Visible = true;
      if (reportBytes == null && head.size != null) {
        reportBytes = head.size;
      }
      break;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 750));
  }

  const triggerSource = payload.trigger_source === "cron" ? "cron" : "manual";
  const hasFullpageScreenshots = payload.has_fullpage_screenshots ? 1 : 0;
  const hasTimingScreenshots = payload.has_timing_screenshots ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO runs (project_id, url_id, strategy, run_at, performance,
                       lcp_ms, cls, fcp_ms, tbt_ms, speed_index, report_key, trigger_source,
                       report_bytes, has_fullpage_screenshots, has_timing_screenshots)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      payload.project_id,
      payload.url_id,
      payload.strategy,
      payload.run_at,
      payload.performance,
      payload.lcp_ms,
      payload.cls,
      payload.fcp_ms,
      payload.tbt_ms,
      payload.speed_index,
      reportKey,
      triggerSource,
      reportBytes,
      hasFullpageScreenshots,
      hasTimingScreenshots
    )
    .run();
  return json(
    request,
    env,
    {
      status: "ok",
      report_key: reportKey,
      ...(r2Visible
        ? {}
        : {
            warning:
              "Run registered, but the report object was not yet visible via the Worker R2 binding. If reports keep failing to load, the binding likely reads a different bucket than the S3 upload (check R2_BUCKET name, Cloudflare account, and bucket jurisdiction).",
            debug: await diagnoseReportLookup(
              env,
              reportKey,
              payload.project_id,
              reportsBucketName(env)
            ),
          }),
    },
    201
  );
}
