const ICON_SAVE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;

const ICON_DELETE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;

const ICON_OPEN_LINK = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

const ICON_SHARE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;

let messageTimer = null;
let projectId = "";
/** @type {Record<string, unknown> | null} */
let currentProject = null;

function showMessage(text, isError = false) {
  const el = document.getElementById("projects-message");
  if (!el) return;
  if (messageTimer) {
    clearTimeout(messageTimer);
    messageTimer = null;
  }
  el.textContent = text;
  el.className = isError ? "projects-message error" : "projects-message success";
  el.classList.remove("hidden");
  messageTimer = setTimeout(() => {
    el.classList.add("hidden");
    messageTimer = null;
  }, isError ? 8000 : 4500);
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

function openFormPanel(panelId, toggleId) {
  document.getElementById(panelId)?.classList.remove("hidden");
  document.getElementById(toggleId)?.classList.add("hidden");
}

function closeFormPanel(panelId, toggleId) {
  document.getElementById(panelId)?.classList.add("hidden");
  document.getElementById(toggleId)?.classList.remove("hidden");
}

function updateKeyLinks(project) {
  const triggerLink = document.getElementById("edit-trigger-link");
  const shareLink = document.getElementById("edit-share-link");
  if (triggerLink) {
    if (project.access_key) {
      triggerLink.href = publicTriggerUrl(project.id, project.access_key);
      triggerLink.innerHTML = ICON_OPEN_LINK;
      triggerLink.classList.remove("hidden");
    } else {
      triggerLink.classList.add("hidden");
      triggerLink.removeAttribute("href");
    }
  }
  if (shareLink) {
    if (project.share_token) {
      shareLink.href = publicShareDashboardUrl(project.id, project.share_token);
      shareLink.innerHTML = ICON_SHARE;
      shareLink.classList.remove("hidden");
    } else {
      shareLink.classList.add("hidden");
      shareLink.removeAttribute("href");
    }
  }
}

function fillProjectForm(project) {
  currentProject = project;
  document.getElementById("edit-project-id").value = project.id;
  document.getElementById("edit-project-name").value = project.name ?? "";
  document.getElementById("edit-access-key").value = project.access_key ?? "";
  document.getElementById("edit-share-token").value = project.share_token ?? "";
  document.getElementById("edit-project-cron").value = project.cron_expression ?? "";
  document.getElementById("edit-store-fullpage").checked = Boolean(project.store_fullpage_screenshots);
  document.getElementById("edit-store-timing").checked = Boolean(project.store_timing_screenshots);
  document.getElementById("edit-lh-warmup").checked = Boolean(project.lh_warmup);

  const name = project.name ?? project.id;
  document.getElementById("edit-breadcrumb-name").textContent = name;
  document.getElementById("edit-form-legend").textContent = name;
  document.title = `${name} — Edit project`;

  updateKeyLinks(project);
  bindCronPreview(
    document.getElementById("edit-project-cron"),
    document.getElementById("edit-cron-preview")
  );
}

async function fetchProject(id) {
  const data = await api("/api/projects");
  const project = (data.projects ?? []).find((p) => p.id === id);
  if (!project) throw new Error("Project not found");
  return project;
}

async function reloadProject() {
  const project = await fetchProject(projectId);
  fillProjectForm(project);
  return project;
}

async function loadUrls() {
  if (!projectId) return;
  const data = await api(`/api/projects/${encodeURIComponent(projectId)}/urls`);
  const urls = data.urls ?? [];
  const tbody = document.querySelector("#urls-table tbody");
  if (!tbody) return;
  tbody.innerHTML = urls
    .map(
      (u) => `
    <tr data-url-id="${escapeHtml(u.id)}">
      <td class="entity-id"><code>${escapeHtml(u.id)}</code></td>
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

async function init() {
  const user = await initSiteHeader();
  if (!user) return;
  if (user.role !== "admin") {
    window.location.href = "/";
    return;
  }

  projectId = new URLSearchParams(window.location.search).get("id")?.trim() ?? "";
  if (!projectId) {
    window.location.href = "/projects/";
    return;
  }

  await loadInstanceSettings();
  updateCronHint();

  document.getElementById("edit-trigger-link")?.classList.add("hidden");
  document.getElementById("edit-share-link")?.classList.add("hidden");
  const triggerLinkEl = document.getElementById("edit-trigger-link");
  const shareLinkEl = document.getElementById("edit-share-link");
  if (triggerLinkEl) triggerLinkEl.innerHTML = ICON_OPEN_LINK;
  if (shareLinkEl) shareLinkEl.innerHTML = ICON_SHARE;

  try {
    await reloadProject();
    await loadUrls();
  } catch (err) {
    showMessage(err.message, true);
    return;
  }

  document.getElementById("cancel-project-edit")?.addEventListener("click", () => {
    window.location.href = "/projects/";
  });

  document.getElementById("project-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("edit-project-name").value.trim();
    if (!name) {
      showMessage("Project name is required", true);
      return;
    }
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          cron_expression: document.getElementById("edit-project-cron").value.trim(),
          store_fullpage_screenshots: document.getElementById("edit-store-fullpage").checked,
          store_timing_screenshots: document.getElementById("edit-store-timing").checked,
          lh_warmup: document.getElementById("edit-lh-warmup").checked,
          access_key: document.getElementById("edit-access-key").value.trim(),
          share_token: document.getElementById("edit-share-token").value.trim(),
        }),
      });
      await reloadProject();
      showMessage("Project saved");
    } catch (err) {
      showMessage(err.message, true);
    }
  });

  document.getElementById("project-form")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "regenerate-key") {
      const hasKey = Boolean(document.getElementById("edit-access-key")?.value.trim());
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
        await reloadProject();
        showMessage("Access key regenerated");
      } catch (err) {
        showMessage(err.message, true);
      }
    }
    if (btn.dataset.action === "regenerate-share") {
      const hasKey = Boolean(document.getElementById("edit-share-token")?.value.trim());
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
        await reloadProject();
        showMessage("Share key regenerated");
      } catch (err) {
        showMessage(err.message, true);
      }
    }
  });

  document.getElementById("toggle-url-form")?.addEventListener("click", () => {
    openFormPanel("url-form-panel", "toggle-url-form");
  });

  document.getElementById("cancel-url-form")?.addEventListener("click", () => {
    document.getElementById("url-form")?.reset();
    closeFormPanel("url-form-panel", "toggle-url-form");
  });

  document.getElementById("url-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
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

  document.getElementById("urls-table")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const row = btn.closest("tr");
    const urlId = row?.dataset.urlId;
    if (!urlId) return;

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
        showMessage("URL saved");
      } catch (err) {
        showMessage(err.message, true);
      }
    }
  });
}

init();
