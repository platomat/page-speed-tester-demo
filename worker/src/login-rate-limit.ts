import type { Env } from "./env";

/** Precomputed hash for timing-safe login when the user does not exist. */
export const DUMMY_PASSWORD_HASH =
  "pbkdf2:100000:xR7xl3/RFRTQ25xr/zL62A==:q4QXJdEe1Tf+0cU3lJJmubsyeMf8YXnKwM1ccAuMXsA=";

const KV_PREFIX_IP = "login-fail:ip:";
const KV_PREFIX_LOGIN = "login-fail:login:";

/** First lock delay after a failed attempt; doubles each time (1s → 2s → 4s …). */
const BASE_DELAY_MS = 1000;
/** Maximum enforced wait between login attempts. */
const MAX_DELAY_MS = 15 * 60 * 1000;
/** Reset failure counters after one hour without activity. */
const KV_TTL_SECONDS = 60 * 60;

interface LoginAttemptState {
  failures: number;
  locked_until: number;
}

function parseState(raw: string | null): LoginAttemptState {
  if (!raw) return { failures: 0, locked_until: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<LoginAttemptState>;
    return {
      failures: Math.max(0, Number(parsed.failures) || 0),
      locked_until: Math.max(0, Number(parsed.locked_until) || 0),
    };
  } catch {
    return { failures: 0, locked_until: 0 };
  }
}

function delayForFailures(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (failures - 1), MAX_DELAY_MS);
}

async function getState(env: Env, key: string): Promise<LoginAttemptState> {
  return parseState(await env.KV.get(key));
}

function retryAfterSeconds(now: number, state: LoginAttemptState): number {
  const remainingMs = Math.max(0, state.locked_until - now);
  return Math.ceil(remainingMs / 1000);
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP")?.trim() ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function normalizeLoginId(login: string): string {
  return login.trim().toLowerCase();
}

export async function checkLoginRateLimit(
  env: Env,
  ip: string,
  loginId: string
): Promise<{ allowed: true } | { allowed: false; retry_after_seconds: number }> {
  const now = Date.now();
  const [ipState, loginState] = await Promise.all([
    getState(env, KV_PREFIX_IP + ip),
    getState(env, KV_PREFIX_LOGIN + loginId),
  ]);
  const retryAfter = Math.max(retryAfterSeconds(now, ipState), retryAfterSeconds(now, loginState));
  if (retryAfter > 0) {
    return { allowed: false, retry_after_seconds: retryAfter };
  }
  return { allowed: true };
}

async function incrementFailure(env: Env, key: string, now: number): Promise<void> {
  const state = await getState(env, key);
  const failures = state.failures + 1;
  const locked_until = now + delayForFailures(failures);
  await env.KV.put(key, JSON.stringify({ failures, locked_until }), {
    expirationTtl: KV_TTL_SECONDS,
  });
}

export async function recordLoginFailure(
  env: Env,
  ip: string,
  loginId: string
): Promise<void> {
  const now = Date.now();
  await Promise.all([
    incrementFailure(env, KV_PREFIX_IP + ip, now),
    incrementFailure(env, KV_PREFIX_LOGIN + loginId, now),
  ]);
}

export async function clearLoginRateLimit(
  env: Env,
  ip: string,
  loginId: string
): Promise<void> {
  await Promise.all([
    env.KV.delete(KV_PREFIX_IP + ip),
    env.KV.delete(KV_PREFIX_LOGIN + loginId),
  ]);
}
