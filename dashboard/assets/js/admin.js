let projects = [];
let users = [];
let adminMessageTimer = null;

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

async function loadProjects() {
  const data = await api("/api/projects");
  projects = data.projects ?? [];
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

  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = collectSettingsFromForm();
    try {
      const data = await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      instanceTimezone = data.timezone ?? payload.timezone;
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
