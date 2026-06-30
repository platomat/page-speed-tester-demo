function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    return value % step === 0;
  }
  return field.split(",").some((part) => {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      return value >= a && value <= b;
    }
    return Number(part) === value;
  });
}

export function normalizeCronExpression(value?: string | null): string {
  return (value ?? "").trim();
}

export function hasCronSchedule(expression?: string | null): boolean {
  return normalizeCronExpression(expression).length > 0;
}

export function isValidCronExpression(expression: string): boolean {
  const trimmed = normalizeCronExpression(expression);
  if (!trimmed) return true;
  return trimmed.split(/\s+/).length === 5;
}

/** Returns true if a 5-field cron expression matches the given UTC date (minute precision). */
export function cronMatches(expression: string, date: Date): boolean {
  return cronMatchesInTimezone(expression, date, "UTC");
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedParts(
  date: Date,
  timeZone: string
): { minute: number; hour: number; dayOfMonth: number; month: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  return {
    minute: get("minute"),
    hour: get("hour"),
    dayOfMonth: get("day"),
    month: get("month"),
    dayOfWeek: WEEKDAY_MAP[weekdayStr] ?? 0,
  };
}

/** Match cron fields against local date/time in the given IANA timezone. */
export function cronMatchesInTimezone(
  expression: string,
  date: Date,
  timeZone: string
): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dom, month, dow] = parts;
  const local = getZonedParts(date, timeZone);
  return (
    fieldMatches(minute, local.minute) &&
    fieldMatches(hour, local.hour) &&
    fieldMatches(dom, local.dayOfMonth) &&
    fieldMatches(month, local.month) &&
    fieldMatches(dow, local.dayOfWeek)
  );
}

/** Floor to minute boundary (UTC ms). */
function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

/** How far back to search for the latest due cron slot (handles late CF invocations). */
export function cronLookbackMinutes(expression: string): number {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return 5;
  const [minute, hour, dom, month, dow] = parts;

  if (minute.startsWith("*/")) {
    const step = Number(minute.slice(2));
    if (Number.isFinite(step) && step > 0) return Math.max(step + 2, 5);
  }
  if (minute !== "*" && hour !== "*" && dom === "*" && month === "*" && dow === "*") {
    return 24 * 60;
  }
  if (minute !== "*" && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return 65;
  }
  return 120;
}

/**
 * Latest cron slot at or before `now` (minute precision, instance timezone).
 * Returns null if no matching slot within the lookback window.
 */
export function getLastCronOccurrence(
  expression: string,
  now: Date,
  timeZone: string,
  lookbackMinutes?: number
): Date | null {
  const lookback = lookbackMinutes ?? cronLookbackMinutes(expression);
  const cursor = floorToMinute(now);

  for (let i = 0; i <= lookback; i++) {
    const candidate = new Date(cursor.getTime() - i * 60_000);
    if (cronMatchesInTimezone(expression, candidate, timeZone)) {
      return candidate;
    }
  }
  return null;
}

/**
 * True when a cron slot has passed and no run was recorded for that slot yet.
 * Uses last_scheduled_at as the last completed dispatch timestamp.
 * Occurrences before anchorAt (e.g. project created_at) are ignored.
 */
export function isCronDue(
  expression: string,
  now: Date,
  timeZone: string,
  lastScheduledAt: string | null,
  anchorAt?: string | null
): boolean {
  const occurrence = getLastCronOccurrence(expression, now, timeZone);
  if (!occurrence) return false;

  const anchorMs = anchorAt ? floorToMinute(new Date(anchorAt)).getTime() : null;
  if (anchorMs != null && occurrence.getTime() < anchorMs) {
    return false;
  }

  const lastMs = lastScheduledAt ? floorToMinute(new Date(lastScheduledAt)).getTime() : null;
  const effectiveLastMs = lastMs ?? anchorMs;
  if (effectiveLastMs == null) return false;

  return effectiveLastMs < occurrence.getTime();
}

export function wasRecentlyScheduled(
  lastScheduledAt: string | null,
  windowMs = 5 * 60 * 1000
): boolean {
  if (!lastScheduledAt) return false;
  return Date.now() - new Date(lastScheduledAt).getTime() < windowMs;
}
