async function initLogin() {
  const loginForm = document.getElementById("login-form");
  const bootstrapForm = document.getElementById("bootstrap-form");
  const errorEl = document.getElementById("auth-error");

  try {
    await api("/api/auth/me");
    window.location.href = "index.html";
    return;
  } catch {
    /* not logged in */
  }

  try {
    const { needs_bootstrap } = await api("/api/auth/setup");
    if (needs_bootstrap) {
      loginForm.classList.add("hidden");
      bootstrapForm.classList.remove("hidden");
      document.getElementById("auth-subtitle").textContent = "First-time setup";
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.add("hidden");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          login: document.getElementById("login").value,
          password: document.getElementById("password").value,
        }),
      });
      window.location.href = "index.html";
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove("hidden");
    }
  });

  bootstrapForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.add("hidden");
    try {
      await api("/api/auth/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("bootstrap-email").value,
          username: document.getElementById("bootstrap-username").value,
          password: document.getElementById("bootstrap-password").value,
        }),
      });
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          login: document.getElementById("bootstrap-email").value,
          password: document.getElementById("bootstrap-password").value,
        }),
      });
      window.location.href = "index.html";
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove("hidden");
    }
  });
}

initLogin();
