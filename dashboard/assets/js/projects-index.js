const ICON_EDIT = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

const ICON_DELETE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;

let messageTimer = null;

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
  }, isError ? 8000 : 3500);
}

async function copyKey(value) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showMessage("Copied to clipboard");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showMessage("Copied to clipboard");
    } catch {
      showMessage("Could not copy to clipboard", true);
    }
    textarea.remove();
  }
}

function renderKeyColumn(label, keyValue) {
  if (!keyValue) {
    return `
      <div class="project-key-col">
        <span class="project-key-label">${label}</span>
        <span class="project-key-value is-empty" aria-disabled="true">—</span>
      </div>`;
  }
  const title = `Click to copy: ${keyValue}`;
  return `
    <div class="project-key-col">
      <span class="project-key-label">${label}</span>
      <button
        type="button"
        class="project-key-value"
        data-copy-key="${escapeHtml(keyValue)}"
        title="${escapeHtml(title)}"
      >${escapeHtml(keyValue)}</button>
    </div>`;
}

function renderFlag(label, on, title) {
  return `<span class="project-flag${on ? " is-on" : ""}" title="${escapeHtml(title)}">${label}</span>`;
}

function renderProjectCard(project) {
  const cron = (project.cron_expression ?? "").trim();
  const cronPreview = cron
    ? describeCron(cron, getInstanceTimezone())
    : "No automatic schedule — manual runs only.";
  const editHref = `/projects/edit.html?id=${encodeURIComponent(project.id)}`;

  return `
    <article class="project-card" data-project-id="${escapeHtml(project.id)}">
      <div class="project-card-header">
        <div class="project-card-title">
          <h3 class="project-card-name">${escapeHtml(project.name)}</h3>
          <p class="project-card-id"><code>${escapeHtml(project.id)}</code></p>
        </div>
        <div class="project-card-actions">
          <a href="${editHref}" class="icon-btn btn-sm" title="Edit project" aria-label="Edit project">${ICON_EDIT}</a>
          <button
            type="button"
            class="icon-btn btn-danger btn-sm"
            data-action="delete-project"
            title="Delete project"
            aria-label="Delete project"
          >${ICON_DELETE}</button>
        </div>
      </div>
      <div class="project-keys">
        ${renderKeyColumn("Trigger", project.access_key)}
        ${renderKeyColumn("Share", project.share_token)}
      </div>
      <div class="project-cron-block">
        <p class="project-cron">
          Cron: <code>${cron ? escapeHtml(cron) : "—"}</code>
        </p>
        <p class="project-cron-preview">${escapeHtml(cronPreview)}</p>
      </div>
      <div class="project-flags" aria-label="Run options">
        ${renderFlag("FP", Boolean(project.store_fullpage_screenshots), "Full-page screenshots")}
        ${renderFlag("T", Boolean(project.store_timing_screenshots), "Timing screenshots")}
        ${renderFlag("LHW", Boolean(project.lh_warmup), "LH cache warmup")}
      </div>
    </article>`;
}

function renderProjectsGrid(projects) {
  const grid = document.getElementById("projects-grid");
  if (!grid) return;
  if (!projects.length) {
    grid.innerHTML = '<p class="projects-empty">No projects yet.</p>';
    return;
  }
  grid.innerHTML = projects.map(renderProjectCard).join("");
}

async function loadProjects() {
  const data = await api("/api/projects");
  const projects = (data.projects ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  renderProjectsGrid(projects);
}

async function init() {
  const user = await initSiteHeader();
  if (!user) return;
  if (user.role !== "admin") {
    window.location.href = "/";
    return;
  }

  await loadInstanceSettings();

  document.getElementById("projects-grid")?.addEventListener("click", async (event) => {
    const copyBtn = event.target.closest("[data-copy-key]");
    if (copyBtn) {
      await copyKey(copyBtn.dataset.copyKey);
      return;
    }

    const deleteBtn = event.target.closest('[data-action="delete-project"]');
    if (!deleteBtn) return;
    const card = deleteBtn.closest("[data-project-id]");
    const projectId = card?.dataset.projectId;
    if (!projectId) return;
    const name = card.querySelector(".project-card-name")?.textContent?.trim() || projectId;
    if (!confirm(`Delete project "${name}"? This removes URLs, runs, and stored reports.`)) {
      return;
    }
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
      showMessage(`Project "${name}" deleted`);
      await loadProjects();
    } catch (err) {
      showMessage(err.message, true);
    }
  });

  try {
    await loadProjects();
  } catch (err) {
    showMessage(err.message, true);
  }
}

init();
