const state = {
  prompts: [],
  stats: null,
  roadmap: null,
  checks: null,
  processes: null,
  patterns: null,
  processTree: null,
  bcreqFlow: null,
  testKit: null,
  selectedFilters: new Set(),
  query: "",
  sort: "updated",
};

const PAGES = ["about", "catalog", "standards", "dashboard", "roadmap", "processes", "patterns", "glossary"];
const THEME_KEY = "mango-theme";

const nodes = {
  metrics: document.querySelector("#metrics-grid"),
  phases: document.querySelector("#phase-lane"),
  filters: document.querySelector("#filters-root"),
  promptGrid: document.querySelector("#prompt-grid"),
  resultCount: document.querySelector("#result-count"),
  search: document.querySelector("#search-input"),
  suggestions: document.querySelector("#search-suggestions"),
  sort: document.querySelector("#sort-select"),
  exportButton: document.querySelector("#export-button"),
  clearSearch: document.querySelector("#clear-search-button"),
  clearFilters: document.querySelector("#clear-filters-button"),
  checksGrid: document.querySelector("#checks-grid"),
  checksByProcess: document.querySelector("#checks-byprocess"),
  checksActivity: document.querySelector("#checks-activity"),
  roadmapLevels: document.querySelector("#roadmap-levels"),
  roadmapGaps: document.querySelector("#roadmap-gaps"),
  processNote: document.querySelector("#process-note"),
  processActions: document.querySelector("#process-actions"),
  processExpand: document.querySelector("#process-expand"),
  processCollapse: document.querySelector("#process-collapse"),
  processTree: document.querySelector("#process-tree"),
  processGrid: document.querySelector("#process-grid"),
  bcreqRules: document.querySelector("#bcreq-rules"),
  bcreqSteps: document.querySelector("#bcreq-steps"),
  testKitSummary: document.querySelector("#bcreq-testkit-summary"),
  testKitSteps: document.querySelector("#bcreq-testkit-steps"),
  processTabs: document.querySelector("#process-tabs"),
  processHelp: document.querySelector("#process-help"),
  bcreqRoute: document.querySelector("#bcreq-route"),
  siteVersion: document.querySelectorAll("[data-site-version]"),
  bcreqApprovalLead: document.querySelector("#bcreq-approval-lead"),
  bcreqStages: document.querySelector("#bcreq-stages"),
  bcreqReturns: document.querySelector("#bcreq-returns"),
  bcreqImprovements: document.querySelector("#bcreq-improvements"),
  patternGrid: document.querySelector("#pattern-grid"),
  topnav: document.querySelector("#topnav"),
  themeToggle: document.querySelector("#theme-toggle"),
  logout: document.querySelector("#site-logout"),
  modal: document.querySelector("#process-modal"),
  modalBody: document.querySelector("#modal-body"),
  modalClose: document.querySelector("#modal-close"),
  toast: document.querySelector("#toast"),
};

// Режимы промптов: «manual» — 39 классов BCREQ (issue #423), БА копирует класс в чат.
const MODE_LABELS = {
  manual: "Ручной",
  stepwise: "Stepwise",
  oneshot: "One-shot",
  legacy: "Legacy",
};

const KIND_LABELS = {
  direct: "промпт",
  support: "поддержка",
};

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\s+/g, " ")
    .trim();
}

function promptStatus(prompt) {
  return prompt.archived ? "archived" : prompt.status;
}

// Количество тестовых логов по промпту берём из checks.json (динамически).
function testsFor(prompt) {
  if (!state.checks) {
    return 0;
  }
  const entry = state.checks.prompts.find((item) => item.id === prompt.id);
  return entry ? entry.tests : 0;
}

function usageFor(prompt) {
  if (!state.checks) {
    return 0;
  }
  const entry = state.checks.prompts.find((item) => item.id === prompt.id);
  return entry ? entry.usage : 0;
}

function selectedValues(kind) {
  const prefix = `${kind}:`;
  return [...state.selectedFilters]
    .filter((token) => token.startsWith(prefix))
    .map((token) => token.slice(prefix.length));
}

function promptSearchText(prompt) {
  return normalize([
    prompt.id,
    prompt.file,
    prompt.title,
    prompt.description,
    prompt.descriptionLong,
    prompt.mode,
    prompt.status,
    prompt.operation.id,
    prompt.operation.label,
    prompt.processes.join(" "),
    (prompt.filterProcesses || []).join(" "),
    prompt.archiveInfo ? `Архивная версия ${prompt.archiveInfo.siteVersion} ${prompt.archiveInfo.step}` : "",
  ].join(" "));
}

// Сортировка карточек (ФТ-4): дата обновления, популярность, алфавит, статус.
function sortPrompts(prompts) {
  const sorted = [...prompts];
  const statusRank = { canonical: 0, draft: 1, archived: 2, unknown: 3 };
  if (state.sort === "alpha") {
    sorted.sort((left, right) => left.title.localeCompare(right.title, "ru"));
  } else if (state.sort === "usage") {
    sorted.sort((left, right) => usageFor(right) - usageFor(left) || left.title.localeCompare(right.title, "ru"));
  } else if (state.sort === "status") {
    sorted.sort(
      (left, right) =>
        (statusRank[promptStatus(left)] ?? 9) - (statusRank[promptStatus(right)] ?? 9) ||
        left.title.localeCompare(right.title, "ru"),
    );
  } else {
    // updated: свежие сверху, без даты — в конец.
    sorted.sort((left, right) => String(right.updated || "").localeCompare(String(left.updated || "")));
  }
  return sorted;
}

// Внутри одного фильтра — ИЛИ (несколько значений), между фильтрами — И.
// Архив (issue #423): 14 промптов этапа 1 скрыты, пока не выбран набор «Архив»;
// по умолчанию каталог показывает 39 классов BCREQ.
function archiveSelected() {
  return selectedValues("family").includes("archive");
}

function matchingPrompts(excludedKind = "", { includeArchive = archiveSelected() } = {}) {
  const query = normalize(state.query);
  const selectedProcesses = excludedKind === "process" ? [] : selectedValues("process");
  const selectedOperations = excludedKind === "operation" ? [] : selectedValues("operation");
  const selectedModes = excludedKind === "mode" ? [] : selectedValues("mode");
  const selectedFamilies = selectedValues("family");

  return state.prompts.filter((prompt) => {
    if (prompt.archived && !includeArchive) {
      return false;
    }
    if (query && !promptSearchText(prompt).includes(query)) {
      return false;
    }
    if (
      selectedProcesses.length > 0 &&
      !(prompt.filterProcesses || prompt.processes).some((process) => selectedProcesses.includes(process))
    ) {
      return false;
    }
    if (selectedOperations.length > 0 && !selectedOperations.includes(prompt.operation.id)) {
      return false;
    }
    if (selectedModes.length > 0 && !selectedModes.includes(prompt.mode)) {
      return false;
    }
    if (selectedFamilies.length > 0 && !selectedFamilies.includes(prompt.family)) {
      return false;
    }
    return true;
  });
}

function visiblePrompts() {
  return sortPrompts(matchingPrompts());
}

// Ignore only this facet's selection: alternatives within it remain OR choices.
// Query, modes, family and the opposite facet still constrain each count.
function facetCounts(kind) {
  const counts = {};
  for (const prompt of matchingPrompts(kind)) {
    const values =
      kind === "process" ? [...new Set(prompt.filterProcesses || prompt.processes)] : kind === "mode" ? [prompt.mode] : [prompt.operation.id];
    for (const value of values) {
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return counts;
}

function showToast(message) {
  nodes.toast.textContent = message;
  nodes.toast.dataset.visible = "true";
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    nodes.toast.dataset.visible = "false";
  }, 2200);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function downloadFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Экспорт каталога по выделенным фильтрам в Markdown (ФТ-4).
function exportCatalog() {
  const prompts = visiblePrompts();
  const lines = ["# Каталог промптов Mango BA", "", `Промптов в выборке: ${prompts.length} из ${state.prompts.length}`, ""];
  for (const prompt of prompts) {
    lines.push(`## ${prompt.title}`);
    lines.push("");
    lines.push(`- **ID:** \`${prompt.id}\``);
    lines.push(`- **Версия:** ${prompt.version} · **Обновлён:** ${prompt.updated || "—"}`);
    lines.push(`- **Режим:** ${prompt.mode} · **Статус:** ${promptStatus(prompt)} · **Тестов:** ${testsFor(prompt)}`);
    lines.push(`- **Операция:** ${prompt.operation.label}`);
    if (prompt.processes.length > 0) {
      lines.push(`- **Процессы:** ${prompt.processes.join(", ")}`);
    }
    lines.push(`- **Файл:** ${prompt.url}`);
    lines.push("");
    lines.push(prompt.descriptionLong || prompt.description);
    lines.push("");
  }
  downloadFile("mango-ba-catalog.md", lines.join("\n"), "text/markdown;charset=utf-8");
  showToast(`Экспортировано промптов: ${prompts.length}`);
}

function renderSuggestions() {
  const options = state.prompts.map((prompt) => {
    const option = document.createElement("option");
    option.value = prompt.title;
    option.label = prompt.id;
    return option;
  });
  nodes.suggestions.replaceChildren(...options);
}

function renderMetrics() {
  const totals = state.stats.totals;
  const metrics = [
    ["Всего", totals.allPrompts],
    ["Активных", totals.activePrompts],
    ["Архив", totals.archivedPrompts],
    ["Canonical", totals.statuses.canonical || 0],
    ["В работе", totals.inWork],
    ["Операций", state.stats.taxonomy.operations],
  ];
  if (state.stats.siteVersion) {
    metrics.push(["Версия сайта", state.stats.siteVersion.version]);
  }

  nodes.metrics.replaceChildren(
    ...metrics.map(([label, value]) => {
      const tile = el("div", "metric-tile");
      tile.append(el("span", "metric-value", String(value)));
      tile.append(el("span", "metric-label", label));
      return tile;
    }),
  );
}

// Версия сайта (issue #423): единый источник — SITE_VERSION в
// scripts/generate-pages-data.mjs → stats.json.siteVersion.
function renderSiteVersion() {
  const info = state.stats?.siteVersion;
  if (!info) {
    return;
  }
  const title = `Версия сайта ${info.version} от ${info.released} — ${info.basis} (issue #${info.issue})`;
  for (const node of nodes.siteVersion) {
    node.textContent = `v${info.version}`;
    node.title = title;
    if (node.tagName === "A") {
      node.href = `https://github.com/G-Ivan-A/mango_ba_prompts/blob/main/${info.changelog}`;
      node.target = "_blank";
      node.rel = "noreferrer";
    }
  }
  const panel = document.querySelector("#about-version");
  if (panel) {
    const totals = state.stats.totals;
    const list = el("ul", "v2-list");
    list.append(
      el("li", "", `Каталог: ${totals.activePrompts} классов ручных промптов BCREQ; ${totals.archivedPrompts} архивных редакций — в архиве (фильтр «Архив»).`),
      el("li", "", "Процесс BCREQ на странице «Процессы» переписан под 39 классов: маршрут по стадиям, шаги Ш-1…Ш-39, гейты Г-IN, Г-С1, Г-W."),
      el("li", "", "Разделы: О проекте, Каталог, Стандарты, Процессы, Дашборд, Справочник."),
    );
    const head = el("h2", "", `Версия сайта ${info.version}`);
    const meta = el("p", "v2-links", `${info.released} · ${info.basis} · `);
    meta.append(externalLink(`https://github.com/G-Ivan-A/mango_ba_prompts/blob/main/${info.changelog}`, "CHANGELOG"));
    panel.replaceChildren(head, meta, list);
  }
}

function renderPhases() {
  // Зрелость «Мультиагенты» вынесена в отдельный модуль «Проверки» (см. renderChecks).
  const phases = state.stats.phases.filter((phase) => phase.id !== "multiagents");
  nodes.phases.replaceChildren(
    ...phases.map((phase) => {
      const card = el("article", "phase-card");
      card.dataset.status = phase.status;

      const top = el("div", "phase-top");
      top.append(el("span", "phase-index", String(phase.phase)));
      top.append(el("span", "status-pill", phase.status === "current" ? "сейчас" : "план"));

      const title = el("h3", "", phase.title);
      const summary = el("p", "phase-summary", phase.summary);
      const track = el("div", "progress-track");
      const bar = el("div", "progress-bar");
      bar.style.width = `${phase.progress}%`;
      track.append(bar);

      const metrics = el("div", "phase-metrics");
      for (const metric of phase.metrics) {
        const item = el("span", "phase-metric");
        item.append(el("strong", "", String(metric.value)));
        item.append(document.createTextNode(metric.label));
        metrics.append(item);
      }

      card.append(top, title, summary, track, metrics);
      return card;
    }),
  );
}

function filterButton({ token, icon, label, count, title, unavailable }) {
  const button = el("button", "filter-button");
  button.type = "button";
  button.dataset.filterToken = token;
  button.setAttribute("aria-pressed", String(state.selectedFilters.has(token)));
  if (unavailable && !state.selectedFilters.has(token)) {
    button.disabled = true;
    button.dataset.unavailable = "true";
    button.setAttribute("aria-disabled", "true");
  }
  button.title = title || label;
  button.append(el("span", "filter-icon", icon));
  button.append(el("span", "filter-label", label));
  button.append(el("span", "filter-count", String(count || 0)));
  return button;
}

function renderFilterGroup(title, items, groupClass) {
  const group = el("section", `filter-group${groupClass ? ` ${groupClass}` : ""}`);
  const heading = el("div", "filter-title", title);
  const row = el("div", "filter-row");
  row.append(...items.map(filterButton));
  group.append(heading, row);
  return group;
}

function renderFilters() {
  const processCounts = facetCounts("process");
  const operationCounts = facetCounts("operation");
  const processes = state.promptsData.filters.processes.map((process) => ({
    token: `process:${process.label}`,
    icon: process.emoji || process.icon,
    label: process.label,
    count: processCounts[process.label] || 0,
    title: `${process.label}: ${process.description}`,
    unavailable: !processCounts[process.label],
  }));

  const operations = state.promptsData.filters.operations.map((operation) => ({
    token: `operation:${operation.id}`,
    icon: operation.icon,
    label: operation.label,
    count: operationCounts[operation.id] || 0,
    title:
      !operationCounts[operation.id]
        ? `${operation.label}: нет промптов при текущих фильтрах`
        : `${operation.label}: ${operation.description}`,
    unavailable: !operationCounts[operation.id],
  }));

  const modeCounts = facetCounts("mode");
  const modes = state.promptsData.filters.modes.map((mode) => ({
    token: `mode:${mode}`,
    icon: state.prompts.find((prompt) => prompt.mode === mode)?.modeIcon || "•",
    label: MODE_LABELS[mode] || mode,
    count: modeCounts[mode] || 0,
    title: modeCounts[mode]
      ? `${MODE_LABELS[mode] || mode}: ${mode}`
      : `${MODE_LABELS[mode] || mode}: только в архиве — выберите набор «Архив»`,
    unavailable: !modeCounts[mode],
  }));

  // Набор (issue #388): новые промпты BCREQ, прочие действующие, архив.
  const families = (state.promptsData.filters.families || []).map((family) => ({
    token: `family:${family.id}`,
    icon: family.icon,
    label: family.label,
    count: family.count,
    title: family.description,
  }));

  nodes.filters.replaceChildren(
    renderFilterGroup("Набор", families, "filter-group--families"),
    renderFilterGroup("Процессы БА", processes, "filter-group--processes"),
    renderFilterGroup("Операции", operations, "filter-group--operations"),
    renderFilterGroup("Режимы", modes, "filter-group--modes"),
  );
}

// Иконка «скопировать промпт» (issue #388): тот же формат копирования, что у
// кнопки «Копировать» — обработчик ищет промпт по data-copy-id.
function copyIconButton(prompt) {
  const button = el("button", "copy-icon", "⧉");
  button.type = "button";
  button.dataset.copyId = prompt.id;
  button.title = `Скопировать промпт ${prompt.file}`;
  button.setAttribute("aria-label", `Скопировать промпт ${prompt.file}`);
  return button;
}

function promptCard(prompt) {
  const card = el("article", "prompt-card");
  card.dataset.archived = String(prompt.archived);
  card.dataset.family = prompt.family || "other";

  const head = el("div", "prompt-head");
  const titleWrap = el("div");
  if (prompt.classId) {
    const step = prompt.flowStep ? ` · шаг потока ${prompt.flowStep}` : "";
    const badge = el("span", "new-badge", `★ BCREQ · класс ${prompt.classId}${step}`);
    badge.title = "Класс ручного промпта BCREQ (PR #422, issue #423)";
    titleWrap.append(badge);
  } else if (prompt.archived) {
    const badge = el("span", "archive-badge", `⌛ Архивная версия · ${prompt.archiveInfo ? `сайт ${prompt.archiveInfo.siteVersion} · ${prompt.archiveInfo.step}` : "этап 1"}`);
    badge.title = prompt.archiveInfo ? "Полная редакция 2.7.0; заменена отдельными вызовами AIN. Текст сохранён без сокращений." : "Промпт этапа 1 перенесён в архив: его заменяют классы К-01…К-39 (issue #423)";
    titleWrap.append(badge);
  } else if (prompt.isNew) {
    const badge = el("span", "new-badge", "★ BCREQ · новый");
    badge.title = "Новый промпт набора BCREQ (issue #388)";
    titleWrap.append(badge);
  }
  titleWrap.append(el("h3", "prompt-title", prompt.title));
  const idLabel = el("span", "prompt-id", prompt.id);
  idLabel.title = "Уникальный токен промпта";
  titleWrap.append(idLabel);
  head.append(titleWrap, copyIconButton(prompt));

  const description = el("p", "prompt-description", prompt.descriptionLong || prompt.description);

  // Мета-строка вместо хэша: версия, дата обновления, статус тестов.
  const tests = testsFor(prompt);
  const meta = el("div", "prompt-meta");
  meta.append(el("span", "prompt-meta-item", `v${String(prompt.version).replace(/^v/, "")}`));
  if (prompt.updated) {
    meta.append(el("span", "prompt-meta-item", prompt.updated));
  }
  const testItem = el("span", "prompt-meta-item", tests > 0 ? `✅ ${tests} тест(ов)` : "тестов нет");
  testItem.dataset.kind = tests > 0 ? "tested" : "untested";
  meta.append(testItem);

  const tags = el("div", "tag-row");
  const mode = el("span", "tag", `${prompt.modeIcon} ${MODE_LABELS[prompt.mode] || prompt.mode}`);
  mode.dataset.kind = "mode";
  const status = el("span", "tag", promptStatus(prompt));
  status.dataset.kind = "status";
  const operation = el("span", "tag", `${prompt.operation.icon} ${prompt.operation.label}`);
  operation.dataset.kind = "operation";
  tags.append(mode, status, operation);
  for (const process of prompt.processDetails.length > 0 ? prompt.processDetails : prompt.processes.map((label) => ({ label, emoji: "🗂️" }))) {
    const tag = el("span", "tag", `${process.emoji || "🗂️"} ${process.label}`);
    tag.dataset.kind = "process";
    tags.append(tag);
  }

  const actions = el("div", "prompt-actions");
  const copy = el("button", "copy-button");
  copy.type = "button";
  copy.dataset.copyId = prompt.id;
  copy.append(el("span", "", "⧉"));
  copy.append(el("span", "", "Копировать"));
  const repoLink = el("a", "repo-link");
  repoLink.href = prompt.url;
  repoLink.target = "_blank";
  repoLink.rel = "noreferrer";
  repoLink.title = "Открыть файл в GitHub";
  repoLink.setAttribute("aria-label", `Открыть ${prompt.file} в GitHub`);
  repoLink.append(el("span", "", "📁"));
  repoLink.append(el("span", "", "Перейти в репо"));
  actions.append(copy, repoLink);

  card.append(head, description, meta, tags);
  const links = promptLinks(prompt);
  if (links) {
    card.append(links);
  }
  card.append(actions);
  return card;
}

function linkTo(url, text, title) {
  const link = el("a", "prompt-link", text);
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  if (title) {
    link.title = title;
  }
  return link;
}

// Связи класса и архива (issue #423): класс → контракт состояния и аналог из
// архива; архивный промпт → классы, которые его заменили.
function promptLinks(prompt) {
  const row = el("div", "prompt-links");
  if (prompt.classId) {
    const contract = state.promptsData.stateContract;
    if (contract) {
      row.append(el("span", "prompt-links-label", "Контракт:"));
      row.append(linkTo(contract.url, "состояние BCREQ", contract.path));
    }
    if (prompt.analog) {
      row.append(el("span", "prompt-links-label", "Аналог в архиве:"));
      row.append(linkTo(prompt.analog.url, prompt.analog.file, prompt.analog.path));
    }
  } else if (prompt.archiveInfo) {
    row.append(el("span", "prompt-links-label", "Заменён шагами:"));
    for (const id of prompt.archiveInfo.replacedBy) {
      const link = el("a", "prompt-link", id);
      link.href = `#processes?ain=${id}`;
      row.append(link);
    }
    row.append(linkTo(`https://github.com/G-Ivan-A/mango_ba_prompts/blob/${prompt.archiveInfo.sourceCommit}/${prompt.archiveInfo.sourcePath}`, "Исходная редакция 2.7.0"));
  } else if (prompt.archived && (prompt.successors || []).length > 0) {
    row.append(el("span", "prompt-links-label", "Заменён классами:"));
    for (const classId of prompt.successors) {
      const successor = state.prompts.find((item) => item.classId === classId);
      if (!successor) {
        row.append(el("span", "prompt-link", classId));
        continue;
      }
      const link = el("a", "prompt-link", classId);
      link.href = `#prompt=${successor.id}`;
      link.title = successor.title;
      row.append(link);
    }
  } else if (prompt.archived) {
    // В catalog.json PR #422 у этого промпта нет класса-аналога: не выдумываем связь.
    row.append(el("span", "prompt-links-label", "Прямого класса-аналога нет:"));
    const link = el("a", "prompt-link", "маршрут 39 классов");
    link.href = "#processes";
    link.title = "Ручной процесс BCREQ v0.2 на странице «Процессы»";
    row.append(link);
  }
  return row.childElementCount > 0 ? row : null;
}

function renderPrompts() {
  const prompts = visiblePrompts();
  const archived = state.prompts.filter((prompt) => prompt.archived).length;
  const total = archiveSelected() ? state.prompts.length : state.prompts.length - archived;
  let summary = `${prompts.length} из ${total}`;
  if (!archiveSelected()) {
    const hidden = matchingPrompts("", { includeArchive: true }).length - prompts.length;
    summary += hidden > 0 ? ` · в архиве ещё ${hidden}` : ` · архив ${archived}`;
  }
  nodes.resultCount.value = summary;

  if (prompts.length === 0) {
    nodes.promptGrid.replaceChildren(el("div", "empty-state", "Ничего не найдено"));
    return;
  }

  nodes.promptGrid.replaceChildren(...prompts.map(promptCard));
}

function statusBar(segments) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  const bar = el("div", "check-bar");
  for (const segment of segments) {
    if (segment.value <= 0) {
      continue;
    }
    const part = el("span", "check-bar-part");
    part.dataset.kind = segment.kind;
    part.style.width = `${Math.round((segment.value / total) * 100)}%`;
    part.title = `${segment.label}: ${segment.value}`;
    bar.append(part);
  }
  return bar;
}

function checkCard(title, valueNode, footNode) {
  const card = el("article", "check-card");
  card.append(el("p", "check-title", title));
  card.append(valueNode);
  if (footNode) {
    card.append(footNode);
  }
  return card;
}

function checkMetrics(items) {
  const wrap = el("div", "check-metrics");
  for (const [value, label] of items) {
    const item = el("span", "check-metric");
    item.append(el("strong", "", String(value)));
    item.append(document.createTextNode(label));
    wrap.append(item);
  }
  return wrap;
}

function renderChecks() {
  if (!state.checks) {
    return;
  }
  const checks = state.checks;
  const statuses = checks.statuses || {};
  const testsPassed = checks.testsPassed || { covered: 0, total: 0, percent: 0 };

  const statusValue = el("div", "check-value-block");
  statusValue.append(
    statusBar([
      { kind: "canonical", value: statuses.canonical || 0, label: "canonical" },
      { kind: "draft", value: statuses.draft || 0, label: "draft" },
      { kind: "archived", value: statuses.archived || 0, label: "archived" },
    ]),
  );
  statusValue.append(
    checkMetrics([
      [statuses.canonical || 0, "canonical"],
      [statuses.draft || 0, "draft"],
      [statuses.archived || 0, "archived"],
    ]),
  );
  const statusCard = checkCard("Статус отладки", statusValue);

  // ФТ-3: всего проверено + тесты пройдены (X/Y, %).
  const checkedValue = el("span", "check-big", String(checks.totalChecked ?? checks.tests.total));
  const checkedFoot = checkMetrics([
    [`${testsPassed.covered}/${testsPassed.total}`, "промптов с тестами"],
    [`${testsPassed.percent}%`, "покрытие тестами"],
  ]);
  const checkedCard = checkCard("Всего проверок", checkedValue, checkedFoot);

  const feedbackValue = el("span", "check-big", String(checks.feedback.total));
  const feedbackFoot = checkMetrics([
    [checks.feedback.prompts, "промптов с feedback"],
    [checks.feedback.label, ""],
  ]);
  const feedbackCard = checkCard("Обратная связь", feedbackValue, feedbackFoot);

  nodes.checksGrid.replaceChildren(statusCard, checkedCard, feedbackCard);

  // ФТ-3: проверки по процессам (динамически, включая «Прочее»).
  const byProcess = checks.byProcess || [];
  if (byProcess.length > 0) {
    const heading = el("p", "check-activity-title", "Проверки по процессам БА");
    const maxChecks = Math.max(...byProcess.map((entry) => entry.checks), 1);
    const grid = el("div", "byprocess-grid");
    for (const entry of byProcess) {
      const row = el("article", "byprocess-card");
      const top = el("div", "byprocess-head");
      top.append(el("span", "byprocess-icon", entry.emoji || "🗂️"));
      top.append(el("span", "byprocess-label", entry.label));
      top.append(el("span", "byprocess-count", String(entry.checks)));
      const track = el("div", "progress-track");
      const bar = el("div", "progress-bar");
      bar.style.width = `${Math.round((entry.checks / maxChecks) * 100)}%`;
      track.append(bar);
      row.append(top, track, el("span", "byprocess-foot", `${entry.coveredPrompts} промптов с тестами`));
      grid.append(row);
    }
    nodes.checksByProcess.replaceChildren(heading, grid);
  } else {
    nodes.checksByProcess.replaceChildren();
  }

  // ФТ-3: блок «Активность» — топ-5 промптов по использованию.
  const topPrompts = checks.prompts.filter((prompt) => prompt.usage > 0).slice(0, 5);
  if (topPrompts.length === 0) {
    nodes.checksActivity.replaceChildren(
      el("div", "empty-state", "Нет зафиксированной активности использования"),
    );
    return;
  }

  const heading = el("p", "check-activity-title", "Активность — топ-5 промптов");
  const list = el("ol", "top-list");
  for (const prompt of topPrompts) {
    const row = el("li", "top-row");
    row.append(el("span", "top-id", prompt.id));
    const meta = el("span", "activity-meta");
    meta.append(el("span", "activity-chip", `тестов ${prompt.tests}`));
    if (prompt.feedback > 0) {
      const fb = el("span", "activity-chip", `feedback ${prompt.feedback}`);
      fb.dataset.kind = "feedback";
      meta.append(fb);
    }
    row.append(meta);
    list.append(row);
  }
  nodes.checksActivity.replaceChildren(heading, list);
}

function renderRoadmap() {
  nodes.roadmapLevels.replaceChildren(
    ...state.roadmap.levels.map((level) => {
      const card = el("article", "roadmap-card");
      card.dataset.status = level.status;
      card.append(el("span", "roadmap-number", String(level.number)));
      card.append(el("h3", "", level.title));
      card.append(el("p", "", level.howItWorks));
      card.append(el("p", "", level.exitCriteria));
      return card;
    }),
  );

  nodes.roadmapGaps.replaceChildren(
    ...state.roadmap.gaps.map((gap) => {
      const card = el("article", "gap-card");
      card.append(el("h3", "", gap.gap));
      card.append(el("p", "", gap.why));
      card.append(el("p", "", gap.nextArtifact));
      return card;
    }),
  );
}

// Процесс BCREQ (issue #388): ручные шаги БА с копированием промпта и
// согласование с командой и Заказчиком. Данные — data/bcreq-flow.json.
function bcreqField(label, value, field) {
  const row = el("div", "bcreq-field");
  if (field) {
    row.dataset.field = field;
  }
  row.append(el("span", "bcreq-field-label", label), el("span", "bcreq-field-value", value));
  return row;
}

function bcreqStep(step) {
  const item = el("li", "bcreq-step");
  item.dataset.stage = step.stage;
  item.id = `bcreq-step-${step.number}`;
  item.tabIndex = -1;

  const head = el("div", "bcreq-step-head");
  const number = el("span", "bcreq-step-number", String(step.number));
  number.setAttribute("aria-hidden", "true");
  const titleWrap = el("div", "bcreq-step-title-wrap");
  titleWrap.append(el("h3", "bcreq-step-title", step.step));
  // Класс может работать на нескольких стадиях (issue #423): тег на каждую.
  const stageTags = el("div", "tag-row");
  for (const code of step.stages && step.stages.length ? step.stages : [step.stage]) {
    const stage = el("span", "tag", code);
    stage.dataset.kind = "stage";
    stageTags.append(stage);
  }
  titleWrap.append(stageTags);

  const copy = el("button", "copy-icon", "⧉");
  copy.type = "button";
  copy.dataset.copyId = step.prompt.id;
  copy.title = `Скопировать промпт ${step.prompt.file}`;
  copy.setAttribute("aria-label", `Скопировать промпт шага ${step.step}`);
  head.append(number, titleWrap, copy);

  const prompt = el("p", "bcreq-step-prompt");
  const link = el("a", "", step.prompt.title || step.prompt.file);
  link.title = step.prompt.file;
  link.href = step.prompt.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  prompt.append(el("span", "bcreq-field-label", "Промпт"), link);
  if (step.params && step.params !== "—") {
    prompt.append(el("code", "bcreq-params", step.params));
  }

  const actions = el("ol", "bcreq-actions");
  actions.append(...step.actions.map((action) => el("li", "", action)));

  item.append(
    head,
    prompt,
    bcreqField("Что подготовить", step.prepare, "prepare"),
    el("div", "bcreq-field-label", "Что делает БА"),
    actions,
    bcreqField("Результат", step.result, "result"),
  );
  if (step.gate && step.gate !== "—") {
    item.append(el("p", "bcreq-gate", `⛳ ${step.gate}`));
  }
  return item;
}

function bcreqTable(table, headers, rows) {
  const thead = el("thead");
  const headRow = el("tr");
  headRow.append(...headers.map((header) => el("th", "", header)));
  thead.append(headRow);
  const tbody = el("tbody");
  for (const cells of rows) {
    const row = el("tr");
    row.append(...cells.map((cell) => el("td", "", cell)));
    tbody.append(row);
  }
  table.replaceChildren(thead, tbody);
}

function renderBcreqFlow() {
  const flow = state.bcreqFlow;
  if (!flow || !nodes.bcreqSteps) {
    return;
  }
  nodes.bcreqRules.replaceChildren(
    ...flow.manual.rules.map((rule) => {
      const item = el("li", "bcreq-rule");
      item.append(el("strong", "", rule.id), document.createTextNode(` ${rule.text}`));
      return item;
    }),
  );
  nodes.bcreqSteps.replaceChildren(...flow.manual.steps.map(bcreqStep));
  renderBcreqRoute(flow.manual);

  const lead = nodes.bcreqApprovalLead;
  const basis = el("a", "", flow.approval.basis.label);
  basis.href = flow.approval.basis.url;
  basis.target = "_blank";
  basis.rel = "noreferrer";
  const contract = el("a", "", flow.approval.contract.label);
  contract.href = flow.approval.contract.url;
  contract.target = "_blank";
  contract.rel = "noreferrer";
  lead.replaceChildren(
    document.createTextNode("Усовершенствованная версия описания процесса "),
    basis,
    document.createTextNode(". Стадии, гейты и возвраты — по документу «"),
    contract,
    document.createTextNode("». Каждый гейт проходит человек; модель готовит только отчёт по критериям."),
  );

  nodes.bcreqStages.replaceChildren(
    ...flow.approval.stages.map((stage) => {
      const card = el("article", "bcreq-stage");
      const head = el("div", "bcreq-stage-head");
      head.append(el("h3", "bcreq-stage-title", stage.stage));
      const tags = el("div", "tag-row");
      const phase = el("span", "tag", stage.phase);
      phase.dataset.kind = "stage";
      tags.append(phase);
      if (stage.gate && stage.gate !== "—") {
        const gate = el("span", "tag", `⛳ ${stage.gate}`);
        gate.dataset.kind = "gate";
        tags.append(gate);
      }
      head.append(tags);
      const actions = el("ul", "bcreq-actions");
      actions.append(...stage.actions.map((action) => el("li", "", action)));
      card.append(
        head,
        bcreqField("Цель", stage.goal),
        bcreqField("Вход", stage.input),
        el("div", "bcreq-field-label", "Действия"),
        actions,
        bcreqField("Выход", stage.output),
        bcreqField("Кто согласует", stage.approver),
      );
      const outcomes = stage.outcomes.filter((outcome) => outcome && outcome !== "—");
      if (outcomes.length) {
        const list = el("ul", "bcreq-outcomes");
        list.append(...outcomes.map((outcome) => el("li", "", outcome)));
        card.append(el("div", "bcreq-field-label", "Исходы"), list);
      }
      return card;
    }),
  );

  bcreqTable(
    nodes.bcreqReturns,
    ["Причина уточнения", "Стадия возврата", "Шаг-точка входа", "Что делает БА"],
    flow.approval.returns.map((item) => [item.reason, item.stage, item.entry, item.action]),
  );
  bcreqTable(
    nodes.bcreqImprovements,
    ["№", "В исходном описании", "Стало", "Зачем"],
    flow.approval.improvements.map((item) => [item.id, item.before, item.after, item.why]),
  );
}

function externalLink(url, text) {
  const link = el("a", "", text);
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}

// Маршрут по стадиям (issue #423): порядок классов К-01…К-39 по таблице процесса
// v0.2; чип ведёт к карточке шага ниже, гейт и решающая роль — справа.
function renderBcreqRoute(manual) {
  if (!nodes.bcreqRoute) {
    return;
  }
  const sources = el("p", "bcreq-route-sources");
  if (manual.classes) {
    sources.append(document.createTextNode("Промпты шагов — "), externalLink(manual.classes.url, manual.classes.label));
  }
  if (manual.contract) {
    sources.append(document.createTextNode("; каждый вызов идёт с документом «"), externalLink(manual.contract.url, manual.contract.label));
    sources.append(document.createTextNode("». Шаблоны 14 промптов этапа 1 — в архиве каталога."));
  }
  const cards = (manual.sequences || []).map((sequence) => {
    const card = el("article", "bcreq-route-stage");
    const head = el("div", "bcreq-route-head");
    head.append(el("h3", "bcreq-stage-title", sequence.stage));
    if (sequence.gate && sequence.gate !== "—") {
      const gate = el("span", "tag", `⛳ ${sequence.gate}`);
      gate.dataset.kind = "gate";
      head.append(gate);
    }
    const chain = el("ol", "bcreq-route-chain");
    for (const link of sequence.chain) {
      const item = el("li");
      const chip = el("a", "bcreq-route-chip", link.classId);
      chip.href = link.number ? `#processes?step=${link.number}` : "#processes";
      chip.title = link.number ? `Ш-${link.number} · ${link.title}` : link.title || link.classId;
      item.append(chip);
      chain.append(item);
    }
    card.append(head, chain);
    if (sequence.decides && sequence.decides !== "—") {
      card.append(bcreqField("Кто решает", sequence.decides));
    }
    return card;
  });
  const grid = el("div", "bcreq-route-grid");
  grid.append(...cards);
  nodes.bcreqRoute.replaceChildren(sources, grid);
}

function renderProcesses() {
  if (!state.processes || !nodes.processGrid) {
    return;
  }
  nodes.processGrid.replaceChildren(
    ...state.processes.processes.map((process) => {
      const card = el("article", "process-card");
      card.dataset.processId = String(process.id);
      const head = el("div", "process-head");
      head.append(el("span", "process-icon", process.emoji || "🗂️"));
      head.append(el("h3", "process-title", process.label));
      card.append(head);
      card.append(el("p", "process-description", process.description));
      const meta = el("div", "process-meta");
      meta.append(el("span", "activity-chip", `промптов ${process.prompts.length}`));
      meta.append(el("span", "activity-chip", `проверок ${process.checks}`));
      if (process.gaps.length > 0) {
        const gapChip = el("span", "activity-chip", `gaps ${process.gaps.length}`);
        gapChip.dataset.kind = "feedback";
        meta.append(gapChip);
      }
      card.append(meta);
      const hint = el("span", "process-hint", "Подробнее →");
      card.append(hint);
      return card;
    }),
  );
}

function openProcessModal(processId) {
  const process = state.processes.processes.find((item) => String(item.id) === String(processId));
  if (!process) {
    return;
  }
  const body = nodes.modalBody;
  body.replaceChildren();

  const head = el("div", "process-head");
  head.append(el("span", "process-icon", process.emoji || "🗂️"));
  head.append(el("h3", "modal-title", process.label));
  head.querySelector("h3").id = "modal-title";
  body.append(head);
  body.append(el("p", "process-description", process.description));

  if (process.operations.length > 0) {
    body.append(el("h4", "modal-subhead", "Операции"));
    const ops = el("div", "tag-row");
    for (const operationId of process.operations) {
      const tag = el("span", "tag", operationId);
      tag.dataset.kind = "operation";
      ops.append(tag);
    }
    body.append(ops);
  }

  body.append(el("h4", "modal-subhead", "Связанные промпты"));
  if (process.prompts.length > 0) {
    const list = el("ul", "modal-list");
    for (const prompt of process.prompts) {
      const item = el("li", "modal-list-row");
      const link = el("a", "modal-link", `${prompt.modeIcon || "•"} ${prompt.title}`);
      link.href = prompt.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      item.append(link);
      item.append(el("span", "modal-list-id", prompt.id));
      list.append(item);
    }
    body.append(list);
  } else {
    body.append(el("p", "process-description", "Промпты пока не привязаны."));
  }

  if (process.patterns.length > 0) {
    body.append(el("h4", "modal-subhead", "Подпроцессы и паттерны"));
    const list = el("ul", "modal-list");
    for (const pattern of process.patterns) {
      const item = el("li", "modal-list-row");
      const link = el("a", "modal-link", pattern.slug);
      link.href = pattern.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      item.append(link);
      list.append(item);
    }
    body.append(list);
  }

  if (process.gaps.length > 0) {
    body.append(el("h4", "modal-subhead", "Known gaps"));
    const list = el("ul", "modal-list");
    for (const gap of process.gaps) {
      const item = el("li", "modal-gap-row");
      item.append(el("span", "modal-gap-title", gap.gap));
      if (gap.nextArtifact) {
        item.append(el("span", "modal-gap-next", gap.nextArtifact));
      }
      list.append(item);
    }
    body.append(list);
  }

  nodes.modal.hidden = false;
}

function closeProcessModal() {
  nodes.modal.hidden = true;
}

function renderPatterns() {
  if (!state.patterns) {
    return;
  }
  nodes.patternGrid.replaceChildren(
    ...state.patterns.patterns.map((pattern) => {
      const card = el("article", "pattern-card");
      const head = el("div", "process-head");
      head.append(el("span", "process-icon", pattern.operationIcon || "•"));
      head.append(el("h3", "process-title", pattern.slug));
      const link = el("a", "source-link", "↗");
      link.href = pattern.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.title = "Открыть паттерн в GitHub";
      const headWrap = el("div", "pattern-head");
      headWrap.append(head, link);
      card.append(headWrap);
      if (pattern.whenToStart) {
        card.append(el("p", "process-description", pattern.whenToStart));
      }
      const tags = el("div", "tag-row");
      for (const process of pattern.processes) {
        const tag = el("span", "tag", process);
        tag.dataset.kind = "process";
        tags.append(tag);
      }
      const operation = el("span", "tag", pattern.operation);
      operation.dataset.kind = "operation";
      tags.append(operation);
      card.append(tags);
      if (pattern.prompts.length > 0) {
        const list = el("ul", "modal-list");
        for (const prompt of pattern.prompts) {
          const item = el("li", "modal-list-row");
          const promptLink = el("a", "modal-link", `${prompt.modeIcon || "•"} ${prompt.title}`);
          promptLink.href = prompt.url;
          promptLink.target = "_blank";
          promptLink.rel = "noreferrer";
          item.append(promptLink);
          list.append(item);
        }
        card.append(list);
      }
      return card;
    }),
  );
}

// ФТ-8: дерево «процесс -> подпроцессы». Жёсткое требование — показывать только
// процессы и подпроцессы, для которых есть промпты (hasPrompts). Полный список
// (с пустыми ветвями) остаётся в data/process-tree.json для прослеживаемости.
function subprocessRow(subprocess) {
  const row = el("li", "subprocess-row");
  const head = el("div", "subprocess-head");
  head.append(el("span", "subprocess-op", subprocess.operationIcon));
  head.append(el("span", "subprocess-step", subprocess.step));
  const kind = el("span", "subprocess-kind", KIND_LABELS[subprocess.kind] || subprocess.kind);
  kind.dataset.kind = subprocess.kind;
  kind.title =
    subprocess.kind === "support"
      ? "Ручной шаг, опирающийся на активный промпт"
      : "Шаг выполняется активным промптом";
  head.append(kind);
  row.append(head);

  const links = el("div", "subprocess-prompts");
  for (const prompt of subprocess.prompts) {
    const link = el("a", "subprocess-prompt", prompt.file);
    link.href = prompt.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = `Открыть ${prompt.file} в GitHub`;
    links.append(link);
  }
  row.append(links);
  return row;
}

function processNode(process, useTree) {
  const shown = process.subprocesses.filter((subprocess) => subprocess.hasPrompts);
  const node = el("details", "process-node");
  // > 20 подпроцессов: дерево остаётся свёрнутым (раскрывающийся список). Иначе —
  // раскрыто, список короткий и помещается на экран.
  node.open = !useTree;

  const summary = el("summary", "process-summary");
  summary.append(el("span", "process-index", process.icon));
  const titleWrap = el("span", "process-titlewrap");
  titleWrap.append(el("span", "process-tree-title", process.label));
  titleWrap.append(
    el("span", "process-count", `${shown.length} подпроцессов с промптами из ${process.subprocessTotal}`),
  );
  summary.append(titleWrap);
  node.append(summary);

  const list = el("ul", "subprocess-list");
  list.append(...shown.map(subprocessRow));
  node.append(list);
  return node;
}

function renderProcessTree() {
  if (!state.processTree || !nodes.processTree) {
    return;
  }
  const tree = state.processTree;
  const visible = tree.processes.filter((process) => process.subprocessShown > 0);

  const treeNote = tree.useTree
    ? ` Подпроцессов больше ${tree.treeThreshold} — список раскрывающийся (дерево).`
    : "";
  nodes.processNote.textContent =
    `Показаны только процессы и подпроцессы, для которых есть промпты: ` +
    `${tree.shownSubprocesses} подпроцессов из ${tree.totalSubprocesses} ` +
    `в ${tree.shownProcesses} процессах из ${tree.totalProcesses}.${treeNote}`;

  if (visible.length === 0) {
    nodes.processTree.replaceChildren(el("div", "empty-state", "Нет процессов с промптами"));
    return;
  }

  nodes.processActions.hidden = !tree.useTree;
  nodes.processTree.replaceChildren(...visible.map((process) => processNode(process, tree.useTree)));
}

function setAllProcessNodes(open) {
  for (const node of nodes.processTree.querySelectorAll("details.process-node")) {
    node.open = open;
  }
}

// Клиентский роутер на hash (по умолчанию каталог).
function currentPage() {
  const raw = (window.location.hash || "").replace(/^#/, "");
  if (raw.startsWith("prompt=")) {
    return "catalog";
  }
  const page = raw.split("?")[0];
  return PAGES.includes(page) ? page : "catalog";
}

function applyRoute() {
  const page = currentPage();
  closeProcessModal();
  for (const section of document.querySelectorAll("section[data-page]")) {
    section.hidden = section.dataset.page !== page;
  }
  for (const link of nodes.topnav.querySelectorAll("a[data-nav]")) {
    link.dataset.active = String(link.dataset.nav === page);
  }

  // Глубокая ссылка на карточку: #prompt=<id> открывает каталог и фокусирует поиск.
  const raw = (window.location.hash || "").replace(/^#/, "");
  if (raw.startsWith("prompt=")) {
    const id = decodeURIComponent(raw.slice("prompt=".length));
    const prompt = state.prompts.find((item) => item.id === id);
    if (prompt) {
      state.query = id;
      nodes.search.value = id;
      state.selectedFilters.clear();
      // Архивный промпт виден только в наборе «Архив» (issue #423).
      if (prompt.archived) {
        state.selectedFilters.add("family:archive");
      }
      rerenderInteractive();
      updateClearButtonVisibility();
    }
  }
  window.scrollTo({ top: 0, behavior: "auto" });
  // Глубокая ссылка на шаг ручного процесса: #processes?step=<N> (issue #423);
  // подстраница — #processes?view=<id> (issue #448).
  if (page === "processes") {
    const params = new URLSearchParams(raw.split("?")[1] || "");
    const ain = params.get("ain");
    const step = params.get("step");
    const ainTarget = /^AIN-(?:0[1-9]|1\d|2[0-4])$/.test(ain || "")
      ? document.querySelector(`[data-ain-step="${ain}"]`) : null;
    const target = ainTarget || (/^\d{1,2}$/.test(step || "") ? document.getElementById(`bcreq-step-${step}`) : null);
    applyProcessView(ainTarget ? "g1" : target ? "manual" : params.get("view"));
    if (target) {
      target.closest("details")?.setAttribute("open", "");
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }
  if (page === "standards") {
    const section = new URLSearchParams(raw.split("?")[1] || "").get("section");
    if (/^(?:[0-9]|ttz)$/.test(section || "")) {
      const ids = { 0: "standard-intro", 9: "standard-industry", ttz: "standard-ttz" };
      const target = document.getElementById(ids[section] || `standard-${section}`);
      if (target) {
        for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (ancestor.tagName === "DETAILS") ancestor.open = true;
        }
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: "instant", block: "start" });
      }
    }
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  nodes.themeToggle.textContent = theme === "dark" ? "☀" : "◐";
  nodes.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
}

function initTheme() {
  let stored = null;
  try {
    stored = window.localStorage.getItem(THEME_KEY);
  } catch {
    stored = null;
  }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(stored || (prefersDark ? "dark" : "light"));
}

function rerenderInteractive() {
  renderFilters();
  renderPrompts();
  if (window.MANGO_DEBUG_FILTERS === true) {
    console.debug("Catalog filters", {
      selected: [...state.selectedFilters],
      query: state.query,
      processes: facetCounts("process"),
      operations: facetCounts("operation"),
      results: visiblePrompts().length,
    });
  }
}

// Панель карточки прилипает под верхней панелью: её высота зависит от ширины окна.
function trackTopbarHeight() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) {
    return;
  }
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--topbar-height", `${topbar.offsetHeight}px`);
  }).observe(topbar);
}

// #475: expand A-IN inside the approved 2.7.0 cards and reader. The historical
// 14-step data remains available for frozen runs; it is not a second UI route.
function composeAinTestKit(kit, ain) {
  if (ain.steps?.length !== 24 || ain.steps.some((s) => !s.prompt)) {
    throw new Error("Не удалось загрузить 24 полных промпта A-IN");
  }
  const steps = kit.steps.flatMap((step) => {
    if (step.step.startsWith("Ш-А ") || step.step.startsWith("Ш-2 ")) return [];
    if (!step.step.startsWith("Ш-1 ")) return [{ ...step }];
    return ain.steps.map((s) => ({
      ainId: s.id, step: `${s.id} ${s.name}`, group: step.group,
      next: s.next, returns: s.returns, failure: s.failure, operation: s.operation,
      mode: "by-test", modeNote: "эффективность не измерена",
      purpose: s.why, prepare: s.input,
      actions: ["Передать полный промпт, правила и принятый пакет текущей версии",
        "Проверить результат и доказательства; принять эту версию либо вернуть с причиной",
        "Следующий шаг запускать отдельной командой после решения"],
      result: s.output, gate: s.id === "AIN-21" ? "Допуск к разделу 2" :
        s.id === "AIN-24" ? "Г-IN" : "Review результата",
      gateHint: `${s.checks}. Решение принимает БА.`,
      draft: { id: `mango-bcreq-${s.id.toLowerCase()}-stepwise`,
        file: s.promptPath.split("/").pop(), body: s.prompt, version: "0.2",
        title: `${s.id}: ${s.name}`, sha256: s.promptSha256,
        url: `https://github.com/G-Ivan-A/mango_ba_prompts/blob/main/${s.promptPath}` },
    }));
  });
  steps.forEach((s, i) => { s.number = s.number === "—" ? "—" : String(i + 1); });
  const byTest = steps.filter((s) => s.mode === "by-test").length;
  return { ...kit, steps, counts: { steps: steps.length, byTest, published: steps.length - byTest },
    groups: kit.groups.map((g) => ({ ...g, count: steps.filter((s) => s.group === g.id).length })) };
}

async function init() {
  initTheme();
  trackTopbarHeight();
  try {
    // Данные каталога загружаются только после ввода пароля (site/gate.js).
    await (window.siteGate?.ready ?? Promise.resolve());
    const [promptsData, stats, roadmap, checks, processes, patterns, processTree, bcreqFlow, testKit, ainKit] = await Promise.all([
      fetch("data/prompts.json").then((response) => response.json()),
      fetch("data/stats.json").then((response) => response.json()),
      fetch("data/roadmap.json").then((response) => response.json()),
      fetch("data/checks.json").then((response) => response.json()),
      fetch("data/processes.json").then((response) => response.json()),
      fetch("data/patterns.json").then((response) => response.json()),
      fetch("data/process-tree.json").then((response) => response.json()),
      fetch("data/bcreq-flow.json").then((response) => response.json()),
      fetch("data/test-kit.json").then((response) => response.json()),
      fetch("data/a-in-kit.json").then((response) => {
        if (!response.ok) throw new Error("Не удалось загрузить A-IN; обновите страницу");
        return response.json();
      }),
    ]);

    state.promptsData = promptsData;
    state.prompts = promptsData.prompts;
    state.stats = stats;
    state.roadmap = roadmap;
    state.checks = checks;
    state.processes = processes;
    state.patterns = patterns;
    state.processTree = processTree;
    state.bcreqFlow = bcreqFlow;
    state.testKit = composeAinTestKit(testKit, ainKit);

    renderSuggestions();
    renderMetrics();
    renderPhases();
    renderFilters();
    renderPrompts();
    renderChecks();
    renderRoadmap();
    renderProcesses();
    renderBcreqFlow();
    renderTestKit();
    renderProcessTree();
    renderPatterns();
    renderSiteVersion();
    applyRoute();
  } catch (error) {
    nodes.promptGrid.replaceChildren(el("div", "empty-state", "Данные не загрузились"));
    nodes.testKitSummary.textContent = "Данные не загрузились. Обновите страницу для повторной загрузки.";
    console.error(error);
  }
}

function updateClearButtonVisibility() {
  nodes.clearSearch.hidden = !state.query;
  nodes.clearFilters.hidden = state.selectedFilters.size === 0;
}

nodes.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  rerenderInteractive();
  updateClearButtonVisibility();
});

nodes.sort.addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderPrompts();
});

nodes.exportButton.addEventListener("click", exportCatalog);

nodes.clearSearch.addEventListener("click", () => {
  state.query = "";
  nodes.search.value = "";
  rerenderInteractive();
  updateClearButtonVisibility();
});

nodes.clearFilters.addEventListener("click", () => {
  state.selectedFilters.clear();
  rerenderInteractive();
  updateClearButtonVisibility();
});

nodes.filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter-token]");
  if (!button) {
    return;
  }
  const token = button.dataset.filterToken;
  // Недоступную (каскадно скрытую) операцию нельзя выбрать, но можно снять.
  if (button.dataset.unavailable === "true" && !state.selectedFilters.has(token)) {
    return;
  }
  if (state.selectedFilters.has(token)) {
    state.selectedFilters.delete(token);
  } else {
    state.selectedFilters.add(token);
  }
  rerenderInteractive();
  updateClearButtonVisibility();
});

nodes.processExpand?.addEventListener("click", () => setAllProcessNodes(true));
nodes.processCollapse?.addEventListener("click", () => setAllProcessNodes(false));

nodes.promptGrid.addEventListener("click", async (event) => {
  const shareButton = event.target.closest("[data-share-id]");
  if (shareButton) {
    const id = shareButton.dataset.shareId;
    const url = `${window.location.origin}${window.location.pathname}#prompt=${encodeURIComponent(id)}`;
    try {
      await copyText(url);
      showToast("Ссылка на карточку скопирована");
    } catch (error) {
      showToast("Не удалось скопировать ссылку");
    }
    return;
  }

  const button = event.target.closest("[data-copy-id]");
  if (button) {
    await copyPrompt(button);
  }
});

async function copyPrompt(button) {
  const prompt = state.prompts.find((item) => item.id === button.dataset.copyId);
  if (!prompt) {
    showToast(`Промпт ${button.dataset.copyId} не найден в каталоге`);
    return;
  }
  try {
    const body = prompt.body || prompt.content;
    await copyText(`<!-- ${prompt.id} -->\n\n${body}`);
    button.dataset.copied = "true";
    showToast(`${prompt.file} скопирован`);
    window.setTimeout(() => {
      button.dataset.copied = "false";
    }, 1400);
  } catch (error) {
    showToast("Не удалось скопировать");
  }
}

// Тестовый набор этапа 1 (issue #446, BL-157б): 13 шагов комплекта прогона.
// Режим шага — колонка «Режим в тесте» комплекта: published — опубликованный
// промпт из prompts/ (версия из его frontmatter), by-test — черновик «по тесту»
// из prompts/drafts/. Карточка шага (issue #448) — инструкция для БА без кодов:
// зачем шаг, что подготовить, что делать, результат, кто решает на гейте.
// Данные — data/test-kit.json.
function testKitModeLabel(step) {
  if (step.ainId) return "draft";
  return step.mode === "by-test" ? "черновик «по тесту»" : `опубликован v${step.published.version}`;
}

function testKitVariant(step, kind) {
  return kind === "draft" ? step.draft : step.published;
}

function testKitAssignedKind(step) {
  return step.mode === "by-test" ? "draft" : "published";
}

function testKitEditionLabel(step, kind) {
  if (step.ainId) return "draft";
  return kind === "draft" ? "по тесту" : `v${step.published.version}`;
}

// Текст опубликованной редакции — из каталога (архивный промпт), черновика — из
// test-kit.json. Один источник для чтения и копирования (issue #460).
function testKitBody(step, kind) {
  if (kind === "draft") {
    return step.draft?.body || "";
  }
  return state.prompts.find((item) => item.id === step.published?.id)?.body || "";
}

// Контейнер чтения (issue #460): текст выбранной редакции прокручивается внутри
// контейнера, панель с переключателем и копированием прилипает при прокрутке страницы.
function testKitReader(step, index) {
  const assigned = testKitAssignedKind(step);
  const other = assigned === "draft" ? "published" : "draft";
  const kinds = [assigned, other].filter((kind) => testKitVariant(step, kind));

  const switcher = el("div", "testkit-edition");
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", `Редакция промпта шага ${step.step}`);
  switcher.append(
    ...kinds.map((kind) => {
      const button = el("button", "testkit-edition-button", testKitEditionLabel(step, kind));
      button.type = "button";
      button.dataset.testkitEdition = kind;
      button.disabled = kinds.length === 1;
      return button;
    }),
  );

  const copy = el("button", "testkit-copy", "⧉ Копировать");
  copy.type = "button";
  copy.dataset.testkitIndex = String(index);

  const bar = el("div", "testkit-reader-bar");
  bar.append(switcher, copy);

  const text = el("pre", "testkit-prompt-text");
  text.tabIndex = 0;
  text.setAttribute("role", "region");
  text.setAttribute("aria-label", `Текст промпта шага ${step.step}`);

  const note = el("p", "testkit-reader-note");
  note.setAttribute("aria-live", "polite");

  const reader = el("div", "testkit-reader");
  reader.append(bar, note, text);
  return reader;
}

function selectTestKitEdition(item, kind) {
  const step = state.testKit.steps[Number(item.dataset.testkitStep)];
  const variant = testKitVariant(step, kind);
  const label = testKitEditionLabel(step, kind);
  const assigned = testKitAssignedKind(step);

  for (const button of item.querySelectorAll("[data-testkit-edition]")) {
    button.setAttribute("aria-pressed", String(button.dataset.testkitEdition === kind));
  }
  const copy = item.querySelector(".testkit-copy");
  copy.dataset.testkitKind = kind;
  copy.title = `Скопировать ${variant.file} (${label})`;
  copy.setAttribute("aria-label", `Скопировать промпт шага ${step.step}: ${label}`);

  const text = item.querySelector(".testkit-prompt-text");
  text.textContent = testKitBody(step, kind) || "Текст редакции не найден в каталоге.";
  text.scrollTop = 0;

  const note = item.querySelector(".testkit-reader-note");
  note.dataset.comparison = String(kind !== assigned);
  if (kind !== assigned) {
    note.textContent = `Редакция для сравнения. Для теста шагу назначена редакция «${testKitEditionLabel(step, assigned)}».`;
  } else if (item.querySelectorAll("[data-testkit-edition]").length === 1) {
    note.textContent = "Единственная редакция шага: сравнивать не с чем.";
  } else {
    note.textContent = "Эта редакция назначена шагу для теста.";
  }

  const link = item.querySelector(".bcreq-step-prompt a");
  link.textContent = variant.title || variant.file;
  link.title = variant.file;
  link.href = variant.url;
  item.querySelector(".testkit-sha").textContent = `${variant.file} · sha256 ${variant.sha256.slice(0, 16)}`;
}

function testKitStep(step, index) {
  const item = el("li", "bcreq-step testkit-step");
  item.dataset.mode = step.mode;
  item.dataset.group = step.group;
  item.dataset.testkitStep = String(index);
  if (step.ainId) item.dataset.ainStep = step.ainId;
  item.id = `bcreq-testkit-step-${index + 1}`;
  item.tabIndex = -1;

  const head = el("div", "bcreq-step-head");
  const number = el("span", "bcreq-step-number", step.number);
  number.setAttribute("aria-hidden", "true");
  const titleWrap = el("div", "bcreq-step-title-wrap");
  titleWrap.append(el("h3", "bcreq-step-title", step.step));
  const tags = el("div", "tag-row");
  const mode = el("span", "tag", testKitModeLabel(step) + (step.modeNote ? ` · ${step.modeNote}` : ""));
  mode.dataset.kind = "testkit-mode";
  mode.dataset.mode = step.mode;
  tags.append(mode);
  titleWrap.append(tags);
  head.append(number, titleWrap);

  const prompt = el("p", "bcreq-step-prompt");
  const link = el("a", "");
  link.target = "_blank";
  link.rel = "noreferrer";
  prompt.append(el("span", "bcreq-field-label", "Промпт"), link);
  if (step.params) {
    prompt.append(el("code", "bcreq-params", step.params));
  }

  const actions = el("ol", "bcreq-actions");
  actions.append(...step.actions.map((action) => el("li", "", action)));

  const info = el("div", "testkit-step-info");
  info.append(
    el("p", "testkit-purpose", step.purpose),
    prompt,
    bcreqField("Что подготовить", step.prepare, "prepare"),
    el("div", "bcreq-field-label", "Что делает БА"),
    actions,
    bcreqField("Результат", step.result, "result"),
  );
  if (step.gate && step.gate !== "—") {
    const gate = el("p", "bcreq-gate");
    gate.dataset.field = "gate";
    gate.append(el("strong", "", `⛳ ${step.gate}. `), document.createTextNode(step.gateHint));
    info.append(gate);
  }
  if (step.ainId) {
    // Navigation proposes a destination; acceptance and execution stay manual.
    const links = el("p", "prompt-links");
    const destinations = [...new Set([step.next, ...(step.returns || []), step.failure])];
    for (const id of destinations) {
      const target = /^AIN-\d{2}$/.test(id) ? `#processes?ain=${id}` : "#processes?view=g2";
      const link = el("a", "prompt-link", id === step.next ? `После принятия: ${id}` : `Возврат: ${id}`);
      link.href = target;
      links.append(link);
    }
    info.append(links);
  }

  // SHA выбранной редакции — для проверяющего, свёрнуто по умолчанию.
  const more = el("details", "testkit-more");
  more.append(el("summary", "", "Для проверяющего"), el("code", "testkit-sha"));
  if (step.ainId) {
    const refs = el("p", "prompt-links");
    refs.append(linkTo("https://github.com/G-Ivan-A/mango_ba_prompts/blob/main/docs/ba-processes/bcreq-a-in-execution.md", "Инструкция A-IN"));
    refs.append(linkTo("https://github.com/G-Ivan-A/mango_ba_prompts/blob/main/docs/ba-processes/bcreq-a-in-route.json", "Карта шагов"));
    refs.append(linkTo("https://github.com/G-Ivan-A/mango_ba_prompts/blob/main/docs/contracts/bcreq-manual-state.md", "Контракт состояния"));
    refs.append(linkTo("https://github.com/G-Ivan-A/mango_ba_prompts/blob/main/standards/bcreq-sections/01-glossary.md", "Стандарт раздела 1"));
    refs.append(linkTo("https://github.com/G-Ivan-A/mango_ba_prompts/blob/main/standards/bcreq-sections/02-business-context.md", "Стандарт раздела 2"));
    refs.append(linkTo("https://github.com/G-Ivan-A/mango-ba-ai-runtime/tree/main/docs/kb", "База знаний"));
    for (const old of state.prompts.filter((p) => p.archiveInfo?.replacedBy.includes(step.ainId))) {
      const link = el("a", "prompt-link", `Архив 2.7.0 · ${old.archiveInfo.step}`);
      link.href = `#prompt=${encodeURIComponent(old.id)}`;
      refs.append(link);
    }
    for (const id of step.operation.match(/К-\d{2}/g) || []) {
      const operation = state.prompts.find((p) => p.classId === id);
      if (operation) refs.append(linkTo(operation.url, `Контракт ${id}`));
    }
    more.append(refs);
  }
  info.append(more);

  const layout = el("div", "testkit-step-layout");
  layout.append(info, testKitReader(step, index));
  item.append(head, layout);
  selectTestKitEdition(item, testKitAssignedKind(step));
  return item;
}

function renderTestKit() {
  const kit = state.testKit;
  if (!kit || !nodes.testKitSteps) {
    return;
  }
  const source = el("a", "", `комплект прогона v${kit.kit.version}`);
  source.href = kit.kit.url;
  source.target = "_blank";
  source.rel = "noreferrer";
  nodes.testKitSummary.replaceChildren(
    document.createTextNode(
      `Шагов: ${kit.counts.steps}; draft / «по тесту»: ${kit.counts.byTest}; опубликованный промпт: ${kit.counts.published}. 24 контракта A-IN по принятому RFC; остальные стадии — `,
    ),
    source,
    document.createTextNode("."),
  );
  nodes.testKitSteps.replaceChildren(
    ...kit.groups.map((group) => {
      const block = el("li", "testkit-group");
      block.id = `bcreq-testkit-${group.id}`;
      block.dataset.group = group.id;
      const head = el("div", "testkit-group-head");
      head.append(
        el("h3", "bcreq-subtitle", `Этап ${group.number}. ${group.title}`),
        el("p", "bcreq-lead", `Получается: ${group.outcome}.`),
      );
      const list = el("ol", "bcreq-steps");
      kit.steps.forEach((step, index) => {
        if (step.group === group.id) {
          list.append(testKitStep(step, index));
        }
      });
      block.append(head, list);
      return block;
    }),
  );
  renderProcessTabs();
}

// Подстраницы «Процессов» (issue #448): этапы тестового набора по логике
// формирования документа, полный процесс из 39 классов и согласование.
// Адрес — #processes?view=<id>; #processes?step=<N> открывает полный процесс.
const TEST_KIT_ALL_VIEW = "all";
const PROCESS_VIEWS_EXTRA = [
  { id: "manual", title: "Полный процесс (39 классов)", section: "bcreq-manual" },
  { id: "approval", title: "Согласование", section: "bcreq-approval" },
];

function processViews() {
  const groups = state.testKit?.groups || [];
  return [
    // Первая вкладка открывается по умолчанию: БА сразу видит все шаги (issue #460).
    { id: TEST_KIT_ALL_VIEW, title: "Все шаги", count: state.testKit?.counts.steps, section: "bcreq-testkit" },
    ...groups.map((group) => ({
      id: group.id,
      title: `${group.number}. ${group.title}`,
      count: group.count,
      section: "bcreq-testkit",
    })),
    ...PROCESS_VIEWS_EXTRA,
  ];
}

function renderProcessTabs() {
  if (!nodes.processTabs) {
    return;
  }
  nodes.processTabs.replaceChildren(
    ...processViews().map((view) => {
      const tab = el("a", "process-tab", view.title);
      tab.href = `#processes?view=${view.id}`;
      tab.dataset.processTab = view.id;
      if (view.count) {
        tab.append(el("span", "process-tab-count", String(view.count)));
      }
      return tab;
    }),
  );
}

function applyProcessView(view) {
  const views = processViews();
  const current = views.find((item) => item.id === view) || views[0];
  if (!current) {
    return;
  }
  for (const tab of nodes.processTabs?.querySelectorAll("[data-process-tab]") || []) {
    const active = tab.dataset.processTab === current.id;
    tab.dataset.active = String(active);
    if (active) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  }
  for (const id of ["bcreq-testkit", "bcreq-manual", "bcreq-approval"]) {
    const section = document.getElementById(id);
    if (section) {
      section.hidden = section.id !== current.section;
    }
  }
  if (nodes.processHelp) {
    nodes.processHelp.hidden = current.section !== "bcreq-testkit";
  }
  for (const group of nodes.testKitSteps?.querySelectorAll(".testkit-group") || []) {
    group.hidden = current.id !== TEST_KIT_ALL_VIEW && group.dataset.group !== current.id;
  }
}

async function copyTestKitPrompt(button) {
  const step = state.testKit?.steps[Number(button.dataset.testkitIndex)];
  const variant = step && testKitVariant(step, button.dataset.testkitKind);
  if (!variant) {
    showToast("Промпт не найден в тестовом наборе");
    return;
  }
  const kind = button.dataset.testkitKind;
  const body = testKitBody(step, kind);
  if (!body) {
    showToast(`Промпт ${variant.id} не найден в каталоге`);
    return;
  }
  try {
    // Имя промпта и шаг — в первой строке: по ней видно в чате, какой промпт
    // и на каком шаге применён (issue #448).
    await copyText(`<!-- ${variant.id} · ${step.step} -->\n\n${body}`);
    button.dataset.copied = "true";
    // У черновика и опубликованного промпта одно имя файла: редакция — в уведомлении.
    showToast(`${variant.file} (${testKitEditionLabel(step, kind)}) скопирован`);
    window.setTimeout(() => {
      button.dataset.copied = "false";
    }, 1400);
  } catch (error) {
    showToast("Не удалось скопировать");
  }
}

nodes.testKitSteps?.addEventListener("click", async (event) => {
  const edition = event.target.closest("[data-testkit-edition]");
  if (edition) {
    selectTestKitEdition(edition.closest(".testkit-step"), edition.dataset.testkitEdition);
    return;
  }
  const button = event.target.closest("[data-testkit-index]");
  if (button) {
    await copyTestKitPrompt(button);
  }
});

nodes.bcreqSteps?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-id]");
  if (button) {
    await copyPrompt(button);
  }
});

nodes.processGrid?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-process-id]");
  if (card) {
    openProcessModal(card.dataset.processId);
  }
});

nodes.modal.addEventListener("click", (event) => {
  if (event.target.closest("[data-modal-close]")) {
    closeProcessModal();
  }
});

nodes.modalClose.addEventListener("click", closeProcessModal);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !nodes.modal.hidden) {
    closeProcessModal();
  }
});

nodes.themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    /* localStorage может быть недоступен */
  }
});

nodes.logout?.addEventListener("click", () => window.siteGate?.lock());

window.addEventListener("hashchange", applyRoute);

// Полные канонические ссылки работают и в локальном предпросмотре без перезагрузки.
document.addEventListener("click", (event) => {
  const link = event.target.closest('a[data-standard-target], a[data-nav="standards"]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const hash = new URL(link.href).hash;
  if (window.location.hash === hash) applyRoute();
  else window.location.hash = hash;
});

init();
