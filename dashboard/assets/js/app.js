const charts = {};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      filter(item) {
        return item.dataset.label !== "Average" && item.dataset.label !== "Median";
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

function syncChartStatLabels(chart) {
  const metricKey = chart.options.plugins?.chartAverageLabel?.metricKey;
  const canvas = chart.canvas;
  const h2 = canvas?.closest(".chart-card")?.querySelector("h2");
  if (!h2 || !metricKey) return;

  const avgDataset = chart.data.datasets.find((d) => d.label === "Average");
  const medianDataset = chart.data.datasets.find((d) => d.label === "Median");
  const avg = avgDataset?.data?.[0];
  const median = medianDataset?.data?.[0];
  let container = h2.querySelector(".chart-stat-badges");

  if (avg == null && median == null) {
    container?.remove();
    return;
  }

  if (!container) {
    container = document.createElement("span");
    container.className = "chart-stat-badges";
    h2.appendChild(container);
  }

  updateChartStatBadge(container, "avg", avg, metricKey, "Ø", "Average");
  updateChartStatBadge(container, "median", median, metricKey, "Md", "Median");
}

function updateChartStatBadge(container, kind, value, metricKey, prefix, titlePrefix) {
  let badge = container.querySelector(`.chart-${kind}-badge`);
  if (value == null) {
    badge?.remove();
    return;
  }

  const formatted = formatChartAverage(metricKey, value);
  const ratingClass = metricScoreClass(metricKey, value);
  if (!badge) {
    badge = document.createElement("span");
    container.appendChild(badge);
  }
  badge.className = ratingClass
    ? `chart-stat-badge chart-${kind}-badge ${ratingClass}`
    : `chart-stat-badge chart-${kind}-badge`;
  badge.textContent = `${prefix} ${formatted}`;
  badge.title = `${titlePrefix}: ${formatted}`;
}

const chartAverageLabelPlugin = {
  id: "chartAverageLabel",
  afterUpdate(chart) {
    syncChartStatLabels(chart);
  },
};

const ANNOTATION_COLOR = "rgba(59, 130, 246, 0.85)";

/** Pixel x for an arbitrary timestamp on a category axis, interpolated between runs. */
function annotationPixelX(timeMs, runTimes, xScale, chartArea) {
  const pts = [];
  for (let i = 0; i < runTimes.length; i++) {
    if (runTimes[i] != null) pts.push({ i, t: runTimes[i] });
  }
  if (!pts.length) return null;

  let x;
  if (timeMs <= pts[0].t) {
    x = xScale.getPixelForValue(pts[0].i);
  } else if (timeMs >= pts[pts.length - 1].t) {
    x = xScale.getPixelForValue(pts[pts.length - 1].i);
  } else {
    let k = 0;
    while (k < pts.length - 1 && pts[k + 1].t < timeMs) k++;
    const a = pts[k];
    const b = pts[k + 1];
    const f = b.t > a.t ? (timeMs - a.t) / (b.t - a.t) : 0;
    x = xScale.getPixelForValue(a.i) + f * (xScale.getPixelForValue(b.i) - xScale.getPixelForValue(a.i));
  }
  if (x < chartArea.left - 0.5 || x > chartArea.right + 0.5) return null;
  return x;
}

const ANNOTATION_MARKER_SPACING = 7;

const annotationsPlugin = {
  id: "annotations",
  afterDatasetsDraw(chart) {
    const annotations = chart.$annotations;
    const runTimes = chart.$runTimes;
    const xScale = chart.scales?.x;
    const { ctx, chartArea } = chart;
    chart.$annotationHits = [];
    if (!annotations?.length || !runTimes?.length || !xScale || !chartArea) return;

    // Group annotations that resolve to (almost) the same x so markers for the
    // same point in time can be stacked instead of overlapping into one.
    const groups = new Map();
    for (const ann of annotations) {
      const x = annotationPixelX(ann.time, runTimes, xScale, chartArea);
      if (x == null) continue;
      const key = Math.round(x);
      const group = groups.get(key);
      if (group) group.anns.push(ann);
      else groups.set(key, { x, anns: [ann] });
    }

    for (const { x, anns } of groups.values()) {
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ANNOTATION_COLOR;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = ANNOTATION_COLOR;
      for (let j = 0; j < anns.length; j++) {
        const topY = chartArea.top + j * ANNOTATION_MARKER_SPACING;
        ctx.beginPath();
        ctx.moveTo(x - 4, topY);
        ctx.lineTo(x + 4, topY);
        ctx.lineTo(x, topY + 6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      chart.$annotationHits.push({
        x,
        top: chartArea.top,
        bottom: chartArea.bottom,
        anns,
      });
    }
  },
};

if (typeof Chart !== "undefined") {
  Chart.register(chartAverageLabelPlugin);
  Chart.register(annotationsPlugin);
}

function findAnnotationHit(chart, offsetX, offsetY) {
  const hits = chart.$annotationHits || [];
  for (const hit of hits) {
    if (
      Math.abs(offsetX - hit.x) <= 5 &&
      offsetY >= hit.top - 6 &&
      offsetY <= hit.bottom + 4
    ) {
      return hit;
    }
  }
  return null;
}

function scrollToAnnotationListEntries(anns) {
  if (!anns?.length) return;
  document.querySelector(".annotations-section")?.classList.remove("hidden");

  document.querySelectorAll(".annotation-item-highlight").forEach((el) => {
    el.classList.remove("annotation-item-highlight");
  });

  let firstEl = null;
  for (const ann of anns) {
    const el = document.getElementById(`annotation-item-${ann.id}`);
    if (!el) continue;
    el.classList.add("annotation-item-highlight");
    if (!firstEl) firstEl = el;
  }

  firstEl?.scrollIntoView({ behavior: "smooth", block: "center" });

  window.setTimeout(() => {
    for (const ann of anns) {
      document.getElementById(`annotation-item-${ann.id}`)?.classList.remove("annotation-item-highlight");
    }
  }, 2500);
}

function ensureAnnotationTooltip() {
  let el = document.getElementById("annotation-tooltip");
  if (!el) {
    el = document.createElement("div");
    el.id = "annotation-tooltip";
    el.className = "annotation-tooltip hidden";
    document.body.appendChild(el);
  }
  return el;
}

function annotationTooltipHtml(anns) {
  return anns
    .map((ann) => {
      const when = escapeHtml(formatDateTime(ann.annotated_at, { seconds: true }));
      const label = escapeHtml(ann.label);
      const link = ann.link
        ? `<div class="annotation-tooltip-link">${escapeHtml(ann.link)}</div>`
        : "";
      return `<div class="annotation-tooltip-entry"><div class="annotation-tooltip-when">${when}</div><div class="annotation-tooltip-label">${label}</div>${link}</div>`;
    })
    .join("") + `<div class="annotation-tooltip-hint">Click to jump to list</div>`;
}

function attachAnnotationTooltip(chart) {
  const canvas = chart.canvas;
  if (!canvas || canvas.dataset.annotationTooltip === "1") return;
  canvas.dataset.annotationTooltip = "1";

  canvas.addEventListener("mousemove", (event) => {
    const found = findAnnotationHit(chart, event.offsetX, event.offsetY);
    const tip = ensureAnnotationTooltip();
    if (!found) {
      tip.classList.add("hidden");
      canvas.style.cursor = "";
      return;
    }
    tip.innerHTML = annotationTooltipHtml(found.anns);
    tip.classList.remove("hidden");
    tip.style.left = `${event.clientX + 12}px`;
    tip.style.top = `${event.clientY + 12}px`;
    canvas.style.cursor = "pointer";
  });

  canvas.addEventListener("mouseleave", () => {
    ensureAnnotationTooltip().classList.add("hidden");
    canvas.style.cursor = "";
  });

  canvas.addEventListener("click", (event) => {
    const found = findAnnotationHit(chart, event.offsetX, event.offsetY);
    if (!found) return;
    ensureAnnotationTooltip().classList.add("hidden");
    scrollToAnnotationListEntries(found.anns);
  });
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
  { key: "performance", label: "Performance", title: "Performance", chart: "performance", format: (v) => v },
  { key: "fcp_ms", label: "FCP", title: "First Contentful Paint", chart: "fcp", format: (v) => formatMetric(v, "", "fcp_ms") },
  { key: "lcp_ms", label: "LCP", title: "Largest Contentful Paint", chart: "lcp", format: (v) => formatMetric(v, "", "lcp_ms") },
  { key: "tbt_ms", label: "TBT", title: "Total Blocking Time", chart: "tbt", format: (v) => formatMetric(v, "ms") },
  { key: "cls", label: "CLS", title: "Cumulative Layout Shift", chart: "cls", format: (v) => formatMetric(v, "", "cls") },
  { key: "speed_index", label: "SI", title: "Speed Index", chart: "si", format: (v) => formatMetric(v, "", "speed_index") },
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
/** @type {Array<{id: number, annotated_at: string, label: string, link: string|null, time: number}>} */
let currentAnnotations = [];
/** @type {number | null} */
let editingAnnotationId = null;

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

/** Snapshot for guarding async UI updates after scope changes. */
function getScopeSnapshot() {
  const { projectId, urlId } = getScope();
  return { projectId, urlId: urlId ?? null };
}

function scopeMatches(snapshot) {
  if (!snapshot?.projectId) return false;
  const current = getScopeSnapshot();
  return current.projectId === snapshot.projectId && current.urlId === snapshot.urlId;
}

function formatDecimalPlaces(value, places) {
  return Number(value)
    .toFixed(places)
    .replace(/\.?0+$/, "");
}

/** Millisecond metrics shown as seconds with one decimal (FCP, LCP, SI). */
function isDurationSecondsMetric(metricKey) {
  return metricKey === "fcp_ms" || metricKey === "lcp_ms" || metricKey === "speed_index";
}

function formatDurationSecondsFromMs(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${(Number(value) / 1000).toFixed(1)} s`;
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
    case "speed_index":
      return formatDurationSecondsFromMs(v);
    case "tbt_ms":
      return `${Math.round(v)} ms`;
    case "cls":
      return formatDecimalPlaces(v, 4);
    default:
      return String(v);
  }
}

function formatMetric(value, unit = "", metricKey = null) {
  if (value == null) return "—";
  if (metricKey && isDurationSecondsMetric(metricKey)) return formatDurationSecondsFromMs(value);
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

function chartMedian(values) {
  const nums = values
    .map((v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v)))
    .filter((v) => v != null)
    .sort((a, b) => a - b);
  if (nums.length < 2) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 0) return (nums[mid - 1] + nums[mid]) / 2;
  return nums[mid];
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
  if (isDurationSecondsMetric(metricKey)) return formatDurationSecondsFromMs(avg);
  const n = formatAverageNumber(avg);
  switch (metricKey) {
    case "tbt_ms":
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

function buildMedianDataset(data) {
  const median = chartMedian(data);
  if (median == null) return null;
  return {
    label: "Median",
    data: data.map(() => median),
    borderColor: "rgba(167, 139, 250, 0.9)",
    borderWidth: 1.5,
    borderDash: [2, 4],
    pointRadius: 0,
    pointHoverRadius: 0,
    fill: false,
    tension: 0,
    order: 2,
    tooltip: { enabled: false },
  };
}

function buildChartDatasets(data, metricKey) {
  const datasets = [buildChartDataset(data, metricKey)];
  const average = buildAverageDataset(data);
  const median = buildMedianDataset(data);
  if (average) datasets.push(average);
  if (median) datasets.push(median);
  return datasets;
}

function upsertChart(id, labels, data, metricKey, runTimes = []) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) {
    charts[id].data.labels = labels;
    charts[id].data.datasets = buildChartDatasets(data, metricKey);
    charts[id].options = chartOptions(metricKey);
    charts[id].$runTimes = runTimes;
    charts[id].$annotations = currentAnnotations;
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
  charts[id].$runTimes = runTimes;
  charts[id].$annotations = currentAnnotations;
  attachAnnotationTooltip(charts[id]);
  charts[id].update();
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
      <div class="label" title="${escapeHtml(m.title)}">${escapeHtml(m.label)}</div>
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

function latestHeading(deviceLabel, runs) {
  const latest = runs[runs.length - 1];
  const when = latest ? formatDateTime(latest, { seconds: true }) : "—";
  const timestamp = when !== "—" ? ` ${when}` : "";
  return `<h2 class="latest-heading">Latest <span class="chart-device">${deviceLabel}</span>${timestamp}</h2>`;
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
        ${latestHeading("Desktop", desktopRuns)}
        ${renderMetricCards(desktopRuns, "Desktop")}
      </div>
      <div class="latest-group">
        ${latestHeading("Mobile", mobileRuns)}
        ${renderMetricCards(mobileRuns, "Mobile")}
      </div>
    </div>`;
}

function runTimeMs(run) {
  const d = parseRunDate(run);
  return d ? d.getTime() : null;
}

function renderCharts(desktopRuns, mobileRuns) {
  const desktopTimes = desktopRuns.map(runTimeMs);
  const mobileTimes = mobileRuns.map(runTimeMs);
  for (const metric of METRICS) {
    if (!metric.chart) continue;
    upsertChart(
      `chart-${metric.chart}-desktop`,
      desktopRuns.map((r) => formatDateTime(r)),
      desktopRuns.map((r) => r[metric.key]),
      metric.key,
      desktopTimes
    );
    upsertChart(
      `chart-${metric.chart}-mobile`,
      mobileRuns.map((r) => formatDateTime(r)),
      mobileRuns.map((r) => r[metric.key]),
      metric.key,
      mobileTimes
    );
  }
}

function normalizeAnnotations(list) {
  return (list ?? [])
    .map((a) => ({ ...a, time: Date.parse(a.annotated_at) }))
    .filter((a) => Number.isFinite(a.time))
    .sort((a, b) => a.time - b.time);
}

function refreshChartAnnotations() {
  for (const chart of Object.values(charts)) {
    chart.$annotations = currentAnnotations;
    chart.update();
  }
}

function prefillAnnotationTime() {
  const at = document.getElementById("annotation-at");
  if (!at || at.value) return;
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  at.value = local.toISOString().slice(0, 16);
}

function isoToLocalDateTimeInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const ICON_EDIT = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

const ICON_DELETE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;

function renderAnnotationEditItem(a) {
  const atValue = escapeHtml(isoToLocalDateTimeInput(a.annotated_at));
  const labelValue = escapeHtml(a.label);
  const linkValue = a.link ? escapeHtml(a.link) : "";
  return `<li class="annotation-item annotation-item-editing" id="annotation-item-${a.id}">
    <form class="annotation-edit-form" data-annotation-edit="${a.id}">
      <input type="datetime-local" name="at" value="${atValue}" required />
      <input type="text" name="label" value="${labelValue}" maxlength="200" required />
      <input type="url" name="link" value="${linkValue}" placeholder="Link (optional)" />
      <div class="annotation-edit-actions">
        <button type="submit" class="btn-sm">Save</button>
        <button type="button" class="btn-sm btn-secondary" data-annotation-edit-cancel>Cancel</button>
      </div>
    </form>
  </li>`;
}

function renderAnnotationsList(annotations) {
  const list = document.getElementById("annotations-list");
  if (!list) return;
  if (!annotations.length) {
    list.innerHTML = '<li class="annotations-empty">No annotations yet.</li>';
  } else {
    list.innerHTML = annotations
      .map((a) => {
        if (!shareContext && editingAnnotationId === a.id) {
          return renderAnnotationEditItem(a);
        }
        const when = escapeHtml(formatDateTime(a.annotated_at, { seconds: true }));
        const link = a.link
          ? ` <a href="${escapeHtml(a.link)}" target="_blank" rel="noopener">↗</a>`
          : "";
        const actions = shareContext
          ? ""
          : `<button type="button" class="icon-btn btn-sm" data-annotation-edit="${a.id}" title="Edit" aria-label="Edit annotation">${ICON_EDIT}</button>
          <button type="button" class="icon-btn btn-danger btn-sm" data-annotation-delete="${a.id}" title="Delete" aria-label="Delete annotation">${ICON_DELETE}</button>`;
        return `<li class="annotation-item" id="annotation-item-${a.id}">
          <span class="annotation-when">${when}</span>
          <span class="annotation-label">${escapeHtml(a.label)}${link}</span>
          ${actions}
        </li>`;
      })
      .join("");
  }
  if (!shareContext) prefillAnnotationTime();
}

function localDateTimeToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function reloadAnnotations(projectId) {
  try {
    const data = shareContext
      ? await apiPublic(`/api/public/share/${encodeURIComponent(projectId)}/annotations`)
      : await api(`/api/projects/${encodeURIComponent(projectId)}/annotations`);
    currentAnnotations = normalizeAnnotations(data.annotations);
  } catch {
    currentAnnotations = [];
  }
  renderAnnotationsList(currentAnnotations);
  refreshChartAnnotations();
}

const ICON_DETAILS = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`;

const ICON_JSON = `<span class="json-label" aria-hidden="true">{}</span>`;

function renderReportMediaBadges(report) {
  if (!report) return "";
  const hasFullpage = Number(report.has_fullpage_screenshots) === 1;
  const hasTiming = Number(report.has_timing_screenshots) === 1;
  return `<div class="report-media-badges" aria-label="Report media flags">
    <span class="report-media-badge" data-has-image="${hasFullpage}" title="Full-page screenshots: ${hasFullpage ? "yes" : "no"}">FP IMG</span>
    <span class="report-media-badge" data-has-image="${hasTiming}" title="Timing screenshots: ${hasTiming ? "yes" : "no"}">T IMG</span>
  </div>`;
}

function renderReportMetaCell(report) {
  const source = report?.trigger_source === "cron" ? "cron" : "manual";
  const label = source === "cron" ? "Cron" : "Manual";
  const lhWarmup = Number(report?.lh_warmup) === 1;
  const lhwBadge = lhWarmup
    ? `<span class="trigger-badge trigger-badge--lhw" title="LH cache warmup enabled">LHW</span>`
    : "";
  return `
    <div class="reports-grid-cell reports-meta">
      <time class="report-date">${formatDateTime(report)}</time>
      <span class="trigger-badge trigger-badge--${source}">${label}</span>
      ${lhwBadge}
    </div>`;
}

function renderDeviceCell(report, deviceLabel) {
  const device = deviceLabel.toLowerCase();
  if (!report) {
    return `<div class="reports-grid-cell report-device-col" data-device="${device}"><span class="report-missing">—</span></div>`;
  }
  const detailLabel = `${deviceLabel} report details`;
  const jsonLabel = `${deviceLabel} raw JSON`;
  const fileSize = formatFileSize(report.report_bytes);
  return `
    <div class="reports-grid-cell report-device-col" data-device="${device}">
      <div class="report-device-cell">
        <span class="report-score ${scoreClass(report.performance)}">${report.performance ?? "—"}</span>
        <div class="report-actions">
          <a href="${reportDetailUrl(report.report_key)}" class="icon-btn" title="Details" aria-label="${detailLabel}">${ICON_DETAILS}</a>
          <a href="${reportJsonUrl(report.report_key)}" class="icon-btn icon-btn-json" target="_blank" rel="noopener" title="JSON (${fileSize})" aria-label="${jsonLabel}">${ICON_JSON}</a>
          ${renderReportMediaBadges(report)}
        </div>
        <span class="report-file-size">${escapeHtml(fileSize)}</span>
      </div>
    </div>`;
}

function renderReportActionsCell(reportKeys) {
  if (shareContext) {
    return `<div class="reports-grid-cell reports-actions-col hidden" aria-hidden="true"></div>`;
  }
  const keysAttr = escapeHtml(JSON.stringify(reportKeys));
  return `
    <div class="reports-grid-cell reports-actions-col">
      <button type="button" class="icon-btn btn-danger btn-sm" data-delete-run="${keysAttr}" title="Delete run" aria-label="Delete test run (desktop and mobile)">${ICON_DELETE}</button>
    </div>`;
}

function renderReportsTable(reports, projectId, urlId) {
  const body = document.querySelector("#reports-grid .reports-grid-body");
  const paired = pairReports(reports);
  if (!paired.length) {
    body.innerHTML = `<div class="reports-grid-empty empty">No reports available</div>`;
    return;
  }
  body.innerHTML = paired
    .map((row) => {
      const ref = row.desktop ?? row.mobile;
      const reportKeys = [row.desktop?.report_key, row.mobile?.report_key].filter(Boolean);
      return `
    <div class="reports-row" role="row">
      ${renderReportMetaCell(ref)}
      ${renderDeviceCell(row.desktop, "Desktop")}
      ${renderDeviceCell(row.mobile, "Mobile")}
      ${renderReportActionsCell(reportKeys)}
    </div>`;
    })
    .join("");

  if (shareContext) return;

  body.querySelectorAll("[data-delete-run]").forEach((btn) => {
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

function renderScopeSelect(selectedValue, { focus = false } = {}) {
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
    if (focus && select.options.length) select.focus();
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
  if (focus && select.options.length) select.focus();
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
  document.querySelector(".annotations-section")?.classList.toggle("hidden", !hasData);
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
  const snapshot = getScopeSnapshot();
  const { projectId, urlId } = snapshot;
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
    const [desktopData, mobileData, reportsData, annotationsData] = await Promise.all([
      apiPublic(`${base}/metrics?url_id=${encodeURIComponent(urlId)}&strategy=desktop`),
      apiPublic(`${base}/metrics?url_id=${encodeURIComponent(urlId)}&strategy=mobile`),
      apiPublic(`${base}/reports?url_id=${encodeURIComponent(urlId)}`),
      apiPublic(`${base}/annotations`).catch(() => ({ annotations: [] })),
    ]);

    const desktopRuns = desktopData.runs ?? [];
    const mobileRuns = mobileData.runs ?? [];
    if (!scopeMatches(snapshot)) return;
    currentAnnotations = normalizeAnnotations(annotationsData.annotations);
    renderLatest(desktopRuns, mobileRuns);
    showUrlScopeView(desktopRuns, mobileRuns);
    if (desktopRuns.length > 0 || mobileRuns.length > 0) {
      renderCharts(desktopRuns, mobileRuns);
      renderAnnotationsList(currentAnnotations);
      renderReportsTable(reportsData.reports ?? [], projectId, urlId);
    }
    return;
  }

  if (!urlId) {
    try {
      const status = await api(`/api/projects/${encodeURIComponent(projectId)}/run-status`);
      if (!scopeMatches(snapshot)) return;
      cachedRunStatus = status;
      wasRunStatusActive = Boolean(status.running);
      renderProjectScopeView(status);
    } catch {
      if (!scopeMatches(snapshot)) return;
      renderProjectScopeView();
    }
    return;
  }

  showUrlMetricsView();
  const base = `/api/metrics?project_id=${encodeURIComponent(projectId)}&url_id=${encodeURIComponent(urlId)}`;
  const [desktopData, mobileData, reportsData, annotationsData] = await Promise.all([
    api(`${base}&strategy=desktop`),
    api(`${base}&strategy=mobile`),
    api(`/api/reports?project_id=${encodeURIComponent(projectId)}&url_id=${encodeURIComponent(urlId)}`),
    api(`/api/projects/${encodeURIComponent(projectId)}/annotations`).catch(() => ({ annotations: [] })),
  ]);

  const desktopRuns = desktopData.runs ?? [];
  const mobileRuns = mobileData.runs ?? [];
  if (!scopeMatches(snapshot)) return;
  currentAnnotations = normalizeAnnotations(annotationsData.annotations);
  renderLatest(desktopRuns, mobileRuns);
  showUrlScopeView(desktopRuns, mobileRuns);
  if (desktopRuns.length > 0 || mobileRuns.length > 0) {
    renderCharts(desktopRuns, mobileRuns);
    renderAnnotationsList(currentAnnotations);
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
  const snapshot = getScopeSnapshot();
  if (projectId !== snapshot.projectId) return;
  try {
    const status = await api(`/api/projects/${encodeURIComponent(projectId)}/run-status`);
    if (projectId !== runStatusProjectId) return;
    if (!scopeMatches(snapshot)) return;
    const active = Boolean(status.running);
    const { urlId } = snapshot;
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
  editingAnnotationId = null;
  const snapshot = getScopeSnapshot();
  const { projectId, urlId } = snapshot;
  if (!projectId) return;

  const previousProjectId = runStatusProjectId;
  stopRunStatusPolling();
  if (previousProjectId && previousProjectId !== projectId) {
    wasRunStatusActive = false;
    cachedRunStatus = { running: false };
  }

  if (urlId) {
    await loadData();
    if (!scopeMatches(snapshot)) return;
    try {
      const status = await api(`/api/projects/${encodeURIComponent(projectId)}/run-status`);
      if (!scopeMatches(snapshot)) return;
      cachedRunStatus = status;
      wasRunStatusActive = Boolean(status.running);
      renderRunStatus(status);
    } catch {
      if (!scopeMatches(snapshot)) return;
      renderRunStatus({ running: false });
    }
  } else {
    renderProjectScopeView({ running: false });
    await loadData();
    if (!scopeMatches(snapshot)) return;
  }

  if (!scopeMatches(snapshot)) return;
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
  document.getElementById("reports-grid")?.classList.add("reports-grid--no-actions");
  document.querySelector("#reports-grid .reports-actions-col")?.classList.add("hidden");

  const scopeLabel = document.querySelector('label[for="scope-select"]');
  if (scopeLabel) scopeLabel.textContent = "URL";

  try {
    const data = await apiPublic(`/api/public/share/${encodeURIComponent(ctx.projectId)}`);
    if (data.timezone) setInstanceTimezone(data.timezone);
    projects = [data.project];
    projectUrls.set(ctx.projectId, sortProjectUrls(data.urls ?? []));
  } catch (err) {
    const main = document.querySelector("main");
    main.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    return;
  }

  renderScopeSelect(undefined, { focus: true });
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
  renderScopeSelect(undefined, { focus: true });

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

  initAnnotationForm();

  if (projects.length) {
    await onScopeChange();
  }
}

function initAnnotationForm() {
  const form = document.getElementById("annotation-form");
  if (form) {
    prefillAnnotationTime();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const { projectId } = getScope();
      if (!projectId) return;
      const annotatedAt = localDateTimeToIso(document.getElementById("annotation-at").value);
      const label = document.getElementById("annotation-label").value.trim();
      const link = document.getElementById("annotation-link").value.trim();
      if (!annotatedAt) {
        alert("Please pick a valid date and time.");
        return;
      }
      if (!label) {
        alert("Please enter a label.");
        return;
      }
      try {
        await api(`/api/projects/${encodeURIComponent(projectId)}/annotations`, {
          method: "POST",
          body: JSON.stringify({ annotated_at: annotatedAt, label, link: link || undefined }),
        });
        document.getElementById("annotation-label").value = "";
        document.getElementById("annotation-link").value = "";
        await reloadAnnotations(projectId);
      } catch (err) {
        alert(err.message);
      }
    });
  }

  document.getElementById("annotations-list")?.addEventListener("click", async (event) => {
    const editBtn = event.target.closest("[data-annotation-edit]");
    if (editBtn && !editBtn.matches("form")) {
      editingAnnotationId = Number(editBtn.dataset.annotationEdit);
      renderAnnotationsList(currentAnnotations);
      return;
    }

    const cancelBtn = event.target.closest("[data-annotation-edit-cancel]");
    if (cancelBtn) {
      editingAnnotationId = null;
      renderAnnotationsList(currentAnnotations);
      return;
    }

    const deleteBtn = event.target.closest("[data-annotation-delete]");
    if (!deleteBtn) return;
    const { projectId } = getScope();
    if (!projectId) return;
    if (!confirm("Delete this annotation?")) return;
    try {
      await api(
        `/api/projects/${encodeURIComponent(projectId)}/annotations/${encodeURIComponent(deleteBtn.dataset.annotationDelete)}`,
        { method: "DELETE" }
      );
      if (editingAnnotationId === Number(deleteBtn.dataset.annotationDelete)) {
        editingAnnotationId = null;
      }
      await reloadAnnotations(projectId);
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("annotations-list")?.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-annotation-edit]");
    if (!form) return;
    event.preventDefault();
    const { projectId } = getScope();
    if (!projectId) return;
    const annotationId = form.dataset.annotationEdit;
    const annotatedAt = localDateTimeToIso(form.querySelector('[name="at"]')?.value);
    const label = form.querySelector('[name="label"]')?.value.trim() ?? "";
    const link = form.querySelector('[name="link"]')?.value.trim() ?? "";
    if (!annotatedAt) {
      alert("Please pick a valid date and time.");
      return;
    }
    if (!label) {
      alert("Please enter a label.");
      return;
    }
    try {
      await api(
        `/api/projects/${encodeURIComponent(projectId)}/annotations/${encodeURIComponent(annotationId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ annotated_at: annotatedAt, label, link: link || undefined }),
        }
      );
      editingAnnotationId = null;
      await reloadAnnotations(projectId);
    } catch (err) {
      alert(err.message);
    }
  });
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
