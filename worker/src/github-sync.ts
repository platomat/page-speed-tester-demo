import type { Env } from "./env";
import { requireAdmin } from "./auth";
import { json } from "./http";
import { getGitHubTarget, getUpstreamTarget, isUpstreamSyncEnabled } from "./settings";

const SYNC_COOLDOWN_MS = 60_000;
const SYNC_KV_KEY = "upstream-sync:last";
const MAX_COMMITS_TO_WALK = 100;

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

type PullRequestSummary = {
  number: number;
  mergeable: boolean | null;
  mergeable_state?: string;
  html_url?: string;
  title?: string;
  head?: { ref?: string; repo?: { full_name?: string } };
};

const SYNC_PR_TITLE_PREFIX = "Sync from upstream ";
const MERGE_POLL_MS = 1_500;
const MERGE_POLL_MAX = 24;
const MERGE_RETRY_DELAYS_MS = [0, 2_000, 4_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function upstreamRepoFullName(upstream: { owner: string; repo: string }): string {
  return `${upstream.owner}/${upstream.repo}`;
}

function isUpstreamSyncPullRequest(
  pr: PullRequestSummary,
  upstream: { owner: string; repo: string }
): boolean {
  const headRepo = pr.head?.repo?.full_name;
  if (headRepo === upstreamRepoFullName(upstream)) return true;
  return Boolean(pr.title?.startsWith(SYNC_PR_TITLE_PREFIX));
}

async function fetchPullRequest(
  pat: string,
  target: { owner: string; repo: string },
  pullNumber: number
): Promise<PullRequestSummary | null> {
  const res = await ghRequest(
    pat,
    `https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${pullNumber}`
  );
  if (!res.ok) return null;
  return (await res.json()) as PullRequestSummary;
}

async function listOpenUpstreamPullRequests(
  pat: string,
  target: { owner: string; repo: string },
  upstream: { owner: string; repo: string; branch: string },
  branch: string
): Promise<PullRequestSummary[]> {
  const url =
    `https://api.github.com/repos/${target.owner}/${target.repo}/pulls` +
    `?state=open&base=${encodeURIComponent(branch)}&per_page=30`;
  const res = await ghRequest(pat, url);
  if (!res.ok) return [];
  const data = (await res.json()) as PullRequestSummary[];
  if (!Array.isArray(data)) return [];
  return data.filter((pr) => isUpstreamSyncPullRequest(pr, upstream));
}

async function closePullRequest(
  pat: string,
  target: { owner: string; repo: string },
  pullNumber: number
): Promise<void> {
  await ghRequest(
    pat,
    `https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${pullNumber}`,
    { method: "PATCH", body: JSON.stringify({ state: "closed" }) }
  );
}

async function waitForMergeablePullRequest(
  pat: string,
  target: { owner: string; repo: string },
  pullNumber: number
): Promise<{ pr: PullRequestSummary } | { error: string; status: number; pr?: PullRequestSummary }> {
  for (let attempt = 0; attempt < MERGE_POLL_MAX; attempt++) {
    const pr = await fetchPullRequest(pat, target, pullNumber);
    if (!pr) {
      return { error: "Pull request not found", status: 404 };
    }
    if (pr.mergeable === true) {
      return { pr };
    }
    if (pr.mergeable === false) {
      const conflict = pr.mergeable_state === "dirty" || pr.mergeable_state === "unstable";
      return {
        error: conflict
          ? "Merge conflict — resolve manually on GitHub or with git"
          : `Pull request is not mergeable (${pr.mergeable_state ?? "unknown"})`,
        status: conflict ? 409 : 422,
        pr,
      };
    }
    await sleep(MERGE_POLL_MS);
  }

  const pr = await fetchPullRequest(pat, target, pullNumber);
  return {
    error: "Timed out waiting for GitHub to compute mergeability — try again or merge the PR on GitHub",
    status: 504,
    pr: pr ?? undefined,
  };
}

async function createUpstreamPullRequest(
  pat: string,
  target: { owner: string; repo: string },
  upstream: { owner: string; repo: string; branch: string },
  branch: string
): Promise<{ pr: PullRequestSummary } | { error: string; status: number }> {
  const title = `${SYNC_PR_TITLE_PREFIX}${upstream.owner}/${upstream.repo}@${branch}`;
  const payload: Record<string, string> = {
    title,
    body: "Automated upstream template sync (Page Speed Tester admin).",
    base: branch,
    head: branch,
  };

  // Template copies are outside the fork network — owner:branch merge/PR head fails with
  // "Head does not exist". Same-org cross-repo PRs require head_repo (branch name only in head).
  if (upstream.owner === target.owner) {
    payload.head_repo = `${upstream.owner}/${upstream.repo}`;
  } else {
    payload.head = `${upstream.owner}:${branch}`;
  }

  const res = await ghRequest(
    pat,
    `https://api.github.com/repos/${target.owner}/${target.repo}/pulls`,
    { method: "POST", body: JSON.stringify(payload) }
  );

  if (res.ok) {
    const pr = (await res.json()) as PullRequestSummary;
    return { pr };
  }

  if (res.status === 422) {
    const existing = await listOpenUpstreamPullRequests(pat, target, upstream, branch);
    if (existing[0]) return { pr: existing[0] };
  }

  return { error: await parseGhError(res), status: res.status };
}

async function mergePullRequest(
  pat: string,
  target: { owner: string; repo: string },
  pullNumber: number,
  commitTitle: string
): Promise<Response> {
  return ghRequest(
    pat,
    `https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${pullNumber}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({
        commit_title: commitTitle,
        merge_method: "merge",
      }),
    }
  );
}

async function mergePullRequestWithRetry(
  pat: string,
  target: { owner: string; repo: string },
  pullNumber: number,
  commitTitle: string
): Promise<Response> {
  let lastRes: Response | null = null;
  for (const delayMs of MERGE_RETRY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    const res = await mergePullRequest(pat, target, pullNumber, commitTitle);
    if (res.ok) return res;
    lastRes = res;
    if (res.status !== 500 && res.status !== 502 && res.status !== 503) {
      return res;
    }
  }
  return lastRes ?? new Response(null, { status: 500 });
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

async function crossRepoPullRequestSync(
  env: Env,
  target: { owner: string; repo: string },
  upstream: { owner: string; repo: string; branch: string },
  branch: string
): Promise<Response> {
  const commitTitle = `${SYNC_PR_TITLE_PREFIX}${upstream.owner}/${upstream.repo}@${branch}`;
  const pat = env.GH_PAT;

  const tryMergePullRequest = async (
    pullNumber: number
  ): Promise<
    | { ok: true; response: Response }
    | { ok: false; response?: Response; error: string; status: number; pr?: PullRequestSummary }
  > => {
    const ready = await waitForMergeablePullRequest(pat, target, pullNumber);
    if ("error" in ready) {
      return {
        ok: false,
        error: ready.error,
        status: ready.status,
        pr: ready.pr,
      };
    }

    const mergeRes = await mergePullRequestWithRetry(pat, target, pullNumber, commitTitle);
    if (mergeRes.ok) {
      return { ok: true, response: mergeRes };
    }

    return {
      ok: false,
      response: mergeRes,
      error: await parseGhError(mergeRes),
      status: mergeRes.status,
      pr: ready.pr,
    };
  };

  const existing = await listOpenUpstreamPullRequests(pat, target, upstream, branch);
  for (const pr of existing) {
    const result = await tryMergePullRequest(pr.number);
    if (result.ok) return result.response;
    if (result.status === 409) {
      return ghErrorResponse(result.error, result.status);
    }
    if (result.status >= 500 && result.pr) {
      await closePullRequest(pat, target, pr.number);
    }
  }

  const created = await createUpstreamPullRequest(pat, target, upstream, branch);
  if ("error" in created) {
    return ghErrorResponse(created.error, created.status);
  }

  const merged = await tryMergePullRequest(created.pr.number);
  if (merged.ok) return merged.response;

  const prUrl = merged.pr?.html_url;
  const detail = prUrl ? ` Open PR: ${prUrl}` : "";
  return ghErrorResponse(`${merged.error}.${detail}`, merged.status >= 500 ? 502 : merged.status);
}

function ghErrorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  return json(request, env, result);
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

  let method: "merge-upstream" | "cross-repo-merge" | "cross-repo-pr-merge" = is_fork
    ? "merge-upstream"
    : "cross-repo-pr-merge";
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
    mergeRes = await crossRepoPullRequestSync(env, target, upstream, branch);
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
          : method === "cross-repo-pr-merge"
            ? "Upstream merged via pull request"
            : "Upstream merged into repository",
      method,
      sha: typeof body.sha === "string" ? body.sha : null,
      compare: "error" in updatedCompare ? compareResult : updatedCompare,
    });
  }

  const errMsg = await parseGhError(mergeRes);
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
    },
    conflict ? 409 : 502
  );
}
