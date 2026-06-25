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

export interface ReportLookupDiagnostics {
  /** Worker binding the lookup used. */
  binding: string;
  /** Configured bucket name on that binding. */
  binding_bucket: string;
  project_prefix: string;
  /** Objects the binding sees under reports/<projectId>/. */
  objects_under_project_prefix: number;
  /** First few keys the binding actually sees (for slug/key drift checks). */
  sample_keys: string[];
  /** Whether the binding sees ANY object under reports/. */
  bucket_has_any_reports: boolean;
  /** Whether the exact requested key is visible to the binding right now. */
  exact_key_visible_to_binding: boolean;
}

/**
 * Reports what the Worker R2 binding actually sees, to distinguish a real
 * "missing object" from a binding↔bucket wiring problem (wrong bucket name,
 * wrong jurisdiction, or different account than the S3 upload writes to).
 */
export async function diagnoseReportLookup(
  env: Env,
  reportKey: string,
  projectId: string,
  bindingBucket: string
): Promise<ReportLookupDiagnostics> {
  const normalized = normalizeReportKey(reportKey);
  const projectPrefix = `reports/${projectId}/`;
  const [projectListing, rootListing, head] = await Promise.all([
    env.REPORTS.list({ prefix: projectPrefix, limit: 100 }),
    env.REPORTS.list({ prefix: "reports/", limit: 1 }),
    env.REPORTS.head(normalized),
  ]);
  return {
    binding: "REPORTS",
    binding_bucket: bindingBucket,
    project_prefix: projectPrefix,
    objects_under_project_prefix: projectListing.objects.length,
    sample_keys: projectListing.objects.slice(0, 5).map((o) => o.key),
    bucket_has_any_reports: rootListing.objects.length > 0,
    exact_key_visible_to_binding:
      head != null || projectListing.objects.some((o) => o.key === normalized),
  };
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
