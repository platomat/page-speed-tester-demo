function resolveApiUrl() {
  const override = window.PST_API_URL?.trim();
  if (override) return override.replace(/\/$/, "");

  const { protocol, hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:8787";
  }

  // API host (direct navigation) — same origin
  if (hostname.startsWith("api.")) {
    return window.location.origin.replace(/\/$/, "");
  }

  // *.pages.dev / *.workers.dev — Worker URL is not derivable from Pages hostname
  if (hostname.endsWith(".pages.dev") || hostname.endsWith(".workers.dev")) {
    return window.location.origin.replace(/\/$/, "");
  }

  // Default: dashboard on host X → API on api.X (custom domain)
  return `${protocol}//api.${hostname}`;
}

const API_URL = resolveApiUrl();

let instanceTimezone = "UTC";
let publicShareKey = null;

function setPublicShareKey(key) {
  publicShareKey = key?.trim() || null;
}

function getPublicShareKey() {
  return publicShareKey;
}

function isPublicShareMode() {
  return Boolean(publicShareKey);
}

async function apiPublic(path, options = {}) {
  if (!publicShareKey) {
    throw new Error("Share key missing");
  }
  const url = new URL(`${API_URL}${path}`);
  url.searchParams.set("share_key", publicShareKey);
  const response = await fetch(url, {
    credentials: "omit",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    const err = new Error(data?.error || `API ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function loadInstanceSettings() {
  try {
    const data = await api("/api/settings");
    if (data?.timezone) instanceTimezone = data.timezone;
  } catch {
    instanceTimezone = "UTC";
  }
  return instanceTimezone;
}

function getInstanceTimezone() {
  return instanceTimezone;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    const err = new Error(data?.error || `API ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function requireAuth() {
  try {
    const { user } = await api("/api/auth/me");
    return user;
  } catch {
    window.location.href = "login.html";
    return null;
  }
}

function reportJsonUrl(reportKey) {
  if (publicShareKey) {
    const params = new URLSearchParams({
      share_key: publicShareKey,
      report_key: String(reportKey),
    });
    return `${API_URL}/api/public/share/report?${params}`;
  }
  const match = String(reportKey).match(/^reports\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid report key: ${reportKey}`);
  }
  const [, projectId, filename] = match;
  return `${API_URL}/api/reports/${encodeURIComponent(projectId)}/${encodeURIComponent(filename)}`;
}

function reportDetailUrl(reportKey) {
  const params = new URLSearchParams({ key: reportKey });
  if (publicShareKey) {
    params.set("share", publicShareKey);
  }
  return `report?${params}`;
}

function publicTriggerUrl(projectId, accessKey, urlId) {
  const params = new URLSearchParams({ key: accessKey });
  if (urlId) params.set("url_id", urlId);
  return `${API_URL}/api/public/trigger/${encodeURIComponent(projectId)}?${params}`;
}

function publicShareDashboardUrl(projectId, shareToken) {
  const params = new URLSearchParams({ project: projectId, key: shareToken });
  const base = window.location.href.replace(/[#?].*$/, "").replace(/[^/]+$/, "");
  return `${base}share.html?${params}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Lighthouse metric thresholds (Core Web Vitals / Lighthouse v10 scoring bands)
function metricRating(metricKey, value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const v = Number(value);
  switch (metricKey) {
    case "performance":
      if (v >= 90) return "good";
      if (v >= 50) return "warn";
      return "bad";
    case "lcp_ms":
      if (v <= 2500) return "good";
      if (v <= 4000) return "warn";
      return "bad";
    case "fcp_ms":
      if (v <= 1800) return "good";
      if (v <= 3000) return "warn";
      return "bad";
    case "tbt_ms":
      if (v <= 200) return "good";
      if (v <= 600) return "warn";
      return "bad";
    case "cls":
      if (v <= 0.1) return "good";
      if (v <= 0.25) return "warn";
      return "bad";
    case "speed_index":
      if (v <= 3400) return "good";
      if (v <= 5800) return "warn";
      return "bad";
    default:
      return null;
  }
}

function metricScoreClass(metricKey, value) {
  const rating = metricRating(metricKey, value);
  if (rating === "good") return "score-good";
  if (rating === "warn") return "score-warn";
  if (rating === "bad") return "score-bad";
  return "";
}

function ratingColor(rating) {
  if (rating === "good") return "#22c55e";
  if (rating === "warn") return "#eab308";
  if (rating === "bad") return "#ef4444";
  return "#8b9cb3";
}

function scoreClass(score) {
  return metricScoreClass("performance", score);
}

function parseRunDate(run) {
  const raw = run?.run_at?.trim();
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const stamped = run?.report_key?.match(/(\d{4}-\d{2}-\d{2}T\d{6}Z)/);
  if (stamped) {
    const ts = stamped[1];
    return new Date(
      `${ts.slice(0, 10)}T${ts.slice(11, 13)}:${ts.slice(13, 15)}:${ts.slice(15, 17)}.000Z`
    );
  }
  return null;
}

function formatDateTime(isoOrRun) {
  const d =
    typeof isoOrRun === "object" && isoOrRun !== null
      ? parseRunDate(isoOrRun)
      : isoOrRun
        ? new Date(isoOrRun)
        : null;
  if (!d || Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: instanceTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .slice(0, 16);
}

function runStampFromReport(report) {
  const stamped = report.report_key?.match(/(\d{4}-\d{2}-\d{2}T\d{6}Z)/);
  if (stamped) return stamped[1];
  const d = parseRunDate(report);
  if (d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const h = String(d.getUTCHours()).padStart(2, "0");
    const min = String(d.getUTCMinutes()).padStart(2, "0");
    const s = String(d.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${day}T${h}${min}${s}Z`;
  }
  return `id-${report.id}`;
}

function pairReports(reports) {
  const byStamp = new Map();
  for (const report of reports) {
    const stamp = runStampFromReport(report);
    if (!byStamp.has(stamp)) {
      byStamp.set(stamp, { stamp, desktop: null, mobile: null });
    }
    const entry = byStamp.get(stamp);
    if (report.strategy === "desktop") entry.desktop = report;
    else if (report.strategy === "mobile") entry.mobile = report;
  }
  return [...byStamp.values()].sort((a, b) => {
    const da = parseRunDate(a.desktop ?? a.mobile)?.getTime() ?? 0;
    const db = parseRunDate(b.desktop ?? b.mobile)?.getTime() ?? 0;
    return db - da;
  });
}

function sortProjectUrls(urls) {
  function rank(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\/$/, "") || "/";
      const depth = path === "/" ? 0 : path.split("/").filter(Boolean).length;
      return { depth, sortKey: `${u.origin}${path}` };
    } catch {
      return { depth: 999, sortKey: url };
    }
  }
  return [...urls].sort((a, b) => {
    const ra = rank(a.url);
    const rb = rank(b.url);
    if (ra.depth !== rb.depth) return ra.depth - rb.depth;
    return ra.sortKey.localeCompare(rb.sortKey);
  });
}
