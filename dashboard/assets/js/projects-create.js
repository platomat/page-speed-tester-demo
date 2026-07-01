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

async function init() {
  const user = await initSiteHeader();
  if (!user) return;
  if (user.role !== "admin") {
    window.location.href = "/";
    return;
  }

  await loadInstanceSettings();
  updateCronHint();

  document.getElementById("cancel-project-create")?.addEventListener("click", () => {
    window.location.href = "/projects/";
  });

  document.getElementById("project-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("create-project-name").value.trim();
    if (!name) {
      showMessage("Project name is required", true);
      return;
    }
    try {
      const created = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          id: document.getElementById("create-project-id").value.trim() || undefined,
          name,
          access_key: document.getElementById("create-access-key").value.trim() || undefined,
          cron_expression: document.getElementById("create-project-cron").value.trim(),
          store_fullpage_screenshots: document.getElementById("create-store-fullpage").checked,
          store_timing_screenshots: document.getElementById("create-store-timing").checked,
          lh_warmup: document.getElementById("create-lh-warmup").checked,
        }),
      });
      window.location.href = `/projects/edit.html?id=${encodeURIComponent(created.id)}`;
    } catch (err) {
      showMessage(err.message, true);
    }
  });
}

init();
