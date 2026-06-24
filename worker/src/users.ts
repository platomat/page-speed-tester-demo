import type { Env } from "./env";
import { hashPassword, requireAdmin } from "./auth";
import { json } from "./http";

export async function listUsers(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const { results } = await env.DB.prepare(
    `SELECT id, email, username, role, created_at FROM users ORDER BY username`
  ).all();
  return json(request, env, { users: results ?? [] });
}

export async function createUser(request: Request, env: Env): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const body = (await request.json()) as {
    email?: string;
    username?: string;
    password?: string;
    role?: "admin" | "user";
  };
  if (!body.email || !body.username || !body.password) {
    return json(request, env, { error: "email, username, password required" }, 400);
  }
  const role = body.role === "admin" ? "admin" : "user";
  const id = crypto.randomUUID();
  const password_hash = await hashPassword(body.password);
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, username, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(id, body.email, body.username, password_hash, role, new Date().toISOString())
      .run();
  } catch {
    return json(request, env, { error: "User already exists" }, 409);
  }
  return json(request, env, { id, email: body.email, username: body.username, role }, 201);
}

export async function assignUserProject(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const body = (await request.json()) as { project_id?: string };
  if (!body.project_id) {
    return json(request, env, { error: "project_id required" }, 400);
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO project_users (project_id, user_id) VALUES (?, ?)`
  )
    .bind(body.project_id, userId)
    .run();
  return json(request, env, { status: "ok" });
}

export async function unassignUserProject(
  request: Request,
  env: Env,
  userId: string,
  projectId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  await env.DB.prepare(
    `DELETE FROM project_users WHERE user_id = ? AND project_id = ?`
  )
    .bind(userId, projectId)
    .run();
  return json(request, env, { status: "ok" });
}

export async function listUserProjects(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const { results } = await env.DB.prepare(
    `SELECT project_id FROM project_users WHERE user_id = ?`
  )
    .bind(userId)
    .all<{ project_id: string }>();
  return json(request, env, {
    user_id: userId,
    project_ids: (results ?? []).map((r) => r.project_id),
  });
}
