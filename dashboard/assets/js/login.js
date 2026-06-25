async function initLogin() {
  const loginForm = document.getElementById("login-form");
  const bootstrapForm = document.getElementById("bootstrap-form");
  const errorEl = document.getElementById("auth-error");
  const loginSubmit = loginForm.querySelector('button[type="submit"]');
  let loginCooldownTimer = null;

  function clearLoginCooldown() {
    if (loginCooldownTimer) {
      clearInterval(loginCooldownTimer);
      loginCooldownTimer = null;
    }
    loginSubmit.disabled = false;
  }

  function showAuthError(err) {
    let message = err.message || "Request failed";
    if (err.status === 429 && err.data?.retry_after_seconds) {
      const seconds = Number(err.data.retry_after_seconds);
      message = `Too many login attempts. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
      startLoginCooldown(seconds);
    } else {
      clearLoginCooldown();
    }
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }

  function startLoginCooldown(seconds) {
    clearLoginCooldown();
    let remaining = Math.max(1, Math.ceil(Number(seconds) || 0));
    loginSubmit.disabled = true;

    const tick = () => {
      errorEl.textContent = `Too many login attempts. Try again in ${remaining} second${remaining === 1 ? "" : "s"}.`;
      remaining -= 1;
      if (remaining < 0) {
        clearLoginCooldown();
        errorEl.textContent = "You can try logging in again.";
        errorEl.classList.remove("hidden");
      }
    };

    tick();
    loginCooldownTimer = setInterval(tick, 1000);
  }

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
      showAuthError(err);
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
