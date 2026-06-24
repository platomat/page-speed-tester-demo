import type { Env } from "./env";

/** Comma-separated full origins (optional wrangler [vars] fallback). */
function extraDashboardOrigins(env: Env): string[] {
  const raw = env.DASHBOARD_ORIGIN?.trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Dashboard on host X, Worker API on api.X (or extra origins via DASHBOARD_ORIGIN). */
export function isAllowedDashboardOrigin(
  origin: string,
  workerHostname: string,
  env: Env
): boolean {
  if (!origin) return false;
  if (extraDashboardOrigins(env).includes(origin)) return true;

  let dashboardHost: string;
  try {
    dashboardHost = new URL(origin).hostname;
  } catch {
    return false;
  }

  if (dashboardHost === "localhost" || dashboardHost === "127.0.0.1") {
    return true;
  }
  if (dashboardHost.endsWith(".pages.dev")) {
    return true;
  }

  return (
    workerHostname.startsWith("api.") && dashboardHost === workerHostname.slice(4)
  );
}

export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const workerHostname = new URL(request.url).hostname;
  const allowed = isAllowedDashboardOrigin(origin, workerHostname, env);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
  if (allowed && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
}

export function json(
  request: Request,
  env: Env,
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(data, {
    status,
    headers: { ...corsHeaders(request, env), ...extraHeaders },
  });
}
