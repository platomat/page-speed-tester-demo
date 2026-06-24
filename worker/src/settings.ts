import type { Env } from "./env";
import { requireAdmin, requireUser } from "./auth";
import { json } from "./http";

const TIMEZONE_KEY = "timezone";
const CRON_ENABLED_KEY = "cron_enabled";
const GH_OWNER_KEY = "gh_owner";
const GH_REPO_KEY = "gh_repo";
const COOKIE_DOMAIN_KEY = "cookie_domain";
const STORE_SCREENSHOTS_KEY = "store_screenshots";
const UPSTREAM_OWNER_KEY = "upstream_owner";
const UPSTREAM_REPO_KEY = "upstream_repo";
const UPSTREAM_BRANCH_KEY = "upstream_branch";
const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_UPSTREAM_OWNER = "platomat";
export const DEFAULT_UPSTREAM_REPO = "page-speed-tester-demo";
export const DEFAULT_UPSTREAM_BRANCH = "main";

const GITHUB_SLUG_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const GITHUB_BRANCH_RE = /^[a-zA-Z0-9._/-]+$/;
const COOKIE_DOMAIN_RE =
  /^\.?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

export function isValidCookieDomain(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return trimmed.length <= 253 && COOKIE_DOMAIN_RE.test(trimmed);
}

export function isValidGitHubBranch(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 255 && GITHUB_BRANCH_RE.test(trimmed);
}

export function isValidGitHubSlug(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 100 && GITHUB_SLUG_RE.test(trimmed);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function getTimezone(env: Env): Promise<string> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind(TIMEZONE_KEY)
    .first<{ value: string }>();
  const tz = row?.value?.trim();
  if (tz && isValidTimezone(tz)) return tz;
  return DEFAULT_TIMEZONE;
}

export async function getCronEnabled(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind(CRON_ENABLED_KEY)
    .first<{ value: string }>();
  const value = row?.value?.trim().toLowerCase();
  if (!value) return true;
  return value === "1" || value === "true" || value === "yes";
}

export async function getStoreScreenshots(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind(STORE_SCREENSHOTS_KEY)
    .first<{ value: string }>();
  const value = row?.value?.trim().toLowerCase();
  if (!value) return false;
  return value === "1" || value === "true" || value === "yes";
}

async function getSettingValue(env: Env, key: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value?.trim() ?? "";
}

/** GitHub repo for repository_dispatch (D1 settings, optional wrangler [vars] fallback). */
export async function getGitHubTarget(
  env: Env
): Promise<{ owner: string; repo: string } | null> {
  const owner = (await getSettingValue(env, GH_OWNER_KEY)) || env.GH_OWNER?.trim() || "";
  const repo = (await getSettingValue(env, GH_REPO_KEY)) || env.GH_REPO?.trim() || "";
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** Upstream template/fork source for sync (D1 settings with code defaults). */
export async function getUpstreamTarget(
  env: Env
): Promise<{ owner: string; repo: string; branch: string }> {
  const owner =
    (await getSettingValue(env, UPSTREAM_OWNER_KEY)) || DEFAULT_UPSTREAM_OWNER;
  const repo = (await getSettingValue(env, UPSTREAM_REPO_KEY)) || DEFAULT_UPSTREAM_REPO;
  const branchRaw = (await getSettingValue(env, UPSTREAM_BRANCH_KEY)) || DEFAULT_UPSTREAM_BRANCH;
  const branch = isValidGitHubBranch(branchRaw) ? branchRaw : DEFAULT_UPSTREAM_BRANCH;
  return { owner, repo, branch };
}

/** Session cookie Domain attribute (D1 settings, optional wrangler [vars] fallback). */
export async function getCookieDomain(env: Env): Promise<string | undefined> {
  const domain =
    (await getSettingValue(env, COOKIE_DOMAIN_KEY)) || env.COOKIE_DOMAIN?.trim() || "";
  return domain || undefined;
}

export async function getSettings(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  return json(request, env, await buildSettingsPayload(env));
}

async function buildSettingsPayload(env: Env) {
  const timezone = await getTimezone(env);
  const cron_enabled = await getCronEnabled(env);
  const gh_owner = await getSettingValue(env, GH_OWNER_KEY);
  const gh_repo = await getSettingValue(env, GH_REPO_KEY);
  const cookie_domain = await getSettingValue(env, COOKIE_DOMAIN_KEY);
  const store_screenshots = await getStoreScreenshots(env);
  const upstream = await getUpstreamTarget(env);
  return {
    timezone,
    cron_enabled,
    gh_owner,
    gh_repo,
    cookie_domain,
    store_screenshots,
    upstream_owner: upstream.owner,
    upstream_repo: upstream.repo,
    upstream_branch: upstream.branch,
  };
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
    .bind(key, value)
    .run();
}

export async function updateSettings(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const body = (await request.json()) as Record<string, unknown>;
  const updates: Record<string, string> = {};

  if (body.timezone !== undefined) {
    const timezone = String(body.timezone ?? "").trim();
    if (!timezone) {
      return json(request, env, { error: "timezone required" }, 400);
    }
    if (!isValidTimezone(timezone)) {
      return json(request, env, { error: "Invalid IANA timezone" }, 400);
    }
    updates.timezone = timezone;
  }

  if (body.cron_enabled !== undefined) {
    updates[CRON_ENABLED_KEY] = body.cron_enabled ? "1" : "0";
  }

  if (body.gh_owner !== undefined || body.gh_repo !== undefined) {
    const owner = String(body.gh_owner ?? "").trim();
    const repo = String(body.gh_repo ?? "").trim();
    if (owner && !isValidGitHubSlug(owner)) {
      return json(request, env, { error: "Invalid GitHub owner" }, 400);
    }
    if (repo && !isValidGitHubSlug(repo)) {
      return json(request, env, { error: "Invalid GitHub repository name" }, 400);
    }
    if (Boolean(owner) !== Boolean(repo)) {
      return json(request, env, { error: "GitHub owner and repository are both required" }, 400);
    }
    updates[GH_OWNER_KEY] = owner;
    updates[GH_REPO_KEY] = repo;
  }

  if (body.cookie_domain !== undefined) {
    const cookieDomain = String(body.cookie_domain ?? "").trim();
    if (!isValidCookieDomain(cookieDomain)) {
      return json(request, env, { error: "Invalid cookie domain" }, 400);
    }
    updates[COOKIE_DOMAIN_KEY] = cookieDomain;
  }

  if (body.store_screenshots !== undefined) {
    updates[STORE_SCREENSHOTS_KEY] = body.store_screenshots ? "1" : "0";
  }

  if (
    body.upstream_owner !== undefined ||
    body.upstream_repo !== undefined ||
    body.upstream_branch !== undefined
  ) {
    const upstreamOwner = String(body.upstream_owner ?? "").trim() || DEFAULT_UPSTREAM_OWNER;
    const upstreamRepo = String(body.upstream_repo ?? "").trim() || DEFAULT_UPSTREAM_REPO;
    const upstreamBranch =
      String(body.upstream_branch ?? "").trim() || DEFAULT_UPSTREAM_BRANCH;
    if (!isValidGitHubSlug(upstreamOwner)) {
      return json(request, env, { error: "Invalid upstream GitHub owner" }, 400);
    }
    if (!isValidGitHubSlug(upstreamRepo)) {
      return json(request, env, { error: "Invalid upstream GitHub repository name" }, 400);
    }
    if (!isValidGitHubBranch(upstreamBranch)) {
      return json(request, env, { error: "Invalid upstream branch name" }, 400);
    }
    updates[UPSTREAM_OWNER_KEY] = upstreamOwner;
    updates[UPSTREAM_REPO_KEY] = upstreamRepo;
    updates[UPSTREAM_BRANCH_KEY] = upstreamBranch;
  }

  if (!Object.keys(updates).length) {
    return json(request, env, { error: "No settings to update" }, 400);
  }

  for (const [key, value] of Object.entries(updates)) {
    await setSetting(env, key, value);
  }

  return json(request, env, await buildSettingsPayload(env));
}
