const charts = {};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      filter(item) {
        return item.dataset.label !== "Average";
      },
    },
    chartAverageLabel: { metricKey: null },
  },
  scales: {
    x: {
      ticks: { color: "#8b9cb3", maxRotation: 45 },
      grid: { color: "#2d3a4d" },
    },
    y: {
      ticks: { color: "#8b9cb3" },
      grid: { color: "#2d3a4d" },
    },
  },
};

function chartOptions(metricKey) {
  return {
    ...chartDefaults,
    plugins: {
      ...chartDefaults.plugins,
      chartAverageLabel: { metricKey },
      tooltip: {
        ...chartDefaults.plugins.tooltip,
        callbacks: {
          label(context) {
            const y = context.parsed?.y;
            return `${context.dataset.label}: ${formatChartValue(metricKey, y)}`;
          },
        },
      },
    },
    scales: {
      ...chartDefaults.scales,
      y: {
        ...chartDefaults.scales.y,
        ticks: {
          ...chartDefaults.scales.y.ticks,
          callback(value) {
            return formatChartValue(metricKey, value);
          },
        },
      },
    },
  };
}

function syncChartAverageLabel(chart) {
  const metricKey = chart.options.plugins?.chartAverageLabel?.metricKey;
  const canvas = chart.canvas;
  const wrap = canvas?.closest(".chart-wrap");
  if (!wrap || !metricKey) return;

  const avgDataset = chart.data.datasets.find((d) => d.label === "Average");
  const avg = avgDataset?.data?.[0];
  let label = wrap.querySelector(".chart-avg-label");

  if (avg == null) {
    label?.remove();
    return;
  }

  if (!label) {
    label = document.createElement("span");
    label.className = "chart-avg-label";
    wrap.appendChild(label);
  }

  label.textContent = `Ø ${formatChartAverage(metricKey, avg)}`;

  const yScale = chart.scales?.y;
  const { chartArea } = chart;
  if (!yScale || !chartArea) return;

  const y = yScale.getPixelForValue(avg);
  const scaleY = canvas.clientHeight / canvas.height || 1;
  const displayY = y * scaleY;
  const halfH = (label.offsetHeight || 18) / 2;
  const minY = chartArea.top * scaleY + halfH;
  const maxY = chartArea.bottom * scaleY - halfH;
  const clampedY = Math.min(Math.max(displayY, minY), maxY);

  label.style.top = `${clampedY}px`;
}

const chartAverageLabelPlugin = {
  id: "chartAverageLabel",
  afterUpdate(chart) {
    syncChartAverageLabel(chart);
  },
};

if (typeof Chart !== "undefined") {
  Chart.register(chartAverageLabelPlugin);
}

function resizeAllCharts() {
  for (const chart of Object.values(charts)) {
    chart.resize();
  }
}

let chartResizeObserver;

function initChartResize() {
  if (chartResizeObserver) return;
  const section = document.querySelector(".charts");
  if (!section) return;
  chartResizeObserver = new ResizeObserver(() => resizeAllCharts());
  chartResizeObserver.observe(section);
  window.addEventListener("resize", resizeAllCharts);
}

const METRICS = [
  { key: "performance", label: "Performance", chart: "performance", format: (v) => v },
  { key: "fcp_ms", label: "FCP", chart: "fcp", format: (v) => formatMetric(v, "ms") },
  { key: "lcp_ms", label: "LCP", chart: "lcp", format: (v) => formatMetric(v, "ms") },
  { key: "tbt_ms", label: "TBT", chart: "tbt", format: (v) => formatMetric(v, "ms") },
  { key: "cls", label: "CLS", chart: "cls", format: (v) => formatMetric(v, "", "cls") },
  { key: "speed_index", label: "SI", chart: "si", format: (v) => formatMetric(v, "ms") },
];

let currentUser = null;
let projects = [];
/** @type {Map<string, Array<{id: string, name: string, url: string}>>} */
const projectUrls = new Map();

const RUN_STATUS_POLL_MS = 15_000;
let runStatusPollTimer = null;
let runStatusProjectId = null;
let wasRunStatusActive = false;
let cachedRunStatus = { running: false };
/** @type {{ projectId: string, shareKey: string } | null} */
let shareContext = null;

function isSharePage() {
  return document.getElementById("site-header")?.dataset.page === "share";
}

function parseShareContext() {
  if (!isSharePage()) return null;
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project")?.trim();
  const shareKey = params.get("key")?.trim();
  if (!projectId || !shareKey) return null;
  return { projectId, shareKey };
}

function scopeValue(projectId, urlId = null) {
  return urlId ? `url:${projectId}:${urlId}` : `project:${projectId}`;
}

function parseScopeValue(value) {
  if (!value) return { projectId: null, urlId: null };
  if (value.startsWith("project:")) {
    return { projectId: value.slice(8), urlId: null };
  }
  if (value.startsWith("url:")) {
    const rest = value.slice(4);
    const sep = rest.indexOf(":");
    if (sep === -1) return { projectId: null, urlId: null };
    return { projectId: rest.slice(0, sep), urlId: rest.slice(sep + 1) };
  }
  return { projectId: null, urlId: null };
}

function getScope() {
  const parsed = parseScopeValue(document.getElementById("scope-select")?.value ?? "");
  if (shareContext) {
    return { projectId: shareContext.projectId, urlId: parsed.urlId };
  }
  return parsed;
}

function formatDecimalPlaces(value, places) {
  return Number(value)
    .toFixed(places)
    .replace(/\.?0+$/, "");
}

/** Chart tooltips, y-axis, and cards — CLS uses 4 decimals (Lighthouse numericValue is float). */
function formatChartValue(metricKey, value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const v = Number(value);
  switch (metricKey) {
    case "performance":
      return String(Math.round(v));
    case "fcp_ms":
    case "lcp_ms":
    case "tbt_ms":
    case "speed_index":
      return `${Math.round(v)} ms`;
    case "cls":
      return formatDecimalPlaces(v, 4);
    default:
      return String(v);
  }
}

function formatMetric(value, unit = "", metricKey = null) {
  if (value == null) return "—";
  if (metricKey === "cls") return formatDecimalPlaces(value, 4);
  if (unit === "ms") return `${Math.round(value)} ms`;
  if (typeof value === "number" && value < 10 && !unit) return value.toFixed(3);
  return `${Math.round(value)}${unit}`;
}

function buildChartDataset(data, metricKey) {
  const pointColors = data.map((v) => ratingColor(metricRating(metricKey, v)));
  return {
    label: "Measurements",
    data,
    borderWidth: 2,
    tension: 0.2,
    fill: false,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointBackgroundColor: pointColors,
    pointBorderColor: pointColors,
    segment: {
      borderColor(ctx) {
        const y = ctx.p1?.parsed?.y;
        if (y == null) return "#8b9cb3";
        return ratingColor(metricRating(metricKey, y));
      },
    },
  };
}

function chartAverage(values) {
  const nums = values
    .map((v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v)))
    .filter((v) => v != null);
  if (nums.length < 2) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function roundAverage(value) {
  return Math.round(value * 100) / 100;
}

function formatAverageNumber(value) {
  return roundAverage(value)
    .toFixed(2)
    .replace(/\.?0+$/, "");
}

function formatChartAverage(metricKey, avg) {
  if (metricKey === "cls") return formatDecimalPlaces(avg, 4);
  const n = formatAverageNumber(avg);
  switch (metricKey) {
    case "fcp_ms":
    case "lcp_ms":
    case "tbt_ms":
    case "speed_index":
      return `${n} ms`;
    default:
      return n;
  }
}

function buildAverageDataset(data) {
  const avg = chartAverage(data);
  if (avg == null) return null;
  return {
    label: "Average",
    data: data.map(() => avg),
    borderColor: "rgba(139, 156, 179, 0.9)",
    borderWidth: 1.5,
    borderDash: [6, 4],
    pointRadius: 0,
    pointHoverRadius: 0,
    fill: false,
    tension: 0,
    order: 1,
    tooltip: { enabled: false },
  };
}

function buildChartDatasets(data, metricKey) {
  const datasets = [buildChartDataset(data, metricKey)];
  const average = buildAverageDataset(data);
  if (average) datasets.push(average);
  return datasets;
}

function upsertChart(id, labels, data, metricKey) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) {
    charts[id].data.labels = labels;
    charts[id].data.datasets = buildChartDatasets(data, metricKey);
    charts[id].options = chartOptions(metricKey);
    charts[id].update();
    resizeAllCharts();
    return;
  }
  charts[id] = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: buildChartDatasets(data, metricKey),
    },
    options: chartOptions(metricKey),
  });
}

function renderMetricCards(runs, deviceLabel) {
  if (!runs.length) {
    return `<p class="empty">No ${deviceLabel.toLowerCase()} measurements yet.</p>`;
  }
  const latest = runs[runs.length - 1];
  return `<div class="latest-cards">${METRICS.map((m) => {
    const value = latest[m.key];
    return `
    <div class="metric-card">
      <div class="label">${m.label}</div>
      <div class="value ${metricScoreClass(m.key, value)}">
        ${value != null ? (m.key === "performance" ? value : m.format(value)) : "—"}
      </div>
    </div>`;
  }).join("")}</div>`;
}

function emptyMeasurementsHtml() {
  if (shareContext) {
    return '<p class="empty">No measurements yet.</p>';
  }
  return '<p class="empty">No measurements yet — click Run now or wait for the scheduled test.</p>';
}

function renderLatest(desktopRuns, mobileRuns) {
  const container = document.getElementById("latest");
  if (!desktopRuns.length && !mobileRuns.length) {
    container.innerHTML = emptyMeasurementsHtml();
    return;
  }
  container.innerHTML = `
    <div class="latest-row">
      <div class="latest-group">
        <h2 class="latest-heading">Latest <span class="chart-device">Desktop</span></h2>
        ${renderMetricCards(desktopRuns, "Desktop")}
      </div>
      <div class="latest-group">
        <h2 class="latest-heading">Latest <span class="chart-device">Mobile</span></h2>
        ${renderMetricCards(mobileRuns, "Mobile")}
      </div>
    </div>`;
}

function renderCharts(desktopRuns, mobileRuns) {
  for (const metric of METRICS) {
    if (!metric.chart) continue;
    upsertChart(
      `chart-${metric.chart}-desktop`,
      desktopRuns.map((r) => formatDateTime(r)),
      desktopRuns.map((r) => r[metric.key]),
      metric.key
    );
    upsertChart(
      `chart-${metric.chart}-mobile`,
      mobileRuns.map((r) => formatDateTime(r)),
      mobileRuns.map((r) => r[metric.key]),
      metric.key
    );
  }
}

const ICON_DETAILS = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`;

const ICON_JSON = `<span class="json-label" aria-hidden="true">{}</span>`;

const ICON_DELETE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;

function renderDeviceCell(report, deviceLabel) {
  if (!report) {
    return '<td class="report-device-col"><span class="report-missing">—</span></td>';
  }
  const detailLabel = `${deviceLabel} report details`;
  const jsonLabel = `${deviceLabel} raw JSON`;
  return `
    <td class="report-device-col">
      <div class="report-device-cell">
        <span class="report-score ${scoreClass(report.performance)}">${report.performance ?? "—"}</span>
        <div class="report-actions">
          <a href="${reportDetailUrl(report.report_key)}" class="icon-btn" title="Details" aria-label="${detailLabel}">${ICON_DETAILS}</a>
          <a href="${reportJsonUrl(report.report_key)}" class="icon-btn icon-btn-json" target="_blank" rel="noopener" title="JSON" aria-label="${jsonLabel}">${ICON_JSON}</a>
        </div>
      </div>
    </td>`;
}

function renderTriggerCell(report) {
  const source = report?.trigger_source === "cron" ? "cron" : "manual";
  const label = source === "cron" ? "Cron" : "Manual";
  return `<td><span class="trigger-badge trigger-badge--${source}">${label}</span></td>`;
}

function renderReportsTable(reports, projectId, urlId) {
  const tbody = document.querySelector("#reports-table tbody");
  const paired = pairReports(reports);
  const colCount = shareContext ? 4 : 5;
  if (!paired.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty">No reports available</td></tr>`;
    return;
  }
  tbody.innerHTML = paired
    .map((row) => {
      const ref = row.desktop ?? row.mobile;
      const reportKeys = [row.desktop?.report_key, row.mobile?.report_key].filter(Boolean);
      const keysAttr = escapeHtml(JSON.stringify(reportKeys));
      const deleteCol = shareContext
        ? ""
        : `<td class="report-actions-col">
        <button type="button" class="icon-btn icon-btn-danger" data-delete-run="${keysAttr}" title="Delete run" aria-label="Delete test run (desktop and mobile)">${ICON_DELETE}</button>
      </td>`;
      return `
    <tr>
      <td>${formatDateTime(ref)}</td>
      ${renderTriggerCell(ref)}
      ${renderDeviceCell(row.desktop, "Desktop")}
      ${renderDeviceCell(row.mobile, "Mobile")}
      ${deleteCol}
    </tr>`;
    })
    .join("");

  if (shareContext) return;

  tbody.querySelectorAll("[data-delete-run]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const keys = JSON.parse(btn.getAttribute("data-delete-run"));
      if (
        !confirm(
          "Delete this test run (desktop + mobile) and remove the JSON files from storage?"
        )
      ) {
        return;
      }
      try {
        btn.disabled = true;
        await api("/api/reports", {
          method: "DELETE",
          body: JSON.stringify({
            project_id: projectId,
            url_id: urlId,
            report_keys: keys,
          }),
        });
        await loadData();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

async function loadAllProjectUrls() {
  projectUrls.clear();
  await Promise.all(
    projects.map(async (project) => {
      const { urls } = await api(`/api/projects/${encodeURIComponent(project.id)}/urls`);
      projectUrls.set(project.id, sortProjectUrls(urls ?? []));
    })
  );
}

function renderScopeSelect(selectedValue) {
  const select = document.getElementById("scope-select");
  if (!select) return;

  if (shareContext) {
    const urls = projectUrls.get(shareContext.projectId) ?? [];
    const project = projects.find((p) => p.id === shareContext.projectId);
    const groupLabel = project?.name ?? shareContext.projectId;
    select.innerHTML = urls.length
      ? `<optgroup label="${escapeHtml(groupLabel)}">${urls
          .map(
            (u) =>
              `<option value="${escapeHtml(scopeValue(shareContext.projectId, u.id))}"> — ${escapeHtml(u.name)} → ${escapeHtml(u.url)}</option>`
          )
          .join("")}</optgroup>`
      : `<option value="">No URLs</option>`;

    const fallback = urls.length ? scopeValue(shareContext.projectId, urls[0].id) : "";
    if (selectedValue && select.querySelector(`option[value="${CSS.escape(selectedValue)}"]`)) {
      select.value = selectedValue;
    } else {
      select.value = fallback;
    }
    return;
  }

  select.innerHTML = projects
    .map((project) => {
      const urls = projectUrls.get(project.id) ?? [];
      const options = [
        `<option value="${escapeHtml(scopeValue(project.id))}">[All URLs in project] → ${escapeHtml(project.name)}</option>`,
        ...urls.map(
          (u) =>
            `<option value="${escapeHtml(scopeValue(project.id, u.id))}"> — ${escapeHtml(u.name)} → ${escapeHtml(u.url)}</option>`
        ),
      ].join("");
      return `<optgroup label="${escapeHtml(project.name)}">${options}</optgroup>`;
    })
    .join("");

  const fallback = projects.length ? scopeValue(projects[0].id) : "";
  if (selectedValue && select.querySelector(`option[value="${CSS.escape(selectedValue)}"]`)) {
    select.value = selectedValue;
  } else {
    select.value = fallback;
  }
}

function setUrlMetricsPanelsVisible(visible) {
  document.querySelectorAll(".url-metrics-panel").forEach((el) => {
    el.classList.toggle("hidden", !visible);
  });
}

function showUrlScopeView(desktopRuns, mobileRuns) {
  document.getElementById("project-scope-panel")?.classList.add("hidden");
  const runBtn = document.getElementById("run-btn");
  if (runBtn) runBtn.disabled = Boolean(cachedRunStatus?.running);

  const hasData = desktopRuns.length > 0 || mobileRuns.length > 0;
  document.getElementById("latest")?.classList.remove("hidden");
  document.querySelector(".charts")?.classList.toggle("hidden", !hasData);
  document.querySelector(".reports-section")?.classList.toggle("hidden", !hasData);
}

function githubRunLinkHtml(status) {
  if (!status?.github_run_url) return "";
  return ` <a href="${escapeHtml(status.github_run_url)}" target="_blank" rel="noopener noreferrer">View on GitHub Actions</a>`;
}

function runStatusDismissHtml() {
  return ` <button type="button" class="status-hint-dismiss btn-secondary" data-run-status-dismiss title="Clear dashboard status only — does not cancel GitHub Actions">Dismiss</button>`;
}

function buildProjectScopeMessage(status, { justFinished = false, projectId = getScope().projectId } = {}) {
  const project = projects.find((p) => p.id === projectId);
  const name = escapeHtml(project?.name ?? "this project");
  const ghLink = githubRunLinkHtml(status);

  if (status?.running) {
    const scope = escapeHtml(urlScopeLabel(status.url_ids, projectId));
    const dismiss = runStatusDismissHtml();
    if (status.state === "pending") {
      return {
        spinner: true,
        html: `Lighthouse test is starting for ${scope}…${ghLink}${dismiss}`,
      };
    }
    return {
      spinner: true,
      html: `Lighthouse test is running for ${scope}…${ghLink}${dismiss}`,
    };
  }

  if (justFinished) {
    return {
      spinner: false,
      html: `Test finished for the project. Select a URL under <strong>${name}</strong> to view metrics and reports.`,
    };
  }

  return {
    spinner: false,
    html: `Project-wide scope selected. Run a test for all URLs, or pick a single URL under <strong>${name}</strong> to view metrics and reports.`,
  };
}

function renderProjectScopeView(status = cachedRunStatus, options = {}) {
  const { projectId } = getScope();
  if (!projectId) return;

  cachedRunStatus = status ?? cachedRunStatus;
  setUrlMetricsPanelsVisible(false);
  document.getElementById("run-status").classList.add("hidden");

  const panel = document.getElementById("project-scope-panel");
  const { spinner, html } = buildProjectScopeMessage(cachedRunStatus, {
    ...options,
    projectId,
  });
  panel.classList.remove("hidden");
  panel.innerHTML = spinner
    ? `<span class="status-hint-spinner" aria-hidden="true"></span><span>${html}</span>`
    : `<span>${html}</span>`;

  const runBtnPanel = document.getElementById("run-btn");
  if (runBtnPanel) runBtnPanel.disabled = Boolean(cachedRunStatus?.running);
}

function showUrlMetricsView() {
  showUrlScopeView([], []);
}

async function loadData() {
  const { projectId, urlId } = getScope();
  if (!projectId) return;

  if (shareContext) {
    if (!urlId) {
      document.getElementById("latest").innerHTML =
        '<p class="empty">No URLs in this project.</p>';
      setUrlMetricsPanelsVisible(false);
      document.getElementById("latest").classList.remove("hidden");
      return;
    }

    showUrlMetricsView();
    const base = `/api/public/share/${encodeURIComponent(projectId)}`;
    const [desktopData, mobileData, reportsData] = await Promise.all([
      apiPublic(`${base}/metrics?url_id=${encodeURIComponent(urlId)}&strategy=desktop`),
      apiPublic(`${base}/metrics?url_id=${encodeURIComponent(urlId)}&strategy=mobile`),
      apiPublic(`${base}/reports?url_id=${encodeURIComponent(urlId)}`),
    ]);

    const desktopRuns = desktopData.runs ?? [];
    const mobileRuns = mobileData.runs ?? [];
    renderLatest(desktopRuns, mobileRuns);
    showUrlScopeView(desktopRuns, mobileRuns);
    if (desktopRuns.length > 0 || mobileRuns.length > 0) {
      renderCharts(desktopRuns, mobileRuns);
      renderReportsTable(reportsData.reports ?? [], projectId, urlId);
    }
    return;
  }

  if (!urlId) {
    try {
      const status = await api(`/api/projects/${encodeURIComponent(projectId)}/run-status`);
      cachedRunStatus = status;
      wasRunStatusActive = Boolean(status.running);
      renderProjectScopeView(status);
    } catch {
      renderProjectScopeView();
    }
    return;
  }

  showUrlMetricsView();
  const base = `/api/metrics?project_id=${encodeURIComponent(projectId)}&url_id=${encodeURIComponent(urlId)}`;
  const [desktopData, mobileData, reportsData] = await Promise.all([
    api(`${base}&strategy=desktop`),
    api(`${base}&strategy=mobile`),
    api(`/api/reports?project_id=${encodeURIComponent(projectId)}&url_id=${encodeURIComponent(urlId)}`),
  ]);

  const desktopRuns = desktopData.runs ?? [];
  const mobileRuns = mobileData.runs ?? [];
  renderLatest(desktopRuns, mobileRuns);
  showUrlScopeView(desktopRuns, mobileRuns);
  if (desktopRuns.length > 0 || mobileRuns.length > 0) {
    renderCharts(desktopRuns, mobileRuns);
    renderReportsTable(reportsData.reports ?? [], projectId, urlId);
  }
}

function stopRunStatusPolling() {
  if (runStatusPollTimer) {
    clearInterval(runStatusPollTimer);
    runStatusPollTimer = null;
  }
  runStatusProjectId = null;
}

function startRunStatusPolling(projectId) {
  stopRunStatusPolling();
  if (!projectId) return;
  runStatusProjectId = projectId;
  void pollRunStatus(projectId);
  runStatusPollTimer = setInterval(() => {
    void pollRunStatus(projectId);
  }, RUN_STATUS_POLL_MS);
}

function urlScopeLabel(urlIds, projectId = getScope().projectId) {
  const project = projects.find((p) => p.id === projectId);
  if (!urlIds?.length) {
    return project ? `all URLs in ${project.name}` : "all URLs in this project";
  }
  if (urlIds.length === 1 && projectId) {
    const opt = document.querySelector(
      `#scope-select option[value="${CSS.escape(scopeValue(projectId, urlIds[0]))}"]`
    );
    if (opt) return opt.textContent;
  }
  return `${urlIds.length} URLs`;
}

function renderRunStatus(status) {
  const { urlId } = getScope();
  if (!urlId) return;

  const el = document.getElementById("run-status");
  const runBtn = document.getElementById("run-btn");
  cachedRunStatus = status ?? cachedRunStatus;

  if (!status?.running) {
    el.classList.add("hidden");
    el.innerHTML = "";
    runBtn.disabled = false;
    return;
  }
  runBtn.disabled = true;
  el.classList.remove("hidden");
  const scope = escapeHtml(urlScopeLabel(status.url_ids));
  const ghLink = githubRunLinkHtml(status);
  const message =
    status.state === "pending"
      ? `Lighthouse test is starting for ${scope}…${ghLink}${runStatusDismissHtml()}`
      : `Lighthouse test is running for ${scope}…${ghLink}${runStatusDismissHtml()}`;
  el.innerHTML = `<span class="status-hint-spinner" aria-hidden="true"></span><span>${message}</span>`;
}

async function dismissRunStatus() {
  const { projectId, urlId } = getScope();
  if (!projectId) return;
  try {
    await api(`/api/projects/${encodeURIComponent(projectId)}/run-status`, {
      method: "DELETE",
    });
    wasRunStatusActive = false;
    cachedRunStatus = { running: false };
    if (urlId) {
      renderRunStatus(cachedRunStatus);
    } else {
      renderProjectScopeView(cachedRunStatus);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function pollRunStatus(projectId) {
  if (projectId !== runStatusProjectId) return;
  if (projectId !== getScope().projectId) return;
  try {
    const status = await api(`/api/projects/${encodeURIComponent(projectId)}/run-status`);
    const active = Boolean(status.running);
    const { urlId } = getScope();
    let justFinished = false;

    if (wasRunStatusActive && !active) {
      justFinished = true;
      if (urlId) await loadData();
    }

    wasRunStatusActive = active;
    cachedRunStatus = status;

    if (urlId) {
      renderRunStatus(status);
    } else {
      renderProjectScopeView(status, { justFinished });
    }
  } catch {
    // ignore transient poll errors
  }
}

async function onScopeChange() {
  const { projectId, urlId } = getScope();
  if (!projectId) return;

  const previousProjectId = runStatusProjectId;
  stopRunStatusPolling();
  if (previousProjectId && previousProjectId !== projectId) {
    wasRunStatusActive = false;
    cachedRunStatus = { running: false };
  }

  if (urlId) {
    await loadData();
    try {
      const status = await api(`/api/projects/${encodeURIComponent(projectId)}/run-status`);
      cachedRunStatus = status;
      wasRunStatusActive = Boolean(status.running);
      renderRunStatus(status);
    } catch {
      renderRunStatus({ running: false });
    }
  } else {
    renderProjectScopeView({ running: false });
    await loadData();
  }

  startRunStatusPolling(projectId);
}

async function initShareDashboard(ctx) {
  shareContext = ctx;
  setPublicShareKey(ctx.shareKey);

  await initSiteHeader();
  await loadInstanceSettings();
  initChartResize();

  document.getElementById("run-btn")?.classList.add("hidden");
  document.getElementById("run-status")?.classList.add("hidden");
  document.getElementById("project-scope-panel")?.classList.add("hidden");
  document.querySelector("#reports-table .report-actions-col")?.classList.add("hidden");

  const scopeLabel = document.querySelector('label[for="scope-select"]');
  if (scopeLabel) scopeLabel.textContent = "URL";

  try {
    const data = await apiPublic(`/api/public/share/${encodeURIComponent(ctx.projectId)}`);
    projects = [data.project];
    projectUrls.set(ctx.projectId, sortProjectUrls(data.urls ?? []));
  } catch (err) {
    const main = document.querySelector("main");
    main.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    return;
  }

  renderScopeSelect();
  showUrlScopeView([], []);
  document.getElementById("scope-select").addEventListener("change", () => {
    void loadData();
  });

  const { urlId } = getScope();
  if (urlId) {
    await loadData();
  }
}

async function init() {
  currentUser = await initSiteHeader();
  if (!currentUser) return;

  await loadInstanceSettings();
  initChartResize();

  const data = await api("/api/projects");
  projects = data.projects ?? [];

  await loadAllProjectUrls();
  renderScopeSelect();

  document.getElementById("scope-select").addEventListener("change", () => {
    void onScopeChange();
  });

  document.getElementById("run-btn").addEventListener("click", async () => {
    const { projectId, urlId } = getScope();
    if (!projectId) return;
    try {
      if (urlId) {
        await api(
          `/api/projects/${encodeURIComponent(projectId)}/urls/${encodeURIComponent(urlId)}/trigger`,
          { method: "POST" }
        );
      } else {
        await api(`/api/projects/${encodeURIComponent(projectId)}/trigger`, { method: "POST" });
      }
      wasRunStatusActive = true;
      cachedRunStatus = {
        running: true,
        state: "pending",
        url_ids: urlId ? [urlId] : [],
      };
      if (urlId) {
        renderRunStatus(cachedRunStatus);
      } else {
        renderProjectScopeView(cachedRunStatus);
      }
      startRunStatusPolling(projectId);
      void pollRunStatus(projectId);
    } catch (err) {
      alert(err.message);
    }
  });

  document.querySelector("main")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-run-status-dismiss]")) {
      void dismissRunStatus();
    }
  });

  if (projects.length) {
    await onScopeChange();
  }
}

const shareCtx = parseShareContext();

function bootstrapDashboard() {
  if (isSharePage()) {
    if (!shareCtx) {
      const main = document.querySelector("main");
      if (main) {
        main.innerHTML =
          '<p class="error">Invalid share link — <code>project</code> and <code>key</code> query parameters are required.</p>';
      }
      return Promise.resolve();
    }
    return initShareDashboard(shareCtx);
  }
  return init();
}

bootstrapDashboard().catch((err) => {
  const main = document.querySelector("main");
  const el = document.createElement("div");
  el.className = "error";
  el.textContent = err.message;
  main.prepend(el);
});
