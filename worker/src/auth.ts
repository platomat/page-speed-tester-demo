import type { Env, User } from "./env";
import { json } from "./http";
import { hashPassword, verifyPassword } from "./password-hash";
import { getCookieDomain } from "./settings";

const SESSION_COOKIE = "pst_session";
const SESSION_DAYS = 14;

export { hashPassword, verifyPassword } from "./password-hash";

function sessionExpiry(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + SESSION_DAYS);
  return d.toISOString();
}

function sessionCookie(sessionId: string, domain?: string): string {
  const parts = [
    `${SESSION_COOKIE}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

function clearSessionCookie(domain?: string): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

export function getSessionId(request: Request): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

export async function getCurrentUser(
  request: Request,
  env: Env
): Promise<User | null> {
  const sessionId = getSessionId(request);
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(sessionId, new Date().toISOString())
    .first<User>();
  return row ?? null;
}

export async function requireUser(
  request: Request,
  env: Env
): Promise<User | Response> {
  const user = await getCurrentUser(request, env);
  if (!user) {
    return json(request, env, { error: "Unauthorized" }, 401);
  }
  return user;
}

export async function requireAdmin(
  request: Request,
  env: Env
): Promise<User | Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  if (user.role !== "admin") {
    return json(request, env, { error: "Forbidden" }, 403);
  }
  return user;
}

export async function handleBootstrap(
  request: Request,
  env: Env
): Promise<Response> {
  const count = await env.DB.prepare(`SELECT COUNT(*) as c FROM users`).first<{
    c: number;
  }>();
  if ((count?.c ?? 0) > 0) {
    return json(request, env, { error: "Bootstrap already completed" }, 403);
  }
  const body = (await request.json()) as {
    email?: string;
    username?: string;
    password?: string;
  };
  if (!body.email || !body.username || !body.password) {
    return json(request, env, { error: "email, username, password required" }, 400);
  }
  const id = crypto.randomUUID();
  const password_hash = await hashPassword(body.password);
  await env.DB.prepare(
    `INSERT INTO users (id, email, username, password_hash, role, created_at)
     VALUES (?, ?, ?, ?, 'admin', ?)`
  )
    .bind(id, body.email, body.username, password_hash, new Date().toISOString())
    .run();
  return json(request, env, { status: "ok", user_id: id }, 201);
}

export async function handleLogin(
  request: Request,
  env: Env
): Promise<Response> {
  const body = (await request.json()) as {
    login?: string;
    password?: string;
  };
  if (!body.login || !body.password) {
    return json(request, env, { error: "login and password required" }, 400);
  }
  const row = await env.DB.prepare(
    `SELECT id, email, username, role, password_hash FROM users
     WHERE email = ? OR username = ?`
  )
    .bind(body.login, body.login)
    .first<User & { password_hash: string }>();
  if (!row || !(await verifyPassword(body.password, row.password_hash))) {
    return json(request, env, { error: "Invalid credentials" }, 401);
  }
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`
  )
    .bind(sessionId, row.id, sessionExpiry())
    .run();
  const domain = await getCookieDomain(env);
  return json(
    request,
    env,
    { user: { id: row.id, email: row.email, username: row.username, role: row.role } },
    200,
    { "Set-Cookie": sessionCookie(sessionId, domain) }
  );
}

export async function handleLogout(
  request: Request,
  env: Env
): Promise<Response> {
  const sessionId = getSessionId(request);
  if (sessionId) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
  }
  const domain = await getCookieDomain(env);
  return json(
    request,
    env,
    { status: "ok" },
    200,
    { "Set-Cookie": clearSessionCookie(domain) }
  );
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await getCurrentUser(request, env);
  if (!user) return json(request, env, { error: "Unauthorized" }, 401);
  return json(request, env, { user });
}

export async function handleSetupStatus(
  request: Request,
  env: Env
): Promise<Response> {
  const count = await env.DB.prepare(`SELECT COUNT(*) as c FROM users`).first<{
    c: number;
  }>();
  return json(request, env, { needs_bootstrap: (count?.c ?? 0) === 0 });
}
