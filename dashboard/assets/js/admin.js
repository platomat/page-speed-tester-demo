let projects = [];
let users = [];
let adminMessageTimer = null;

function updateCronHint() {
  const tz = getInstanceTimezone();
  const hint = document.getElementById("cron-hint");
  if (!hint) return;
  hint.innerHTML = `
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
    gh_owner: document.getElementById("instance-gh-owner").value.trim(),
    gh_repo: document.getElementById("instance-gh-repo").value.trim(),
    upstream_owner: document.getElementById("instance-upstream-owner").value.trim(),
    upstream_repo: document.getElementById("instance-upstream-repo").value.trim(),
    upstream_branch: document.getElementById("instance-upstream-branch").value.trim(),
    cookie_domain: document.getElementById("instance-cookie-domain").value.trim(),
    store_screenshots: document.getElementById("instance-store-screenshots").checked,
  };
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
  return parts.join("");
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
  if (!statusEl || !syncBtn) return;

  statusEl.textContent = "Loading upstream status…";
  syncBtn.disabled = true;

  try {
    const data = await api("/api/github/upstream-status");
    statusEl.innerHTML = renderUpstreamStatus(data);
    syncBtn.disabled = !data.can_sync;
  } catch (err) {
    statusEl.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
    syncBtn.disabled = true;
  }
}

async function syncUpstreamFromAdmin() {
  const syncBtn = document.getElementById("upstream-sync-btn");
  if (!syncBtn || syncBtn.disabled) return;

  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing…";

  try {
    const data = await api("/api/github/sync-upstream", { method: "POST" });
    showMessage(data.message || "Upstream synced");
    if (data.compare) {
      document.getElementById("upstream-status").innerHTML = renderUpstreamStatus(data.compare);
      syncBtn.disabled = !data.compare.can_sync;
    } else {
      await loadUpstreamStatus();
    }
  } catch (err) {
    showMessage(err.message, true);
    if (err.data?.compare) {
      document.getElementById("upstream-status").innerHTML = renderUpstreamStatus(err.data.compare);
      syncBtn.disabled = !err.data.compare.can_sync;
    } else {
      await loadUpstreamStatus();
    }
  } finally {
    syncBtn.textContent = "Sync from upstream";
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
  document.getElementById("instance-gh-owner").value = data.gh_owner ?? "";
  document.getElementById("instance-gh-repo").value = data.gh_repo ?? "";
  document.getElementById("instance-upstream-owner").value = data.upstream_owner ?? "platomat";
  document.getElementById("instance-upstream-repo").value = data.upstream_repo ?? "page-speed-tester-demo";
  document.getElementById("instance-upstream-branch").value = data.upstream_branch ?? "main";
  document.getElementById("instance-cookie-domain").value = data.cookie_domain ?? "";
  document.getElementById("instance-store-screenshots").checked = Boolean(data.store_screenshots);
  applyUpstreamSyncVisibility(data.upstream_sync_enabled !== false);
  return data;
}

function showMessage(text, isError = false) {
  const el = document.getElementById("admin-message");
  if (adminMessageTimer) {
    clearTimeout(adminMessageTimer);
    adminMessageTimer = null;
  }
  el.textContent = text;
  el.className = isError ? "admin-message error" : "admin-message success";
  el.classList.remove("hidden");
  const durationMs = isError ? 8000 : 5000;
  adminMessageTimer = setTimeout(() => {
    el.classList.add("hidden");
    adminMessageTimer = null;
  }, durationMs);
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
      <th>Keys &amp; links</th>
      <th>Cron</th>
      <th>Enabled</th>
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
        <div class="key-block">
          <span class="key-label">Trigger</span>
          <div class="access-key-row">
            <input type="text" class="access-key-input" maxlength="64" value="${escapeHtml(p.access_key ?? "")}" data-field="access_key" spellcheck="false" autocomplete="off" />
            <button type="button" class="btn-secondary btn-sm" data-action="regenerate-key" title="Generate new trigger key">↻</button>
          </div>
          <a href="${escapeHtml(publicTriggerUrl(p.id, p.access_key ?? ""))}" class="public-link" target="_blank" rel="noopener">Trigger URL</a>
        </div>
        <div class="key-block">
          <span class="key-label">Share</span>
          <div class="access-key-row">
            <input type="text" class="access-key-input" maxlength="64" value="${escapeHtml(p.share_token ?? "")}" data-field="share_token" spellcheck="false" autocomplete="off" />
            <button type="button" class="btn-secondary btn-sm" data-action="regenerate-share" title="Generate new share key">↻</button>
          </div>
          <a href="${escapeHtml(publicShareDashboardUrl(p.id, p.share_token ?? ""))}" class="public-link" target="_blank" rel="noopener">Share URL</a>
        </div>
      </td>
      <td>
        <input type="text" class="cron-input" value="${escapeHtml(p.cron_expression ?? "")}" data-field="cron" placeholder="Manual only" title="Cron schedule (instance timezone); empty = manual only" />
        <p class="cron-preview"></p>
      </td>
      <td>
        <input type="checkbox" ${p.enabled ? "checked" : ""} data-field="enabled" />
      </td>
      <td class="actions-cell">
        <button type="button" class="btn-secondary btn-sm" data-action="save-project">Save</button>
        <button type="button" class="btn-danger btn-sm" data-action="delete-project">Delete</button>
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
        <button type="button" class="btn-secondary btn-sm" data-action="save-url">Save</button>
        <button type="button" class="btn-danger btn-sm" data-action="delete-url">Delete</button>
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
  if (document.getElementById("upstream-sync-section") && !document.getElementById("upstream-sync-section").classList.contains("hidden")) {
    await loadUpstreamStatus();
  }
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
      if (data.upstream_sync_enabled !== false) {
        await loadUpstreamStatus();
      }
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
      const enabled = row.querySelector('[data-field="enabled"]').checked;
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
            enabled,
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
      if (!confirm(`Generate a new access key for "${projectId}"? Old trigger URLs will stop working.`)) {
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
      if (!confirm(`Generate a new share key for "${projectId}"? Old share URLs will stop working.`)) {
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
