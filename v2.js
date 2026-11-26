// issue #420 site-v2 prototype: Справочник deep links (#glossary?term=<id>)
// and «Процессы» stream toggles. Loaded after app.js; app.js routes pages.
(function () {
  function highlightTerm() {
    const hash = window.location.hash || "";
    if (!hash.startsWith("#glossary")) return;
    const term = new URLSearchParams(hash.split("?")[1] || "").get("term");
    document.querySelectorAll(".v2-term-row.is-highlighted").forEach((el) => el.classList.remove("is-highlighted"));
    if (!term) return;
    const row = document.getElementById(`term-${term}`);
    if (!row) return;
    row.classList.add("is-highlighted");
    window.requestAnimationFrame(() => {
      row.scrollIntoView({ block: "start" });
      row.focus({ preventScroll: true });
    });
  }
  window.addEventListener("hashchange", () => window.setTimeout(highlightTerm, 0));
  window.addEventListener("load", () => window.setTimeout(highlightTerm, 50));
})();
