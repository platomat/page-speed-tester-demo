async function initSiteHeader() {
  const root = document.getElementById("site-header");
  if (!root) return null;

  const subtitle = root.dataset.subtitle || "";
  const page = root.dataset.page || "dashboard";
  const requireAuth = root.dataset.auth !== "false";

  let user = null;
  if (requireAuth) {
    try {
      user = (await api("/api/auth/me")).user;
      setSessionAuth(Boolean(user));
    } catch {
      setSessionAuth(false);
      window.location.href = "/login.html";
      return null;
    }
  }

  const ICON_GEAR = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>`;

  const ICON_PROJECTS = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;

  const ICON_LOGOUT = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

  const adminNav =
    user?.role === "admin"
      ? `<a href="/projects/" class="btn-secondary header-nav-btn${page === "projects" ? " is-active" : ""}">${ICON_PROJECTS}<span>Projects</span></a>
      <a href="/admin.html" class="icon-btn header-admin-btn${page === "admin" ? " is-active" : ""}" title="Settings" aria-label="Admin settings">${ICON_GEAR}</a>`
      : "";

  const userNav = user
    ? `<button id="logout-btn" type="button" class="btn-secondary header-nav-btn">${ICON_LOGOUT}<span>Logout</span></button>
       <span class="header-user">${escapeHtml(user.username)}</span>`
    : requireAuth
      ? ""
      : `<a href="/login.html" class="header-nav-link">Login</a>`;

  root.innerHTML = `
    <div class="header-row">
      <div class="header-brand">
        <a href="/" class="header-brand-link">
          <img src="/assets/img/favicon.svg" alt="" class="header-favicon" width="32" height="32" />
          <span class="header-title">Page Speed Dashboard</span>
        </a>
        ${subtitle ? `<p class="subtitle header-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <nav class="header-nav" aria-label="Account">
        ${adminNav}
        ${userNav}
      </nav>
    </div>`;

  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      sessionStorage.removeItem("pst_session_token");
      setSessionAuth(false);
      window.location.href = "/login.html";
    }
  });

  return user;
}
