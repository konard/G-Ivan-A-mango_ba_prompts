// Парольный вход на сайт (issue #388).
//
// Уровень защиты — «чтобы совсем чужие не смотрели»: страница скрыта, пока не
// введён системный пароль; данные каталога загружаются только после входа.
// Пароль в коде не хранится: сверяется SHA-256(salt + пароль) с записью "site"
// в password-hashes.json. Порядок смены пароля — docs/site-access.md.
//
// Подключение: <script src="gate.js"></script> в <head> до остальных
// скриптов. Для вложенных страниц — data-base="../" (путь до корня сайта).
(function () {
  const script = document.currentScript;
  const base = (script && script.dataset.base) || "";
  const HASHES_URL = `${base}password-hashes.json`;
  const ENTRY = "site";
  const STORAGE_KEY = "mango-site-access";
  const root = document.documentElement;

  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  root.dataset.gate = "locked";

  const style = document.createElement("style");
  style.textContent = `
    html[data-gate="locked"] body > :not(.site-gate) { display: none !important; }
    .site-gate { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center;
      padding: 24px; background: var(--bg, #f7f8f3); color: var(--text, #1d211f);
      font: 16px/1.5 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .site-gate-card { width: min(420px, 100%); padding: 28px; border: 1px solid var(--border, #d9dfda);
      border-radius: 14px; background: var(--surface, #fff); box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08); }
    .site-gate-card h1 { margin: 0 0 6px; font-size: 24px; line-height: 1.25; }
    .site-gate-card p { margin: 0 0 16px; color: var(--muted, #66706b); font-size: 14px; }
    .site-gate-card input { box-sizing: border-box; width: 100%; padding: 10px 12px; font: inherit;
      border: 1px solid var(--border, #d9dfda); border-radius: 8px; margin: 4px 0 8px;
      background: var(--surface, #fff); color: var(--text, #1d211f); }
    .site-gate-card button { font: inherit; padding: 9px 16px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--teal, #0f766e); background: var(--teal, #0f766e); color: #fff; }
    .site-gate-error { min-height: 22px; margin: 0 0 8px; color: var(--red, #b42318); font-size: 14px; }
    .site-gate-label { font-size: 14px; font-weight: 600; }
  `;
  document.head.append(style);

  function normalizePassword(value) {
    return String(value || "").trim().toUpperCase();
  }

  async function digest(text) {
    const bytes = new TextEncoder().encode(text);
    const buffer = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function loadEntry() {
    const response = await fetch(HASHES_URL, { cache: "no-store" });
    const entry = (await response.json())[ENTRY];
    if (!entry || !entry.salt || !entry.hash) {
      throw new Error(`нет записи "${ENTRY}" в password-hashes.json`);
    }
    return entry;
  }

  function readToken() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function writeToken(token) {
    try {
      window.localStorage.setItem(STORAGE_KEY, token);
    } catch {
      /* без localStorage пароль спросят при следующем открытии */
    }
  }

  function unlock() {
    root.dataset.gate = "open";
    document.querySelector(".site-gate")?.remove();
    resolveReady();
  }

  function lock() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* нечего очищать */
    }
    window.location.reload();
  }

  function renderForm(entry, loadError) {
    const gate = document.createElement("div");
    gate.className = "site-gate";
    gate.innerHTML = `
      <form class="site-gate-card" autocomplete="off">
        <h1>Mango BA Prompts</h1>
        <p>Сайт закрыт паролем. Пароль выдаёт владелец репозитория.</p>
        <label for="site-gate-password" class="site-gate-label">Пароль</label>
        <input id="site-gate-password" name="password" type="password" autocomplete="off" required />
        <div class="site-gate-error" id="site-gate-error" role="alert"></div>
        <button type="submit">Войти</button>
      </form>`;
    document.body.prepend(gate);
    const form = gate.querySelector("form");
    const input = gate.querySelector("input");
    const error = gate.querySelector("#site-gate-error");
    if (loadError) {
      error.textContent = `Не удалось проверить пароль: ${loadError.message}`;
    }
    input.focus();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      try {
        const current = entry || (await loadEntry());
        const hash = await digest(current.salt + normalizePassword(input.value));
        if (hash !== current.hash) {
          error.textContent = "Неверный пароль";
          input.select();
          return;
        }
        writeToken(hash);
        unlock();
      } catch (failure) {
        error.textContent = `Не удалось проверить пароль: ${failure.message}`;
      }
    });
  }

  async function start() {
    let entry = null;
    try {
      entry = await loadEntry();
      if (readToken() === entry.hash) {
        unlock();
        return;
      }
    } catch (failure) {
      renderForm(null, failure);
      return;
    }
    renderForm(entry, null);
  }

  window.siteGate = { ready, lock };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
