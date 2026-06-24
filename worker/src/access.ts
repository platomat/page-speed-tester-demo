import type { Env, User } from "./env";
import { json } from "./http";

export async function userCanAccessProject(
  env: Env,
  user: User,
  projectId: string
): Promise<boolean> {
  if (user.role === "admin") return true;
  const row = await env.DB.prepare(
    `SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ?`
  )
    .bind(projectId, user.id)
    .first();
  return !!row;
}

export async function requireProjectAccess(
  request: Request,
  env: Env,
  user: User,
  projectId: string
): Promise<true | Response> {
  const ok = await userCanAccessProject(env, user, projectId);
  if (!ok) return json(request, env, { error: "Forbidden" }, 403);
  return true;
}

export async function listAccessibleProjectIds(
  env: Env,
  user: User
): Promise<string[]> {
  if (user.role === "admin") {
    const { results } = await env.DB.prepare(`SELECT id FROM projects`).all<{
      id: string;
    }>();
    return (results ?? []).map((r) => r.id);
  }
  const { results } = await env.DB.prepare(
    `SELECT project_id as id FROM project_users WHERE user_id = ?`
  )
    .bind(user.id)
    .all<{ id: string }>();
  return (results ?? []).map((r) => r.id);
}
