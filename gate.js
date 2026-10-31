// Separate login and shared page guard. Password operations: docs/site-access.md.
(function () {
  const script = document.currentScript;
  const baseUrl = new URL(".", script.src);
  const HASHES_URL = new URL("password-hashes.json", baseUrl);
  const HOME_URL = "https://g-ivan-a.github.io/mango_ba_prompts/";
  const ENTRY = "site";
  const STORAGE_KEY = "mango-site-access";
  const isLogin = script.dataset.page === "login";
  const root = document.documentElement;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  root.dataset.gate = "locked";
  // Hide protected content before any asynchronous work, also on nested reports.
  const style = document.createElement("style");
  style.textContent = 'html[data-gate="locked"] body { visibility: hidden !important; }';
  document.head.append(style);

  async function digest(value) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function loadEntry() {
    const response = await fetch(HASHES_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("password configuration unavailable");
    const entry = (await response.json())[ENTRY];
    if (!entry || !/^[a-f0-9]{16}$/.test(entry.salt) || !/^[a-f0-9]{64}$/.test(entry.hash)) {
      throw new Error("invalid password configuration");
    }
    return entry;
  }

  function readToken() {
    try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
  }

  function loginUrl() {
    const url = new URL("login.html", baseUrl);
    // Keep explicit deep links; opening login itself always defaults to canonical home.
    if (location.pathname !== baseUrl.pathname && location.pathname !== `${baseUrl.pathname}index.html`) {
      url.searchParams.set("next", location.href);
    }
    return url;
  }

  function destination() {
    const next = new URL(location.href).searchParams.get("next");
    if (next) {
      const url = new URL(next, baseUrl);
      if (url.origin === baseUrl.origin && url.pathname.startsWith(baseUrl.pathname) &&
          url.pathname !== `${baseUrl.pathname}login.html`) return url.href;
    }
    return HOME_URL;
  }

  function lock() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Already locked. */ }
    location.replace(new URL("login.html", baseUrl));
  }

  async function start() {
    if (!isLogin) {
      try {
        const entry = await loadEntry();
        if (readToken() === entry.hash) {
          root.dataset.gate = "open";
          resolveReady();
          return;
        }
      } catch { /* Fail closed; login offers a retry. */ }
      location.replace(loginUrl());
      return;
    }
    root.dataset.gate = "open";
    const form = document.querySelector("#login-form");
    const input = form.elements.password;
    const error = document.querySelector("#login-error");
    const button = form.querySelector("button");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      button.disabled = true;
      try {
        const entry = await loadEntry();
        // Exact characters: no case conversion or whitespace normalization.
        const hash = await digest(entry.salt + input.value);
        if (hash !== entry.hash) {
          error.textContent = "Неверный пароль";
          input.select();
          return;
        }
        sessionStorage.setItem(STORAGE_KEY, hash);
        input.value = "";
        location.replace(destination());
      } catch {
        error.textContent = "Не удалось проверить пароль. Повторите попытку.";
      } finally {
        button.disabled = false;
      }
    });
    input.focus();
  }

  window.siteGate = { ready, lock };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
