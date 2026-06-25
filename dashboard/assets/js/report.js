const METRIC_IDS = [
  { id: "first-contentful-paint", label: "First Contentful Paint" },
  { id: "largest-contentful-paint", label: "Largest Contentful Paint" },
  { id: "total-blocking-time", label: "Total Blocking Time" },
  { id: "cumulative-layout-shift", label: "Cumulative Layout Shift" },
  { id: "speed-index", label: "Speed Index" },
];

const CATEGORY_IDS = [
  { id: "performance", label: "Performance" },
  { id: "accessibility", label: "Accessibility" },
  { id: "best-practices", label: "Best Practices" },
  { id: "seo", label: "SEO" },
];

function scorePercent(score) {
  if (score == null) return "—";
  return Math.round(score * 100);
}

function getOpportunities(audits, categories) {
  const seen = new Set();
  const items = [];

  for (const cat of CATEGORY_IDS) {
    for (const ref of categories?.[cat.id]?.auditRefs ?? []) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      const audit = audits[ref.id];
      if (!audit || audit.score == null || audit.score >= 0.9) continue;
      if (audit.scoreDisplayMode === "informative" || audit.scoreDisplayMode === "notApplicable") {
        continue;
      }
      items.push(audit);
    }
  }

  return items.sort((a, b) => (a.score ?? 1) - (b.score ?? 1)).slice(0, 12);
}

function renderCategoryScores(categories) {
  return CATEGORY_IDS.map(({ id, label }) => {
    const score = categories?.[id]?.score;
    const pct = scorePercent(score);
    return `
      <div class="category-score ${scoreClass(pct)}">
        <div class="category-score-value">${pct}</div>
        <div class="category-score-label">${label}</div>
      </div>`;
  }).join("");
}

function renderMetrics(audits) {
  return METRIC_IDS.map(({ id, label }) => {
    const audit = audits?.[id];
    const value = audit?.displayValue ?? "—";
    const pct = scorePercent(audit?.score);
    return `
      <div class="metric-card">
        <div class="label">${label}</div>
        <div class="value">${escapeHtml(value)}</div>
        <div class="metric-sub ${scoreClass(pct)}">Score: ${pct}</div>
      </div>`;
  }).join("");
}

function safeDataImageUrl(value) {
  if (typeof value !== "string") return null;
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)) return null;
  return value;
}

function auditScreenshotUrl(audit) {
  return safeDataImageUrl(audit?.details?.data);
}

function renderScreenshots(report) {
  const items = [];
  const viewportUrl = auditScreenshotUrl(report.audits?.["final-screenshot"]);
  if (viewportUrl) {
    items.push({ label: "Viewport", url: viewportUrl });
  }

  const fullPageAuditUrl = auditScreenshotUrl(report.audits?.["full-page-screenshot"]);
  const rootShot = report.fullPageScreenshot;
  const fullPageUrl =
    fullPageAuditUrl ||
    safeDataImageUrl(rootShot?.screenshot?.data) ||
    safeDataImageUrl(rootShot?.data);

  if (fullPageUrl) {
    items.push({ label: "Full page", url: fullPageUrl });
  }

  if (!items.length) return "";

  return `
    <section class="report-section">
      <h2>Screenshots</h2>
      <div class="report-screenshots">
        ${items
          .map(
            ({ label, url }) => `
          <figure class="report-screenshot">
            <figcaption>${escapeHtml(label)}</figcaption>
            <img src="${url}" alt="${escapeHtml(label)} screenshot" loading="lazy" decoding="async" />
          </figure>`
          )
          .join("")}
      </div>
    </section>`;
}

function renderOpportunities(opportunities) {
  if (!opportunities.length) {
    return '<p class="empty">No major opportunities flagged in this run.</p>';
  }

  return `
    <ul class="audit-list">
      ${opportunities
        .map(
          (audit) => `
        <li class="audit-item">
          <div class="audit-title">${escapeHtml(audit.title)}</div>
          ${audit.displayValue ? `<div class="audit-value">${escapeHtml(audit.displayValue)}</div>` : ""}
          ${audit.description ? `<p class="audit-desc">${escapeHtml(audit.description.replace(/\s+/g, " ").slice(0, 280))}${audit.description.length > 280 ? "…" : ""}</p>` : ""}
        </li>`
        )
        .join("")}
    </ul>`;
}

function buildNavContext(reports, reportKey) {
  const paired = pairReports(reports);
  let currentIndex = -1;
  let currentStrategy = null;

  for (let i = 0; i < paired.length; i++) {
    const row = paired[i];
    if (row.desktop?.report_key === reportKey) {
      currentIndex = i;
      currentStrategy = "desktop";
      break;
    }
    if (row.mobile?.report_key === reportKey) {
      currentIndex = i;
      currentStrategy = "mobile";
      break;
    }
  }

  return { paired, currentIndex, currentStrategy };
}

function reportAt(paired, index, strategy) {
  if (index < 0 || index >= paired.length) return null;
  return paired[index][strategy];
}

function navigateToReport(reportKey) {
  const url = new URL(window.location.href);
  url.searchParams.set("key", reportKey);
  const shareToken = getPublicShareKey();
  if (shareToken) {
    url.searchParams.set("share", shareToken);
  }
  window.history.pushState({ reportKey }, "", url);
  loadReport(reportKey);
}

function reportNavRoots() {
  return [document.getElementById("report-nav"), document.getElementById("report-nav-bottom")];
}

function setReportNavVisible(visible) {
  for (const root of reportNavRoots()) {
    if (!root) continue;
    root.classList.toggle("hidden", !visible);
  }
}

function attachReportNavHandlers(root, { olderReport, otherReport, newerReport }) {
  root.querySelector('[data-report-nav="prev"]')?.addEventListener("click", () => {
    if (olderReport) navigateToReport(olderReport.report_key);
  });
  root.querySelector('[data-report-nav="switch"]')?.addEventListener("click", () => {
    if (otherReport) navigateToReport(otherReport.report_key);
  });
  root.querySelector('[data-report-nav="next"]')?.addEventListener("click", () => {
    if (newerReport) navigateToReport(newerReport.report_key);
  });
}

function renderReportNav(nav) {
  if (!nav || nav.currentIndex < 0) {
    setReportNavVisible(false);
    return;
  }

  const { paired, currentIndex, currentStrategy } = nav;
  const otherStrategy = currentStrategy === "desktop" ? "mobile" : "desktop";
  const otherReport = reportAt(paired, currentIndex, otherStrategy);
  const olderReport = reportAt(paired, currentIndex + 1, currentStrategy);
  const newerReport = reportAt(paired, currentIndex - 1, currentStrategy);

  const html = `
    <button type="button" data-report-nav="prev" ${olderReport ? "" : "disabled"}>← Previous</button>
    <button type="button" data-report-nav="switch" class="report-nav-switch" ${
      otherReport ? "" : "disabled"
    }>${otherStrategy === "mobile" ? "Mobile" : "Desktop"}</button>
    <button type="button" data-report-nav="next" ${newerReport ? "" : "disabled"}>Next →</button>`;

  const ctx = { olderReport, otherReport, newerReport };
  for (const root of reportNavRoots()) {
    if (!root) continue;
    root.innerHTML = html;
    attachReportNavHandlers(root, ctx);
  }
  setReportNavVisible(true);
}

function renderReport(report, reportKey) {
  const audits = report.audits ?? {};
  const categories = report.categories ?? {};
  const opportunities = getOpportunities(audits, categories);
  const formFactor = report.configSettings?.formFactor ?? "unknown";
  const deviceLabel =
    formFactor === "desktop" ? "Desktop" : formFactor === "mobile" ? "Mobile" : formFactor;
  const jsonUrl = reportJsonUrl(reportKey);
  const pageUrl = report.finalUrl ?? report.requestedUrl ?? "";

  document.title = `Report — ${pageUrl || "Page Speed"}`;
  document.getElementById("report-meta").innerHTML = `
    ${formatDateTime(report.fetchTime)}
    · ${escapeHtml(deviceLabel)}
    · <a href="${escapeHtml(pageUrl || "#")}" target="_blank" rel="noopener">${escapeHtml(pageUrl)}</a>
    · <a href="${jsonUrl}" target="_blank" rel="noopener">Raw JSON</a>`;

  document.getElementById("report-root").innerHTML = `
    <section class="category-scores">${renderCategoryScores(categories)}</section>

    <section class="report-section">
      <h2>Core Metrics</h2>
      <div class="latest-cards">${renderMetrics(audits)}</div>
    </section>

    ${renderScreenshots(report)}

    <section class="report-section">
      <h2>Opportunities</h2>
      ${renderOpportunities(opportunities)}
    </section>

    <section class="report-section report-meta-grid">
      <div><span class="meta-label">Lighthouse</span> ${escapeHtml(report.lighthouseVersion ?? "—")}</div>
      <div><span class="meta-label">User agent</span> ${escapeHtml((report.userAgent ?? "—").slice(0, 120))}</div>
      <div><span class="meta-label">Viewport</span> ${report.configSettings?.screenEmulation?.width ?? "—"} × ${report.configSettings?.screenEmulation?.height ?? "—"}</div>
    </section>`;
}

function syncShareTokenFromUrl() {
  restorePublicShareKeyFromPage();
}

async function loadReport(reportKey) {
  syncShareTokenFromUrl();
  const shareToken = getPublicShareKey();
  const data = shareToken
    ? await apiPublic(
        `/api/public/share/report?report_key=${encodeURIComponent(reportKey)}`
      )
    : await api(`/api/reports?key=${encodeURIComponent(reportKey)}`);
  if (data.timezone) setInstanceTimezone(data.timezone);
  const report = data.lighthouse ?? data;
  const run = data.run ?? null;
  renderReport(report, reportKey);
  window.scrollTo(0, 0);

  if (!run?.project_id || !run?.url_id) {
    setReportNavVisible(false);
    return;
  }

  const reportsData = shareToken
    ? await apiPublic(
        `/api/public/share/${encodeURIComponent(run.project_id)}/reports?url_id=${encodeURIComponent(run.url_id)}`
      )
    : await api(
        `/api/reports?project_id=${encodeURIComponent(run.project_id)}&url_id=${encodeURIComponent(run.url_id)}`
      );
  renderReportNav(buildNavContext(reportsData.reports ?? [], reportKey));
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const shareToken = restorePublicShareKeyFromPage();
  if (shareToken) {
    document.getElementById("site-header")?.setAttribute("data-auth", "false");
    await initSiteHeader();
  } else {
    const user = await initSiteHeader();
    if (!user) return;
  }

  await loadInstanceSettings();

  const reportKey = params.get("key");

  if (!reportKey) {
    document.getElementById("report-root").innerHTML =
      '<p class="error">Missing report key. Use <code>/report?key=reports/{project_id}/{filename}</code></p>';
    document.getElementById("report-meta").textContent = "";
    setReportNavVisible(false);
    return;
  }

  window.addEventListener("popstate", () => {
    syncShareTokenFromUrl();
    const key = new URLSearchParams(window.location.search).get("key");
    if (key) loadReport(key);
  });

  try {
    await loadReport(reportKey);
  } catch (err) {
    document.getElementById("report-root").innerHTML = `<p class="error">Failed to load report: ${escapeHtml(err.message)}</p>`;
    document.getElementById("report-meta").textContent = "";
    setReportNavVisible(false);
  }
}

init();
