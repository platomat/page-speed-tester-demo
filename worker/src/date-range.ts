export type ParsedRunDateRange =
  | { ok: true; from: string | null; to: string | null }
  | { ok: false; error: string; status: number };

function parseIsoTimestamp(value: string): string | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export function parseRunDateRange(url: URL): ParsedRunDateRange {
  const fromRaw = url.searchParams.get("from")?.trim();
  const toRaw = url.searchParams.get("to")?.trim();
  if (!fromRaw && !toRaw) {
    return { ok: true, from: null, to: null };
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
