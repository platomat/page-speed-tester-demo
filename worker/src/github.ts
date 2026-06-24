import type { Env } from "./env";
import { setRunPending } from "./run-status";
import { getGitHubTarget, getStoreScreenshots } from "./settings";

const RATE_LIMIT_MS = 5 * 60 * 1000;

export async function dispatchProject(
  env: Env,
  projectId: string,
  options?: { rateLimitKey?: string; urlIds?: string[]; triggerSource?: "cron" | "manual" }
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  if (!env.GH_PAT) {
    return { ok: false, status: 503, body: "GitHub dispatch not configured" };
  }

  const gh = await getGitHubTarget(env);
  if (!gh) {
    return { ok: false, status: 503, body: "GitHub repository not configured" };
  }

  const urlIds = options?.urlIds?.filter(Boolean);
  const kvKey =
    options?.rateLimitKey ??
    (urlIds?.length === 1 ? `last-run:${projectId}:${urlIds[0]}` : `last-run:${projectId}`);
  const lastRun = await env.KV.get(kvKey);
  if (lastRun) {
    const elapsed = Date.now() - Number(lastRun);
    if (elapsed < RATE_LIMIT_MS) {
      return {
        ok: false,
        status: 429,
        body: JSON.stringify({
          error: "Rate limited",
          retry_after_seconds: Math.ceil((RATE_LIMIT_MS - elapsed) / 1000),
        }),
      };
    }
  }

  const storeScreenshots = await getStoreScreenshots(env);

  const ghResponse = await fetch(
    `https://api.github.com/repos/${gh.owner}/${gh.repo}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_PAT}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "page-speed-tester-worker",
      },
      body: JSON.stringify({
        event_type: "run-lighthouse",
        client_payload: {
          project_id: projectId,
          trigger_source: options?.triggerSource ?? "manual",
          store_screenshots: storeScreenshots,
          ...(urlIds?.length ? { url_ids: urlIds } : {}),
        },
      }),
    }
  );

  if (!ghResponse.ok) {
    const body = await ghResponse.text();
    return { ok: false, status: 502, body: JSON.stringify({ error: "GitHub dispatch failed", body }) };
  }

  await env.KV.put(kvKey, String(Date.now()));
  await setRunPending(env, projectId, urlIds);
  await env.DB.prepare(
    `UPDATE projects SET last_scheduled_at = ? WHERE id = ?`
  )
    .bind(new Date().toISOString(), projectId)
    .run();

  return { ok: true };
}
