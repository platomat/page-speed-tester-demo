import type { Env } from "./env";
import { requireAdmin } from "./auth";
import { json } from "./http";
import { getGitHubTarget, getUpstreamTarget } from "./settings";

const SYNC_COOLDOWN_MS = 60_000;
const SYNC_KV_KEY = "upstream-sync:last";

type GhJson = Record<string, unknown>;

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
  try {
    const data = (await res.json()) as GhJson;
    if (typeof data.message === "string") return data.message;
    if (typeof data.error === "string") return data.error;
  } catch {
    // ignore JSON parse errors
  }
  const text = await res.text().catch(() => "");
  return text || `GitHub API error (${res.status})`;
}

export type UpstreamCompare = {
  target: { owner: string; repo: string; branch: string };
  upstream: { owner: string; repo: string; branch: string };
  status: string;
  ahead_by: number;
  behind_by: number;
  is_fork: boolean;
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
  const compareHead = `${upstream.owner}:${branch}`;
  const comparePath = `${branch}...${compareHead}`;
  const compareUrl = `https://api.github.com/repos/${target.owner}/${target.repo}/compare/${encodeURIComponent(comparePath)}`;

  const [compareRes, repoRes] = await Promise.all([
    ghRequest(env.GH_PAT, compareUrl),
    ghRequest(env.GH_PAT, `https://api.github.com/repos/${target.owner}/${target.repo}`),
  ]);

  if (!compareRes.ok) {
    const msg = await parseGhError(compareRes);
    return { error: msg, status: compareRes.status >= 500 ? 502 : compareRes.status };
  }

  const compare = (await compareRes.json()) as GhJson;
  const repoInfo = repoRes.ok ? ((await repoRes.json()) as GhJson) : null;

  const parent = repoInfo?.parent as GhJson | undefined;
  const parentFullName = typeof parent?.full_name === "string" ? parent.full_name : "";
  const upstreamFull = `${upstream.owner}/${upstream.repo}`;
  const isFork = Boolean(repoInfo?.fork && parentFullName === upstreamFull);

  const status = String(compare.status ?? "unknown");
  const ahead_by = Number(compare.ahead_by ?? 0);
  const behind_by = Number(compare.behind_by ?? 0);

  return {
    target: { ...target, branch },
    upstream,
    status,
    ahead_by,
    behind_by,
    is_fork: isFork,
    compare_url: typeof compare.html_url === "string" ? compare.html_url : null,
    can_sync: behind_by > 0 || status === "diverged" || status === "behind",
  };
}

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

export async function getUpstreamStatus(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const result = await fetchUpstreamCompare(env);
  if ("error" in result) {
    return json(request, env, { error: result.error }, result.status);
  }
  return json(request, env, result);
}

export async function syncUpstream(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

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

  let method: "merge-upstream" | "cross-repo-merge" = is_fork ? "merge-upstream" : "cross-repo-merge";
  let mergeRes: Response;

  if (is_fork) {
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
  } else {
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

  const errMsg = await parseGhError(mergeRes);
  const conflict = mergeRes.status === 409;
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
    },
    conflict ? 409 : 502
  );
}
