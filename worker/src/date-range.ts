export type ParsedRunDateRange =
  | { ok: true; from: string | null; to: string | null }
  | { ok: false; error: string; status: number };

const MAX_LAST_DAYS = 366;

function parseIsoTimestamp(value: string): string | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function parseLastDays(value: string): number | null {
  const days = Number.parseInt(value, 10);
  if (!Number.isFinite(days) || days < 1 || days > MAX_LAST_DAYS) return null;
  return days;
}

export function parseRunDateRange(url: URL): ParsedRunDateRange {
  const fromRaw = url.searchParams.get("from")?.trim();
  const toRaw = url.searchParams.get("to")?.trim();
  const lastDaysRaw = url.searchParams.get("last_days")?.trim();

  if (fromRaw || toRaw) {
    if (lastDaysRaw) {
      return {
        ok: false,
        error: "Use either from/to or last_days, not both",
        status: 400,
      };
    }

    let from: string | null = null;
    let to: string | null = null;
    if (fromRaw) {
      from = parseIsoTimestamp(fromRaw);
      if (!from) return { ok: false, error: "Invalid from date", status: 400 };
    }
    if (toRaw) {
      to = parseIsoTimestamp(toRaw);
      if (!to) return { ok: false, error: "Invalid to date", status: 400 };
    }
    if (from && to && from > to) {
      return { ok: false, error: "from must be before to", status: 400 };
    }
    return { ok: true, from, to };
  }

  if (lastDaysRaw) {
    const days = parseLastDays(lastDaysRaw);
    if (days == null) {
      return {
        ok: false,
        error: `Invalid last_days (integer from 1 to ${MAX_LAST_DAYS})`,
        status: 400,
      };
    }
    const to = new Date().toISOString();
    const from = new Date(Date.now() - days * 86_400_000).toISOString();
    return { ok: true, from, to };
  }

  return { ok: true, from: null, to: null };
}

export function appendRunAtRange(
  sql: string,
  range: { from: string | null; to: string | null },
  bindings: unknown[],
  column = "run_at"
): string {
  let next = sql;
  if (range.from) {
    next += ` AND ${column} >= ?`;
    bindings.push(range.from);
  }
  if (range.to) {
    next += ` AND ${column} <= ?`;
    bindings.push(range.to);
  }
  return next;
}
