import type { Env } from "./env";
import { hasCronSchedule, isCronDue, wasRecentlyScheduled } from "./cron";
import { dispatchProject } from "./github";
import { isProjectRunActive } from "./run-status";
import { getCronEnabled, getTimezone } from "./settings";

export async function runScheduledProjects(env: Env): Promise<void> {
  if (!(await getCronEnabled(env))) return;

  const now = new Date();
  const timezone = await getTimezone(env);
  const { results } = await env.DB.prepare(
    `SELECT id, cron_expression, last_scheduled_at FROM projects`
  ).all<{
    id: string;
    cron_expression: string;
    last_scheduled_at: string | null;
  }>();

  for (const project of results ?? []) {
    if (!hasCronSchedule(project.cron_expression)) continue;
    if (!isCronDue(project.cron_expression, now, timezone, project.last_scheduled_at)) {
      continue;
    }
    if (wasRecentlyScheduled(project.last_scheduled_at)) continue;
    if (await isProjectRunActive(env, project.id)) continue;
    const result = await dispatchProject(env, project.id, {
      rateLimitKey: `cron:${project.id}`,
      triggerSource: "cron",
    });
    if (!result.ok) {
      console.error(`Cron dispatch failed for ${project.id}:`, result.body);
    }
  }
}
