let projects = [];
let users = [];
let adminMessageTimer = null;

const ICON_SAVE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;

const ICON_DELETE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;

const ICON_OPEN_LINK = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

const ICON_SHARE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;

function renderProjectKeyBlock({ label, field, keyValue, buildUrl, projectId, regenerateAction, openIcon = ICON_OPEN_LINK }) {
  const hasKey = Boolean(keyValue);
  const openLink = hasKey
    ? `<a href="${escapeHtml(buildUrl(projectId, keyValue))}" class="icon-btn btn-sm" target="_blank" rel="noopener" title="Open ${label} URL" aria-label="Open ${label} URL">${openIcon}</a>`
    : "";
  return `
    <div class="key-block">
      <span class="key-label">${label}</span>
      <div class="access-key-row">
        <input type="text" class="access-key-input" maxlength="64" value="${escapeHtml(keyValue ?? "")}" data-field="${field}" spellcheck="false" autocomplete="off" placeholder="Disabled when empty" />
        <button type="button" class="btn-secondary btn-sm" data-action="${regenerateAction}" title="Generate new ${label.toLowerCase()} key">↻</button>
        ${openLink}
      </div>
      <p class="key-field-hint">Clear and save to disable.</p>
    </div>`;
}

function updateCronHint() {
  const tz = getInstanceTimezone();
  const hint = document.getElementById("cron-hint");
  if (!hint) return;
  hint.innerHTML = `
    Leave cron <strong>empty</strong> for manual testing only.
    <strong>Cron (${escapeHtml(tz)}):</strong>
    <code>minute</code> · <code>hour</code> · <code>day</code> · <code>month</code> · <code>weekday</code>
    — e.g. <code>0 6 * * *</code> daily at 06:00,
    <code>0 */6 * * *</code> every 6 hours,
    <code>*/15 * * * *</code> every 15 minutes.
    Use <code>*</code> for “any”.`;
}

function collectSettingsFromForm() {
  return {
    timezone: document.getElementById("instance-timezone").value.trim(),
    cron_enabled: document.getElementById("instance-cron-enabled").checked,
    report_retention_days: Number.parseInt(
      document.getElementById("instance-report-retention-days").value,
      10
    ),
    gh_owner: document.getElementById("instance-gh-owner").value.trim(),
    gh_repo: document.getElementById("instance-gh-repo").value.trim(),
    upstream_owner: document.getElementById("instance-upstream-owner").value.trim(),
    upstream_repo: document.getElementById("instance-upstream-repo").value.trim(),
    upstream_branch: document.getElementById("instance-upstream-branch").value.trim(),
    cookie_domain: document.getElementById("instance-cookie-domain").value.trim(),
  };
}

function renderUpstreamCommitList(commits, title) {
  if (!Array.isArray(commits) || !commits.length) return "";
  const items = commits
    .map(
      (commit) =>
        `<li><code>${escapeHtml(String(commit.sha ?? ""))}</code> ${escapeHtml(String(commit.subject ?? ""))}</li>`
    )
    .join("");
  return `
    <div class="upstream-commit-list">
      <p class="upstream-commit-list-title"><strong>${escapeHtml(title)}</strong></p>
      <ul>${items}</ul>
    </div>`;
}

function renderUpstreamStatus(data) {
  const target = `${data.target.owner}/${data.target.repo}@${data.target.branch}`;
  const upstream = `${data.upstream.owner}/${data.upstream.repo}@${data.upstream.branch}`;
  const parts = [
    `<p><strong>Your repo:</strong> <code>${escapeHtml(target)}</code></p>`,
    `<p><strong>Upstream:</strong> <code>${escapeHtml(upstream)}</code>${data.is_fork ? " (fork)" : " (template / copy)"}</p>`,
    `<p><strong>Status:</strong> ${escapeHtml(formatUpstreamStatusLabel(data))}</p>`,
  ];
  if (data.ahead_by > 0 && data.behind_by > 0) {
    parts.push(`<p>${data.ahead_by} local commit(s) not in upstream.</p>`);
  } else if (data.ahead_by > 0 && data.behind_by === 0) {
    parts.push(`<p>${data.ahead_by} local-only commit(s) (e.g. custom changes) — upstream is fully merged.</p>`);
  }
  if (data.behind_by > 0) {
    parts.push(`<p>${data.behind_by} commit(s) behind upstream — sync will merge them.</p>`);
    if (data.incoming_commits?.length) {
      parts.push(renderUpstreamCommitList(data.incoming_commits, "Incoming upstream commits"));
    }
  }
  if (data.comparison_method === "commit-walk") {
    parts.push(
      `<p class="upstream-method-hint">Template copy — status via commit check (not GitHub fork compare).</p>`
    );
  }
  if (data.compare_url) {
    parts.push(
      `<p><a href="${escapeHtml(data.compare_url)}" target="_blank" rel="noopener">View compare on GitHub</a></p>`
    );
  }
  if (data.last_sync) {
    parts.push(renderLastSync(data.last_sync));
  }
  return parts.join("");
}

function renderLastSync(sync) {
  if (!sync || typeof sync !== "object") return "";
  const labels = {
    pending: "Sync in progress…",
    success: "Last sync successful",
    conflict: "Last sync: merge conflict",
    error: "Last sync failed",
  };
  const cls =
    sync.status === "success"
      ? "upstream-sync-ok"
      : sync.status === "pending"
        ? "upstream-sync-pending"
        : "upstream-sync-error";
  const label = labels[sync.status] ?? "Last sync";
  const when = sync.updated_at ? ` (${escapeHtml(formatDateTime(sync.updated_at))})` : "";
  const message = sync.message ? `<span class="upstream-last-sync-summary">${escapeHtml(String(sync.message))}</span>` : "";
  const commits =
    sync.status === "pending"
      ? renderUpstreamCommitList(sync.upstream_commits, "Commits being merged")
      : renderUpstreamCommitList(sync.upstream_commits, "Merged upstream commits");
  return `<div class="upstream-last-sync ${cls}"><p><strong>${escapeHtml(label)}</strong>${when}${message ? ` — ${message}` : ""}</p>${commits}</div>`;
}

function formatUpstreamStatusLabel(data) {
  if (data.behind_by === 0) return "Up to date";
  switch (data.status) {
    case "identical":
    case "synced":
      return "Up to date";
    case "ahead":
      return "Ahead of upstream";
    case "behind":
      return "Behind upstream";
    case "diverged":
      return "Diverged (local and upstream changes)";
    default:
      return data.status;
  }
}

async function loadUpstreamStatus() {
  const statusEl = document.getElementById("upstream-status");
  const syncBtn = document.getElementById("upstream-sync-btn");
  const refreshBtn = document.getElementById("upstream-refresh-btn");
  if (!statusEl || !syncBtn) return;

  statusEl.textContent = "Loading upstream status…";
  syncBtn.disabled = true;
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const data = await api("/api/github/upstream-status");
    statusEl.innerHTML = renderUpstreamStatus(data);
    syncBtn.disabled = !data.can_sync;
    return data;
  } catch (err) {
    statusEl.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    syncBtn.disabled = true;
    return null;
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll upstream status until the dispatched sync workflow reports a result.
async function pollUpstreamSyncResult({ attempts = 20, intervalMs = 5000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await delay(intervalMs);
    const data = await loadUpstreamStatus();
    const sync = data?.last_sync;
    if (sync && sync.status && sync.status !== "pending") {
      return sync;
    }
    if (data && data.behind_by === 0 && data.status !== "diverged") {
      return sync ?? { status: "success", message: "Up to date" };
    }
  }
  return null;
}

async function syncUpstreamFromAdmin() {
  const syncBtn = document.getElementById("upstream-sync-btn");
  if (!syncBtn || syncBtn.disabled) return;

  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";
  let keepDisabled = false;

  try {
    const data = await api("/api/github/sync-upstream", { method: "POST" });
    showMessage(data.message || "Upstream synced");

    if (data.started) {
      keepDisabled = true;
      // Workflow dispatched — poll until the GitHub Action reports a result.
      const result = await pollUpstreamSyncResult();
      if (result?.status === "success") {
        showMessage(result.message || "Upstream merged via GitHub Actions");
      } else if (result?.status === "conflict") {
        showMessage(result.message || "Merge conflict — resolve manually with git", true);
      } else if (result?.status === "error") {
        showMessage(result.message || "Upstream sync failed", true);
      } else {
        showMessage(
          "Sync still running in GitHub Actions — click Refresh status; status updates automatically once the merge completes.",
          true
        );
      }
      await loadUpstreamStatus();
      return;
    }

    if (data.compare) {
      document.getElementById("upstream-status").innerHTML = renderUpstreamStatus(data.compare);
      syncBtn.disabled = !data.compare.can_sync;
    } else {
      await loadUpstreamStatus();
    }
  } catch (err) {
    showMessage(err.message, true);
    const statusEl = document.getElementById("upstream-status");
    if (statusEl && err.data) {
      const compareHtml = err.data.compare ? renderUpstreamStatus(err.data.compare) : "";
      statusEl.innerHTML =
        `<p class="error">${escapeHtml(err.message)}</p>` +
        renderUpstreamSyncError(err.data) +
        compareHtml;
      syncBtn.disabled = err.data.compare ? !err.data.compare.can_sync : true;
    } else {
      await loadUpstreamStatus();
    }
  } finally {
    syncBtn.textContent = "Sync from upstream";
    if (keepDisabled) {
      await loadUpstreamStatus();
    }
  }
}

function applyUpstreamSyncVisibility(enabled) {
  document.getElementById("upstream-sync-section")?.classList.toggle("hidden", !enabled);
  for (const el of document.querySelectorAll(".upstream-setting-item")) {
    el.classList.toggle("hidden", !enabled);
  }
}

async function loadSettingsForm() {
  const data = await api("/api/settings");
  instanceTimezone = data.timezone ?? "UTC";
  document.getElementById("instance-timezone").value = instanceTimezone;
  document.getElementById("instance-cron-enabled").checked = data.cron_enabled !== false;
  document.getElementById("instance-report-retention-days").value = String(
    data.report_retention_days ?? 0
  );
  document.getElementById("instance-gh-owner").value = data.gh_owner ?? "";
  document.getElementById("instance-gh-repo").value = data.gh_repo ?? "";
  document.getElementById("instance-upstream-owner").value = data.upstream_owner ?? "platomat";
  document.getElementById("instance-upstream-repo").value = data.upstream_repo ?? "page-speed-tester-demo";
  document.getElementById("instance-upstream-branch").value = data.upstream_branch ?? "main";
  document.getElementById("instance-cookie-domain").value = data.cookie_domain ?? "";
  applyUpstreamSyncVisibility(data.upstream_sync_enabled !== false);
  return data;
}

function showMessage(text, isError = false) {
  const el = document.getElementById("admin-message");
  if (adminMessageTimer) {
    clearTimeout(adminMessageTimer);
    adminMessageTimer = null;
  }
  el.innerHTML = escapeHtml(text);
  el.className = isError ? "admin-message error" : "admin-message success";
  el.classList.remove("hidden");
  const durationMs = isError ? 12000 : 5000;
  adminMessageTimer = setTimeout(() => {
    el.classList.add("hidden");
    adminMessageTimer = null;
  }, durationMs);
}

function renderUpstreamSyncError(data) {
  if (!data || typeof data !== "object") return "";
  const parts = [];
  if (data.hint) {
    parts.push(`<p>${escapeHtml(String(data.hint))}</p>`);
  }
  if (data.pull_request_url) {
    parts.push(
      `<p><a href="${escapeHtml(String(data.pull_request_url))}" target="_blank" rel="noopener">Open sync pull request on GitHub</a></p>`
    );
  }
  parts.push(
    `<pre class="upstream-error-json">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`
  );
  return parts.join("");
}

function openFormPanel(panelId, toggleId) {
  const panel = document.getElementById(panelId);
  const toggle = document.getElementById(toggleId);
  panel.classList.remove("hidden");
  toggle.classList.add("hidden");
  const firstInput = panel.querySelector("input:not([type='hidden'])");
  firstInput?.focus();
}

function closeFormPanel(panelId, toggleId) {
  document.getElementById(panelId).classList.add("hidden");
  document.getElementById(toggleId).classList.remove("hidden");
}

function updateUrlFormProjectLabel() {
  const select = document.getElementById("url-project-select");
  const label = document.getElementById("url-form-project-name");
  const option = select.selectedOptions[0];
  label.textContent = option?.textContent?.trim() || "—";
}

async function loadProjects(selectProjectId) {
  const data = await api("/api/projects");
  projects = data.projects ?? [];
  const table = document.querySelector("#projects-table");
  const urlSelect = document.getElementById("url-project-select");
  const previousId = selectProjectId ?? urlSelect.value;

  urlSelect.innerHTML = projects
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join("");

  if (projects.length) {
    const ids = projects.map((p) => p.id);
    if (selectProjectId && ids.includes(selectProjectId)) {
      urlSelect.value = selectProjectId;
    } else if (previousId && ids.includes(previousId)) {
      urlSelect.value = previousId;
    } else {
      urlSelect.value = projects[0].id;
    }
  }

  table.querySelector("thead").innerHTML = `
    <tr>
      <th>ID</th>
      <th>Name</th>
      <th>Trigger &amp; Share</th>
      <th>Cron</th>
      <th>Settings</th>
      <th>Actions</th>
    </tr>`;

  const tbody = table.querySelector("tbody");
  tbody.innerHTML = projects
    .map(
      (p) => `
    <tr data-project-id="${escapeHtml(p.id)}">
      <td><code>${escapeHtml(p.id)}</code></td>
      <td>
        <input type="text" class="name-input project-name-input" value="${escapeHtml(p.name)}" data-field="name" required />
      </td>
      <td class="access-key-cell">
        ${renderProjectKeyBlock({
          label: "Trigger",
          field: "access_key",
          keyValue: p.access_key,
          projectId: p.id,
          buildUrl: (id, key) => publicTriggerUrl(id, key),
          regenerateAction: "regenerate-key",
        })}
        ${renderProjectKeyBlock({
          label: "Share",
          field: "share_token",
          keyValue: p.share_token,
          projectId: p.id,
          buildUrl: (id, key) => publicShareDashboardUrl(id, key),
          regenerateAction: "regenerate-share",
          openIcon: ICON_SHARE,
        })}
      </td>
      <td>
        <input type="text" class="cron-input" value="${escapeHtml(p.cron_expression ?? "")}" data-field="cron" placeholder="Manual only" title="Cron schedule (instance timezone); empty = manual only" />
        <p class="cron-preview"></p>
        <p class="key-field-hint">Clear for manual runs only.</p>
      </td>
      <td class="project-screenshots-cell">
        <label class="project-screenshot-toggle" title="Store full-page screenshots in Lighthouse JSON">
          <input type="checkbox" ${p.store_fullpage_screenshots ? "checked" : ""} data-field="store_fullpage_screenshots" />
          FP
        </label>
        <label class="project-screenshot-toggle" title="Store timing screenshots in Lighthouse JSON">
          <input type="checkbox" ${p.store_timing_screenshots ? "checked" : ""} data-field="store_timing_screenshots" />
          T
        </label>
        <label class="project-screenshot-toggle" title="Cache warmup curl before each audit (LH_WARMUP)">
          <input type="checkbox" ${p.lh_warmup ? "checked" : ""} data-field="lh_warmup" />
          LHW
        </label>
      </td>
      <td class="actions-cell">
        <button type="button" class="icon-btn btn-sm" data-action="save-project" title="Save project" aria-label="Save project">${ICON_SAVE}</button>
        <button type="button" class="icon-btn btn-danger btn-sm" data-action="delete-project" title="Delete project" aria-label="Delete project">${ICON_DELETE}</button>
      </td>
    </tr>`
    )
    .join("");

  document.querySelectorAll("#projects-table [data-field='cron']").forEach((input) => {
    const preview = input.closest("td")?.querySelector(".cron-preview");
    if (preview) bindCronPreview(input, preview);
  });

  await loadUrls();
  updateUrlFormProjectLabel();
}

async function loadUrls() {
  const projectId = document.getElementById("url-project-select").value;
  if (!projectId) {
    document.querySelector("#urls-table tbody").innerHTML = "";
    return;
  }
  const data = await api(`/api/projects/${encodeURIComponent(projectId)}/urls`);
  const urls = data.urls ?? [];
  const tbody = document.querySelector("#urls-table tbody");
  tbody.innerHTML = urls
    .map(
      (u) => `
    <tr data-url-id="${escapeHtml(u.id)}">
      <td><code>${escapeHtml(u.id)}</code></td>
      <td><input type="text" class="name-input" value="${escapeHtml(u.name)}" data-field="name" /></td>
      <td><input type="url" class="url-input" value="${escapeHtml(u.url)}" data-field="url" /></td>
      <td><input type="checkbox" ${u.enabled ? "checked" : ""} data-field="enabled" /></td>
      <td class="actions-cell">
        <button type="button" class="icon-btn btn-sm" data-action="save-url" title="Save URL" aria-label="Save URL">${ICON_SAVE}</button>
        <button type="button" class="icon-btn btn-danger btn-sm" data-action="delete-url" title="Delete URL" aria-label="Delete URL">${ICON_DELETE}</button>
      </td>
    </tr>`
    )
    .join("");
}

async function loadUsers() {
  const data = await api("/api/users");
  users = data.users ?? [];
  const tbody = document.querySelector("#users-table tbody");
  tbody.innerHTML = await Promise.all(
    users.map(async (u) => {
      const assignments = await api(`/api/users/${encodeURIComponent(u.id)}/projects`);
      const assigned = assignments.project_ids ?? [];
      const options = projects
        .map(
          (p) =>
            `<option value="${p.id}" ${assigned.includes(p.id) ? "selected" : ""}>${escapeHtml(p.name)}</option>`
        )
        .join("");
      return `
    <tr data-user-id="${escapeHtml(u.id)}">
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.role)}</td>
      <td>
        <select multiple class="project-assign" size="3">${options}</select>
        <button type="button" class="btn-secondary btn-sm" data-action="save-assignments">Update</button>
      </td>
      <td>—</td>
    </tr>`;
    })
  ).then((rows) => rows.join(""));
}

async function init() {
  const user = await initSiteHeader();
  if (!user) return;
  if (user.role !== "admin") {
    window.location.href = "index.html";
    return;
  }

  await loadSettingsForm();
  updateCronHint();
  bindCronPreview(
    document.getElementById("project-cron"),
    document.getElementById("project-cron-preview")
  );

  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = collectSettingsFromForm();
    try {
      const data = await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      instanceTimezone = data.timezone ?? payload.timezone;
      updateCronHint();
      refreshAllCronPreviews();
      showMessage("Settings saved");
      applyUpstreamSyncVisibility(data.upstream_sync_enabled !== false);
    } catch (err) {
      showMessage(err.message, true);
    }
  });

  document.getElementById("upstream-sync-btn")?.addEventListener("click", () => {
    syncUpstreamFromAdmin().catch((err) => showMessage(err.message, true));
  });
  document.getElementById("upstream-refresh-btn")?.addEventListener("click", () => {
    loadUpstreamStatus().catch((err) => showMessage(err.message, true));
  });

  document.getElementById("toggle-project-form").addEventListener("click", () => {
    openFormPanel("project-form-panel", "toggle-project-form");
  });

  document.getElementById("cancel-project-form").addEventListener("click", () => {
    document.getElementById("project-form").reset();
    document.getElementById("project-cron-preview").textContent = describeCron("", getInstanceTimezone());
    closeFormPanel("project-form-panel", "toggle-project-form");
  });

  document.getElementById("toggle-url-form").addEventListener("click", () => {
    const projectId = document.getElementById("url-project-select").value;
    if (!projectId) {
      showMessage("Select a project first", true);
      return;
    }
    updateUrlFormProjectLabel();
    openFormPanel("url-form-panel", "toggle-url-form");
  });

  document.getElementById("cancel-url-form").addEventListener("click", () => {
    document.getElementById("url-form").reset();
    closeFormPanel("url-form-panel", "toggle-url-form");
  });

  document.getElementById("project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const created = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          id: document.getElementById("project-id").value.trim() || undefined,
          name: document.getElementById("project-name").value.trim(),
          access_key: document.getElementById("project-access-key").value.trim() || undefined,
          cron_expression: document.getElementById("project-cron").value.trim(),
          store_fullpage_screenshots: document.getElementById("project-store-fullpage-screenshots").checked,
          store_timing_screenshots: document.getElementById("project-store-timing-screenshots").checked,
          lh_warmup: document.getElementById("project-lh-warmup").checked,
        }),
      });
      e.target.reset();
      closeFormPanel("project-form-panel", "toggle-project-form");
      await loadProjects(created.id);
      await loadUsers();
      showMessage("Project created");
    } catch (err) {
      showMessage(err.message, true);
    }
  });

  document.getElementById("url-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const projectId = document.getElementById("url-project-select").value;
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/urls`, {
        method: "POST",
        body: JSON.stringify({
          id: document.getElementById("url-id").value.trim() || undefined,
          name: document.getElementById("url-name").value.trim(),
          url: document.getElementById("url-url").value.trim(),
        }),
      });
      e.target.reset();
      closeFormPanel("url-form-panel", "toggle-url-form");
      await loadUrls();
      showMessage("URL added");
    } catch (err) {
      showMessage(err.message, true);
    }
  });

  document.getElementById("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("user-email").value.trim(),
          username: document.getElementById("user-username").value.trim(),
          password: document.getElementById("user-password").value,
          role: document.getElementById("user-role").value,
        }),
      });
      e.target.reset();
      await loadUsers();
      showMessage("User created");
    } catch (err) {
      showMessage(err.message, true);
    }
  });

  document.getElementById("url-project-select").addEventListener("change", () => {
    loadUrls();
    updateUrlFormProjectLabel();
  });

  document.getElementById("projects-table").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const row = btn.closest("tr");
    const projectId = row.dataset.projectId;
    if (btn.dataset.action === "delete-project") {
      if (!confirm(`Delete project "${projectId}"?`)) return;
      try {
        await api(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
        await loadProjects();
        await loadUsers();
        showMessage("Project deleted");
      } catch (err) {
        showMessage(err.message, true);
      }
    }
    if (btn.dataset.action === "save-project") {
      const name = row.querySelector('[data-field="name"]').value.trim();
      const cron = row.querySelector('[data-field="cron"]').value.trim();
      const storeFullpageScreenshots = row.querySelector('[data-field="store_fullpage_screenshots"]').checked;
      const storeTimingScreenshots = row.querySelector('[data-field="store_timing_screenshots"]').checked;
      const lhWarmup = row.querySelector('[data-field="lh_warmup"]').checked;
      const accessKey = row.querySelector('[data-field="access_key"]').value.trim();
      const shareToken = row.querySelector('[data-field="share_token"]').value.trim();
      if (!name) {
        showMessage("Project name is required", true);
        return;
      }
      try {
        await api(`/api/projects/${encodeURIComponent(projectId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            cron_expression: cron,
            store_fullpage_screenshots: storeFullpageScreenshots,
            store_timing_screenshots: storeTimingScreenshots,
            lh_warmup: lhWarmup,
            access_key: accessKey,
            share_token: shareToken,
          }),
        });
        await loadProjects();
        showMessage("Project updated");
      } catch (err) {
        showMessage(err.message, true);
      }
    }
    if (btn.dataset.action === "regenerate-key") {
      const hasKey = Boolean(row.querySelector('[data-field="access_key"]')?.value.trim());
      if (
        hasKey &&
        !confirm(
          `Generate a new access key for "${projectId}"? Old trigger URLs will stop working.`
        )
      ) {
        return;
      }
      try {
        await api(`/api/projects/${encodeURIComponent(projectId)}`, {
          method: "PATCH",
          body: JSON.stringify({ access_key: "generate" }),
        });
        await loadProjects();
        showMessage("Access key regenerated");
      } catch (err) {
        showMessage(err.message, true);
      }
    }
    if (btn.dataset.action === "regenerate-share") {
      const hasKey = Boolean(row.querySelector('[data-field="share_token"]')?.value.trim());
      if (
        hasKey &&
        !confirm(`Generate a new share key for "${projectId}"? Old share URLs will stop working.`)
      ) {
        return;
      }
      try {
        await api(`/api/projects/${encodeURIComponent(projectId)}`, {
          method: "PATCH",
          body: JSON.stringify({ share_token: "generate" }),
        });
        await loadProjects();
        showMessage("Share key regenerated");
      } catch (err) {
        showMessage(err.message, true);
      }
    }
  });

  document.getElementById("urls-table").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const row = btn.closest("tr");
    const urlId = row.dataset.urlId;
    const projectId = document.getElementById("url-project-select").value;
    if (btn.dataset.action === "delete-url") {
      if (!confirm(`Delete URL "${urlId}"?`)) return;
      try {
        await api(
          `/api/projects/${encodeURIComponent(projectId)}/urls/${encodeURIComponent(urlId)}`,
          { method: "DELETE" }
        );
        await loadUrls();
        showMessage("URL deleted");
      } catch (err) {
        showMessage(err.message, true);
      }
    }
    if (btn.dataset.action === "save-url") {
      try {
        await api(
          `/api/projects/${encodeURIComponent(projectId)}/urls/${encodeURIComponent(urlId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name: row.querySelector('[data-field="name"]').value.trim(),
              url: row.querySelector('[data-field="url"]').value.trim(),
              enabled: row.querySelector('[data-field="enabled"]').checked,
            }),
          }
        );
        showMessage("URL updated");
      } catch (err) {
        showMessage(err.message, true);
      }
    }
  });

  document.getElementById("users-table").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action='save-assignments']");
    if (!btn) return;
    const row = btn.closest("tr");
    const userId = row.dataset.userId;
    const select = row.querySelector(".project-assign");
    const selected = [...select.selectedOptions].map((o) => o.value);
    try {
      const current = await api(`/api/users/${encodeURIComponent(userId)}/projects`);
      const existing = current.project_ids ?? [];
      for (const pid of existing) {
        if (!selected.includes(pid)) {
          await api(
            `/api/users/${encodeURIComponent(userId)}/projects/${encodeURIComponent(pid)}`,
            { method: "DELETE" }
          );
        }
      }
      for (const pid of selected) {
        if (!existing.includes(pid)) {
          await api(`/api/users/${encodeURIComponent(userId)}/projects`, {
            method: "POST",
            body: JSON.stringify({ project_id: pid }),
          });
        }
      }
      showMessage("Assignments updated");
    } catch (err) {
      showMessage(err.message, true);
    }
  });

  await loadProjects();
  await loadUsers();
}

init().catch((err) => showMessage(err.message, true));
