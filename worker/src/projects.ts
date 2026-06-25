import type { Env, Project, ProjectUrl, RunPayload, User } from "./env";
import { listAccessibleProjectIds, requireProjectAccess } from "./access";
import { constantTimeEqual, generateAccessKey, normalizeAccessKey } from "./access-key";
import { requireAdmin, requireUser } from "./auth";
import { dispatchProject } from "./github";
import { isValidCronExpression, normalizeCronExpression } from "./cron";
import { json } from "./http";
import { ensureShareToken, normalizeShareToken } from "./share";
import { slugifyId } from "./slug";

async function deleteRunObjects(
  env: Env,
  reportKeys: string[]
): Promise<void> {
  await Promise.all(reportKeys.map((key) => env.REPORTS.delete(key)));
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
      ? "id, name, access_key, share_token, cron_expression, enabled, last_scheduled_at, created_at"
      : "id, name, cron_expression, enabled, last_scheduled_at, created_at";
  const { results } = await env.DB.prepare(
    `SELECT ${cols} FROM projects WHERE id IN (${placeholders}) ORDER BY name`
  )
    .bind(...ids)
    .all<Project>();

  if (user.role === "admin" && results?.length) {
    for (const project of results) {
      if (!project.share_token) {
        project.share_token = await ensureShareToken(env, project.id);
      }
    }
  }

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
  };
  if (!body.name) return json(request, env, { error: "name required" }, 400);
  const id = slugifyId(body.id ?? body.name);
  const cron = normalizeCronExpression(body.cron_expression);
  if (!isValidCronExpression(cron)) {
    return json(request, env, { error: "cron_expression must have 5 fields or be empty" }, 400);
  }
  const accessKey = body.access_key?.trim()
    ? normalizeAccessKey(body.access_key)
    : generateAccessKey();
  if (!accessKey) {
    return json(
      request,
      env,
      { error: "access_key must be 1–64 characters (letters, numbers, _ -)" },
      400
    );
  }
  const shareToken = generateAccessKey();
  try {
    await env.DB.prepare(
      `INSERT INTO projects (id, name, access_key, share_token, cron_expression, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(id, body.name, accessKey, shareToken, cron, new Date().toISOString())
      .run();
  } catch {
    return json(request, env, { error: "Project id or access_key already exists" }, 409);
  }
  return json(
    request,
    env,
    { id, name: body.name, access_key: accessKey, share_token: shareToken, cron_expression: cron },
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
    enabled?: boolean;
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
    const accessKey =
      body.access_key === "generate" || body.access_key.trim() === ""
        ? generateAccessKey()
        : normalizeAccessKey(body.access_key);
    if (!accessKey) {
      return json(
        request,
        env,
        { error: "access_key must be 1–64 characters (letters, numbers, _ -)" },
        400
      );
    }
    try {
      await env.DB.prepare(`UPDATE projects SET access_key = ? WHERE id = ?`)
        .bind(accessKey, projectId)
        .run();
    } catch {
      return json(request, env, { error: "access_key already in use" }, 409);
    }
  }
  if (body.share_token != null) {
    const shareToken =
      body.share_token === "generate" || body.share_token.trim() === ""
        ? generateAccessKey()
        : normalizeShareToken(body.share_token);
    if (!shareToken) {
      return json(
        request,
        env,
        { error: "share_token must be 1–64 characters (letters, numbers, _ -)" },
        400
      );
    }
    try {
      await env.DB.prepare(`UPDATE projects SET share_token = ? WHERE id = ?`)
        .bind(shareToken, projectId)
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
  if (body.enabled != null) {
    await env.DB.prepare(`UPDATE projects SET enabled = ? WHERE id = ?`)
      .bind(body.enabled ? 1 : 0, projectId)
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
  const reportKeys = await reportKeysForProject(env, projectId);
  await deleteRunObjects(env, reportKeys);
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
    `SELECT id, access_key, enabled FROM projects WHERE id = ?`
  )
    .bind(projectId)
    .first<{ id: string; access_key: string; enabled: number }>();

  if (!project || !constantTimeEqual(project.access_key, key)) {
    return json(request, env, { error: "Invalid project or access key" }, 403);
  }
  if (!project.enabled) {
    return json(request, env, { error: "Project is disabled" }, 403);
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
    `SELECT id, project_id, url_id, strategy, run_at, report_key, performance, trigger_source
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
  const sub = reportKey.match(/^reports\/([^/]+)\/(.+)$/);
  if (!sub) return json(request, env, { error: "Invalid report key" }, 400);
  const access = await requireProjectAccess(request, env, user, sub[1]);
  if (access instanceof Response) return access;
  const object = await env.REPORTS.get(reportKey);
  if (!object) return json(request, env, { error: "Report not found" }, 404);
  const body = await object.text();
  const lighthouse = JSON.parse(body) as Record<string, unknown>;
  const run = await env.DB.prepare(
    `SELECT project_id, url_id, strategy, report_key, run_at
     FROM runs WHERE report_key = ?`
  )
    .bind(reportKey)
    .first<{
      project_id: string;
      url_id: string;
      strategy: string;
      report_key: string;
      run_at: string;
    }>();
  return json(request, env, { lighthouse, run: run ?? null });
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
  const triggerSource = payload.trigger_source === "cron" ? "cron" : "manual";
  await env.DB.prepare(
    `INSERT INTO runs (project_id, url_id, strategy, run_at, performance,
                       lcp_ms, cls, fcp_ms, tbt_ms, speed_index, report_key, trigger_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      payload.report_key,
      triggerSource
    )
    .run();
  return json(request, env, { status: "ok", report_key: payload.report_key }, 201);
}
