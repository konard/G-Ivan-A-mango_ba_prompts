const state = {
  prompts: [],
  stats: null,
  roadmap: null,
  checks: null,
  processes: null,
  patterns: null,
  processTree: null,
  selectedFilters: new Set(),
  query: "",
  sort: "updated",
};

const PAGES = ["catalog", "dashboard", "roadmap", "processes", "patterns"];
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
  patternGrid: document.querySelector("#pattern-grid"),
  topnav: document.querySelector("#topnav"),
  themeToggle: document.querySelector("#theme-toggle"),
  modal: document.querySelector("#process-modal"),
  modalBody: document.querySelector("#modal-body"),
  modalClose: document.querySelector("#modal-close"),
  toast: document.querySelector("#toast"),
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

// Каскад: при выборе процессов фильтр «Операции» сужается до операций
// выбранных процессов. Возвращает null, если процессы не выбраны (доступны все).
function availableOperationIds() {
  const selectedProcesses = selectedValues("process");
  if (selectedProcesses.length === 0) {
    return null;
  }
  const ids = new Set();
  for (const process of state.promptsData.filters.processes) {
    if (selectedProcesses.includes(process.label)) {
      for (const operation of process.operations) {
        ids.add(operation);
      }
    }
  }
  return ids;
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
function visiblePrompts() {
  const query = normalize(state.query);
  const selectedProcesses = selectedValues("process");
  const selectedOperations = selectedValues("operation");
  const selectedModes = selectedValues("mode");

  const filtered = state.prompts.filter((prompt) => {
    if (query && !promptSearchText(prompt).includes(query)) {
      return false;
    }
    if (
      selectedProcesses.length > 0 &&
      !prompt.processes.some((process) => selectedProcesses.includes(process))
    ) {
      return false;
    }
    if (selectedOperations.length > 0 && !selectedOperations.includes(prompt.operation.id)) {
      return false;
    }
    if (selectedModes.length > 0 && !selectedModes.includes(prompt.mode)) {
      return false;
    }
    return true;
  });

  return sortPrompts(filtered);
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

  nodes.metrics.replaceChildren(
    ...metrics.map(([label, value]) => {
      const tile = el("div", "metric-tile");
      tile.append(el("span", "metric-value", String(value)));
      tile.append(el("span", "metric-label", label));
      return tile;
    }),
  );
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
  if (unavailable) {
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
  const totals = state.stats.totals;
  const processes = state.promptsData.filters.processes.map((process) => ({
    token: `process:${process.label}`,
    icon: process.emoji || process.icon,
    label: process.label,
    count: totals.processes[process.label] || 0,
    title: `${process.label}: ${process.description}`,
  }));

  const available = availableOperationIds();
  const operations = state.promptsData.filters.operations.map((operation) => ({
    token: `operation:${operation.id}`,
    icon: operation.icon,
    label: operation.label,
    count: totals.operations[operation.id] || 0,
    title:
      available && !available.has(operation.id)
        ? `${operation.label}: недоступна для выбранных процессов`
        : `${operation.label}: ${operation.description}`,
    unavailable: Boolean(available) && !available.has(operation.id),
  }));

  const modeLabels = {
    stepwise: "Stepwise",
    oneshot: "One-shot",
    legacy: "Legacy",
  };
  const modes = state.promptsData.filters.modes.map((mode) => ({
    token: `mode:${mode}`,
    icon: state.prompts.find((prompt) => prompt.mode === mode)?.modeIcon || "•",
    label: modeLabels[mode] || mode,
    count: totals.modes[mode] || 0,
    title: mode,
  }));

  nodes.filters.replaceChildren(
    renderFilterGroup("Процессы БА", processes, "filter-group--processes"),
    renderFilterGroup("Операции", operations, "filter-group--operations"),
    renderFilterGroup("Режимы", modes, "filter-group--modes"),
  );
}

function promptCard(prompt) {
  const card = el("article", "prompt-card");
  card.dataset.archived = String(prompt.archived);

  const head = el("div", "prompt-head");
  const titleWrap = el("div");
  titleWrap.append(el("h3", "prompt-title", prompt.title));
  const idLabel = el("span", "prompt-id", prompt.id);
  idLabel.title = "Уникальный токен промпта";
  titleWrap.append(idLabel);
  head.append(titleWrap);

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
  const mode = el("span", "tag", `${prompt.modeIcon} ${prompt.mode}`);
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

  card.append(head, description, meta, tags, actions);
  return card;
}

function renderPrompts() {
  const prompts = visiblePrompts();
  nodes.resultCount.value = `${prompts.length} из ${state.prompts.length}`;

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

function renderProcesses() {
  if (!state.processes) {
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
  if (!state.processTree) {
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

// Клиентский роутер на hash: одна из пяти страниц (по умолчанию каталог).
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
      renderPrompts();
    }
  }
  window.scrollTo({ top: 0, behavior: "auto" });
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
}

async function init() {
  initTheme();
  try {
    const [promptsData, stats, roadmap, checks, processes, patterns, processTree] = await Promise.all([
      fetch("data/prompts.json").then((response) => response.json()),
      fetch("data/stats.json").then((response) => response.json()),
      fetch("data/roadmap.json").then((response) => response.json()),
      fetch("data/checks.json").then((response) => response.json()),
      fetch("data/processes.json").then((response) => response.json()),
      fetch("data/patterns.json").then((response) => response.json()),
      fetch("data/process-tree.json").then((response) => response.json()),
    ]);

    state.promptsData = promptsData;
    state.prompts = promptsData.prompts;
    state.stats = stats;
    state.roadmap = roadmap;
    state.checks = checks;
    state.processes = processes;
    state.patterns = patterns;
    state.processTree = processTree;

    renderSuggestions();
    renderMetrics();
    renderPhases();
    renderFilters();
    renderPrompts();
    renderChecks();
    renderRoadmap();
    renderProcesses();
    renderProcessTree();
    renderPatterns();
    applyRoute();
  } catch (error) {
    nodes.promptGrid.replaceChildren(el("div", "empty-state", "Данные не загрузились"));
    console.error(error);
  }
}

function updateClearButtonVisibility() {
  nodes.clearSearch.hidden = !state.query;
  nodes.clearFilters.hidden = state.selectedFilters.size === 0;
}

nodes.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderPrompts();
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
  renderPrompts();
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
  if (!button) {
    return;
  }
  const prompt = state.prompts.find((item) => item.id === button.dataset.copyId);
  if (!prompt) {
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
});

nodes.processGrid.addEventListener("click", (event) => {
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

window.addEventListener("hashchange", applyRoute);

init();
