import type { Env, User } from "./env";
import { requireProjectAccess } from "./access";
import { json } from "./http";
import { getGitHubTarget } from "./settings";

const RUN_STATUS_TTL = 2 * 60 * 60;

export interface RunStatusRecord {
  project_id: string;
  state: "pending" | "running";
  triggered_at: string;
  started_at?: string;
  github_run_id?: string;
  url_ids?: string[];
}

function kvKey(projectId: string): string {
  return `run-status:${projectId}`;
}

export async function githubActionsRunUrl(env: Env, runId: string): Promise<string | null> {
  const gh = await getGitHubTarget(env);
  if (!gh) return null;
  return `https://github.com/${gh.owner}/${gh.repo}/actions/runs/${runId}`;
}

async function getRunStatusRecord(
  env: Env,
  projectId: string
): Promise<RunStatusRecord | null> {
  const raw = await env.KV.get(kvKey(projectId));
  if (!raw) return null;
  return JSON.parse(raw) as RunStatusRecord;
}

export async function isProjectRunActive(env: Env, projectId: string): Promise<boolean> {
  const record = await getRunStatusRecord(env, projectId);
  return record?.state === "pending" || record?.state === "running";
}

export async function setRunPending(
  env: Env,
  projectId: string,
  urlIds?: string[]
): Promise<void> {
  const record: RunStatusRecord = {
    project_id: projectId,
    state: "pending",
    triggered_at: new Date().toISOString(),
    ...(urlIds?.length ? { url_ids: urlIds } : {}),
  };
  await env.KV.put(kvKey(projectId), JSON.stringify(record), {
    expirationTtl: RUN_STATUS_TTL,
  });
}

export async function registerRunStarted(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = request.headers.get("Authorization");
  if (!auth || auth !== `Bearer ${env.WORKER_API_SECRET}`) {
    return json(request, env, { error: "Unauthorized" }, 401);
  }

  const body = (await request.json()) as {
    project_id?: string;
    github_run_id?: string | number;
    started_at?: string;
    url_ids?: string[];
  };

  if (!body.project_id || body.github_run_id == null) {
    return json(request, env, { error: "project_id and github_run_id required" }, 400);
  }

  const project = await env.DB.prepare(`SELECT id FROM projects WHERE id = ?`)
    .bind(body.project_id)
    .first();
  if (!project) {
    return json(request, env, { error: "Project not found" }, 404);
  }

  const existing = await getRunStatusRecord(env, body.project_id);
  const startedAt = body.started_at ?? new Date().toISOString();
  const record: RunStatusRecord = {
    project_id: body.project_id,
    state: "running",
    triggered_at: existing?.triggered_at ?? startedAt,
    started_at: startedAt,
    github_run_id: String(body.github_run_id),
    url_ids: body.url_ids?.length ? body.url_ids : existing?.url_ids,
  };

  await env.KV.put(kvKey(body.project_id), JSON.stringify(record), {
    expirationTtl: RUN_STATUS_TTL,
  });

  return json(request, env, { status: "ok" });
}

export async function registerRunCompleted(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = request.headers.get("Authorization");
  if (!auth || auth !== `Bearer ${env.WORKER_API_SECRET}`) {
    return json(request, env, { error: "Unauthorized" }, 401);
  }

  const body = (await request.json()) as { project_id?: string };
  if (!body.project_id) {
    return json(request, env, { error: "project_id required" }, 400);
  }

  await env.KV.delete(kvKey(body.project_id));
  return json(request, env, { status: "ok" });
}

export async function getRunStatus(
  request: Request,
  env: Env,
  user: User,
  projectId: string
): Promise<Response> {
  const access = await requireProjectAccess(request, env, user, projectId);
  if (access instanceof Response) return access;

  const record = await getRunStatusRecord(env, projectId);
  if (!record) {
    return json(request, env, { running: false });
  }

  return json(request, env, {
    running: true,
    state: record.state,
    triggered_at: record.triggered_at,
    started_at: record.started_at ?? null,
    github_run_id: record.github_run_id ?? null,
    github_run_url: record.github_run_id
      ? await githubActionsRunUrl(env, record.github_run_id)
      : null,
    url_ids: record.url_ids ?? [],
  });
}
