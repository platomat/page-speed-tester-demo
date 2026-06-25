import type { Env } from "./env";
import { requireAdmin } from "./auth";
import { json } from "./http";
import { getGitHubTarget, getUpstreamTarget, isUpstreamSyncEnabled } from "./settings";

const SYNC_COOLDOWN_MS = 60_000;
const SYNC_KV_KEY = "upstream-sync:last";
const SYNC_RESULT_KV_KEY = "upstream-sync:result";
const SYNC_RESULT_TTL = 24 * 60 * 60;
const MAX_COMMITS_TO_WALK = 100;

export type UpstreamSyncResult = {
  status: "pending" | "success" | "conflict" | "error";
  message: string;
  sha?: string | null;
  github_run_id?: string | null;
  updated_at: string;
};

type GhJson = Record<string, unknown>;

type GhCommit = { sha: string; html_url?: string };

function ghHeaders(pat: string, withBody = false): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "page-speed-tester-worker",
  };
  if (withBody) headers["Content-Type"] = "application/json";
  return headers;
}

async function ghRequest(pat: string, url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...ghHeaders(pat, init?.body != null),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

async function parseGhError(res: Response): Promise<string> {
  const { message } = await parseGhErrorDetails(res);
  return message;
}

async function parseGhErrorDetails(
  res: Response
): Promise<{ message: string; details: GhJson | null }> {
  const text = await res.text().catch(() => "");
  try {
    const data = text ? (JSON.parse(text) as GhJson) : null;
    if (data) {
      if (typeof data.message === "string") {
        return { message: data.message, details: data };
      }
      if (typeof data.error === "string") {
        return { message: data.error, details: data };
      }
    }
  } catch {
    // ignore JSON parse errors
  }
  return { message: text || `GitHub API error (${res.status})`, details: null };
}

async function fetchRepoInfo(
  pat: string,
  owner: string,
  repo: string
): Promise<GhJson | null> {
  const res = await ghRequest(pat, `https://api.github.com/repos/${owner}/${repo}`);
  if (!res.ok) return null;
  return (await res.json()) as GhJson;
}

function isForkOfUpstream(
  repoInfo: GhJson | null,
  upstream: { owner: string; repo: string }
): boolean {
  if (!repoInfo?.fork) return false;
  const parent = repoInfo.parent as GhJson | undefined;
  const parentFullName = typeof parent?.full_name === "string" ? parent.full_name : "";
  return parentFullName === `${upstream.owner}/${upstream.repo}`;
}

async function listBranchCommits(
  pat: string,
  owner: string,
  repo: string,
  branch: string,
  perPage = MAX_COMMITS_TO_WALK
): Promise<GhCommit[]> {
  const res = await ghRequest(
    pat,
    `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as GhCommit[];
  return Array.isArray(data) ? data : [];
}

async function commitExistsInRepo(
  pat: string,
  owner: string,
  repo: string,
  sha: string
): Promise<boolean> {
  const res = await ghRequest(
    pat,
    `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`
  );
  return res.ok;
}

async function fetchCommitMeta(
  pat: string,
  owner: string,
  repo: string,
  sha: string
): Promise<{ exists: boolean; is_merge: boolean }> {
  const res = await ghRequest(
    pat,
    `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`
  );
  if (!res.ok) return { exists: false, is_merge: false };
  const data = (await res.json()) as GhJson;
  const parents = data.parents;
  return {
    exists: true,
    is_merge: Array.isArray(parents) && parents.length >= 2,
  };
}

function deriveStatus(ahead_by: number, behind_by: number): string {
  if (behind_by === 0 && ahead_by === 0) return "identical";
  if (behind_by === 0) return "synced";
  if (ahead_by > 0 && behind_by > 0) return "diverged";
  if (behind_by > 0) return "behind";
  if (ahead_by > 0) return "ahead";
  return "unknown";
}

/** Fork network compare — must run from the upstream repo, not the fork. */
async function fetchForkNetworkCompare(
  pat: string,
  target: { owner: string; repo: string },
  upstream: { owner: string; repo: string; branch: string },
  branch: string
): Promise<{ status: string; ahead_by: number; behind_by: number; compare_url: string | null } | { error: string }> {
  const comparePath = `${branch}...${target.owner}:${branch}`;
  const compareUrl = `https://api.github.com/repos/${upstream.owner}/${upstream.repo}/compare/${encodeURIComponent(comparePath)}`;
  const compareRes = await ghRequest(pat, compareUrl);
  if (!compareRes.ok) {
    return { error: await parseGhError(compareRes) };
  }
  const compare = (await compareRes.json()) as GhJson;
  return {
    status: String(compare.status ?? "unknown"),
    ahead_by: Number(compare.ahead_by ?? 0),
    behind_by: Number(compare.behind_by ?? 0),
    compare_url: typeof compare.html_url === "string" ? compare.html_url : null,
  };
}

/**
 * Template copies are not in GitHub's fork network — compare API with owner:branch
 * resolves to the same repo when owner matches. Walk commits and check SHA presence instead.
 */
async function fetchTemplateCopyCompare(
  pat: string,
  target: { owner: string; repo: string },
  upstream: { owner: string; repo: string; branch: string },
  branch: string
): Promise<{ status: string; ahead_by: number; behind_by: number; compare_url: string | null }> {
  const [upstreamCommits, targetCommits] = await Promise.all([
    listBranchCommits(pat, upstream.owner, upstream.repo, branch),
    listBranchCommits(pat, target.owner, target.repo, branch),
  ]);

  let behind_by = 0;
  for (const commit of upstreamCommits) {
    if (await commitExistsInRepo(pat, target.owner, target.repo, commit.sha)) break;
    behind_by++;
  }

  let ahead_by = 0;
  for (const commit of targetCommits) {
    const meta = await fetchCommitMeta(pat, target.owner, target.repo, commit.sha);
    if (meta.is_merge) continue;
    if (await commitExistsInRepo(pat, upstream.owner, upstream.repo, commit.sha)) break;
    ahead_by++;
  }

  const status = deriveStatus(ahead_by, behind_by);
  const compare_url =
    behind_by > 0 && upstreamCommits[0]?.html_url
      ? upstreamCommits[0].html_url
      : `https://github.com/${upstream.owner}/${upstream.repo}/commits/${branch}`;

  return { status, ahead_by, behind_by, compare_url };
}

export type UpstreamCompare = {
  target: { owner: string; repo: string; branch: string };
  upstream: { owner: string; repo: string; branch: string };
  status: string;
  ahead_by: number;
  behind_by: number;
  is_fork: boolean;
  comparison_method: "fork-compare" | "commit-walk";
  compare_url: string | null;
  can_sync: boolean;
};

export async function fetchUpstreamCompare(
  env: Env
): Promise<UpstreamCompare | { error: string; status: number }> {
  if (!env.GH_PAT) {
    return { error: "GitHub PAT not configured", status: 503 };
  }

  const target = await getGitHubTarget(env);
  const upstream = await getUpstreamTarget(env);
  if (!target) {
    return {
      error: "GitHub owner/repository not configured in instance settings",
      status: 503,
    };
  }

  const branch = upstream.branch;
  const repoInfo = await fetchRepoInfo(env.GH_PAT, target.owner, target.repo);
  const isFork = isForkOfUpstream(repoInfo, upstream);

  let compareResult:
    | { status: string; ahead_by: number; behind_by: number; compare_url: string | null }
    | { error: string };

  let comparison_method: "fork-compare" | "commit-walk";

  if (isFork) {
    comparison_method = "fork-compare";
    compareResult = await fetchForkNetworkCompare(env.GH_PAT, target, upstream, branch);
    if ("error" in compareResult) {
      comparison_method = "commit-walk";
      compareResult = await fetchTemplateCopyCompare(env.GH_PAT, target, upstream, branch);
    }
  } else {
    comparison_method = "commit-walk";
    compareResult = await fetchTemplateCopyCompare(env.GH_PAT, target, upstream, branch);
  }

  if ("error" in compareResult) {
    return { error: String(compareResult.error), status: 502 };
  }

  const { status, ahead_by, behind_by, compare_url } = compareResult;

  return {
    target: { ...target, branch },
    upstream,
    status,
    ahead_by,
    behind_by,
    is_fork: isFork,
    comparison_method,
    compare_url,
    can_sync: behind_by > 0 || status === "diverged" || status === "behind",
  };
}

/** Fork network only — merges API accepts owner:branch as head. */
async function crossRepoMerge(
  env: Env,
  target: { owner: string; repo: string },
  upstream: { owner: string; repo: string; branch: string },
  branch: string
): Promise<Response> {
  return ghRequest(
    env.GH_PAT,
    `https://api.github.com/repos/${target.owner}/${target.repo}/merges`,
    {
      method: "POST",
      body: JSON.stringify({
        base: branch,
        head: `${upstream.owner}:${branch}`,
        commit_message: `Sync from upstream ${upstream.owner}/${upstream.repo}@${branch}`,
      }),
    }
  );
}

/**
 * Dispatch the `sync-upstream` workflow in the target repo. A real `git merge`
 * in GitHub Actions is reliable even for template copies that are not in the
 * fork network (the merges/PR API returns 500 for those).
 */
async function dispatchUpstreamSyncWorkflow(
  env: Env,
  target: { owner: string; repo: string },
  upstream: { owner: string; repo: string; branch: string },
  branch: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const res = await ghRequest(
    env.GH_PAT,
    `https://api.github.com/repos/${target.owner}/${target.repo}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({
        event_type: "sync-upstream",
        client_payload: {
          upstream_owner: upstream.owner,
          upstream_repo: upstream.repo,
          upstream_branch: upstream.branch,
          target_branch: branch,
        },
      }),
    }
  );
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, message: await parseGhError(res) };
}

async function setUpstreamSyncResult(
  env: Env,
  result: UpstreamSyncResult
): Promise<void> {
  await env.KV.put(SYNC_RESULT_KV_KEY, JSON.stringify(result), {
    expirationTtl: SYNC_RESULT_TTL,
  });
}

export async function getUpstreamSyncResult(
  env: Env
): Promise<UpstreamSyncResult | null> {
  const raw = await env.KV.get(SYNC_RESULT_KV_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UpstreamSyncResult;
  } catch {
    return null;
  }
}

/** Internal endpoint — the sync workflow reports merge/push outcome here. */
export async function registerUpstreamSyncResult(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = request.headers.get("Authorization");
  if (!auth || auth !== `Bearer ${env.WORKER_API_SECRET}`) {
    return json(request, env, { error: "Unauthorized" }, 401);
  }

  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    message?: string;
    sha?: string;
    github_run_id?: string;
  };

  const status: UpstreamSyncResult["status"] =
    body.status === "success" || body.status === "conflict" || body.status === "error"
      ? body.status
      : "error";

  await setUpstreamSyncResult(env, {
    status,
    message: body.message?.trim() || "Upstream sync finished",
    sha: body.sha?.trim() || null,
    github_run_id: body.github_run_id?.trim() || null,
    updated_at: new Date().toISOString(),
  });

  return json(request, env, { ok: true });
}

export async function getUpstreamStatus(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  if (!isUpstreamSyncEnabled(env)) {
    return json(request, env, { error: "Upstream sync is not available on this instance" }, 404);
  }

  const result = await fetchUpstreamCompare(env);
  if ("error" in result) {
    return json(request, env, { error: result.error }, result.status);
  }
  const last_sync = await getUpstreamSyncResult(env);
  return json(request, env, { ...result, last_sync });
}

export async function syncUpstream(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  if (!isUpstreamSyncEnabled(env)) {
    return json(request, env, { error: "Upstream sync is not available on this instance" }, 404);
  }

  if (!env.GH_PAT) {
    return json(request, env, { error: "GitHub PAT not configured" }, 503);
  }

  const last = await env.KV.get(SYNC_KV_KEY);
  if (last) {
    const elapsed = Date.now() - Number(last);
    if (elapsed < SYNC_COOLDOWN_MS) {
      return json(
        request,
        env,
        {
          error: "Rate limited",
          retry_after_seconds: Math.ceil((SYNC_COOLDOWN_MS - elapsed) / 1000),
        },
        429
      );
    }
  }

  const compareResult = await fetchUpstreamCompare(env);
  if ("error" in compareResult) {
    return json(request, env, { error: compareResult.error }, compareResult.status);
  }

  const { target, upstream, is_fork, behind_by, status } = compareResult;
  const branch = target.branch;

  if (behind_by === 0 && status !== "diverged") {
    return json(request, env, {
      ok: true,
      message: "Already up to date",
      method: null,
      compare: compareResult,
    });
  }

  // Template copies are not in the fork network — the merges/PR API returns 500.
  // Dispatch a workflow that runs a real `git merge` + push instead.
  if (!is_fork) {
    const dispatch = await dispatchUpstreamSyncWorkflow(env, target, upstream, branch);
    if (!dispatch.ok) {
      return json(
        request,
        env,
        {
          ok: false,
          error: `Could not start sync workflow: ${dispatch.message}`,
          method: "workflow-dispatch",
          compare: compareResult,
          hint: "Ensure .github/workflows/upstream-sync.yml exists on the target repo's default branch and the GitHub PAT can dispatch it.",
        },
        502
      );
    }
    await env.KV.put(SYNC_KV_KEY, String(Date.now()));
    await setUpstreamSyncResult(env, {
      status: "pending",
      message: "Sync workflow dispatched — merging upstream via GitHub Actions",
      updated_at: new Date().toISOString(),
    });
    return json(request, env, {
      ok: true,
      started: true,
      method: "workflow-dispatch",
      message:
        "Sync läuft als GitHub Action (git merge). Der Status aktualisiert sich in Kürze.",
      compare: compareResult,
      actions_url: `https://github.com/${target.owner}/${target.repo}/actions/workflows/upstream-sync.yml`,
    });
  }

  let method: "merge-upstream" | "cross-repo-merge" = "merge-upstream";
  let mergeRes: Response;

  mergeRes = await ghRequest(
    env.GH_PAT,
    `https://api.github.com/repos/${target.owner}/${target.repo}/merge-upstream`,
    {
      method: "POST",
      body: JSON.stringify({ branch, base_branch: branch }),
    }
  );
  if (!mergeRes.ok && (mergeRes.status === 422 || mergeRes.status === 403)) {
    method = "cross-repo-merge";
    mergeRes = await crossRepoMerge(env, target, upstream, branch);
  }

  if (mergeRes.ok) {
    await env.KV.put(SYNC_KV_KEY, String(Date.now()));
    const body = (await mergeRes.json().catch(() => ({}))) as GhJson;
    const updatedCompare = await fetchUpstreamCompare(env);
    return json(request, env, {
      ok: true,
      message:
        method === "merge-upstream"
          ? "Upstream merged (fork sync)"
          : "Upstream merged into repository",
      method,
      sha: typeof body.sha === "string" ? body.sha : null,
      compare: "error" in updatedCompare ? compareResult : updatedCompare,
    });
  }

  const errBody = (await mergeRes.json().catch(() => ({}))) as GhJson;
  const errMsg =
    typeof errBody.message === "string"
      ? errBody.message
      : await parseGhError(
          new Response(JSON.stringify(errBody), {
            status: mergeRes.status,
            headers: { "Content-Type": "application/json" },
          })
        );
  const conflict = mergeRes.status === 409 || mergeRes.status === 405;
  return json(
    request,
    env,
    {
      ok: false,
      error: conflict
        ? "Merge conflict — resolve manually on GitHub or with git"
        : errMsg,
      method,
      conflict,
      compare: compareResult,
      pull_request_url: errBody.pull_request_url ?? null,
      pull_request_number: errBody.pull_request_number ?? null,
      github_status: errBody.github_status ?? mergeRes.status,
      merge_method: errBody.merge_method ?? null,
      github: errBody.github ?? null,
      hint: errBody.hint ?? null,
    },
    conflict ? 409 : 502
  );
}
