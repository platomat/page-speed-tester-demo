import type { Env } from "./env";

export function normalizeReportKey(reportKey: string): string {
  let key = reportKey.trim().replace(/^\/+/, "");
  if (key.includes("%")) {
    try {
      key = decodeURIComponent(key);
    } catch {
      // keep as-is
    }
  }
  return key;
}

export function parseReportObjectFilename(filename: string): {
  runStamp: string;
  strategy: string;
  identifier: string;
} | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2}T\d{6}Z)-(desktop|mobile)-(.+)\.json$/);
  if (!match) return null;
  return { runStamp: match[1], strategy: match[2], identifier: match[3] };
}

export function reportKeyParts(reportKey: string): { projectId: string; filename: string } | null {
  const normalized = normalizeReportKey(reportKey);
  const match = normalized.match(/^reports\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { projectId: match[1], filename: match[2] };
}

/** Load Lighthouse JSON from R2; falls back to same run stamp + strategy if identifier slug differs. */
export async function resolveReportObject(
  env: Env,
  reportKey: string,
  projectId: string
): Promise<{ object: R2ObjectBody; key: string } | null> {
  const normalized = normalizeReportKey(reportKey);

  let object = await env.REPORTS.get(normalized);
  if (object) return { object, key: normalized };

  const filename = normalized.split("/").pop() ?? "";
  const parsed = parseReportObjectFilename(filename);
  if (!parsed) return null;

  const prefix = `reports/${projectId}/${parsed.runStamp}-${parsed.strategy}-`;
  let cursor: string | undefined;
  do {
    const listing = await env.REPORTS.list({ prefix, limit: 100, cursor });
    for (const item of listing.objects) {
      if (!item.key.endsWith(".json")) continue;
      object = await env.REPORTS.get(item.key);
      if (object) return { object, key: item.key };
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return null;
}
