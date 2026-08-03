import "./styles.css";
import curvedArrowUrl from "./assets/empty-create-arrow.png";
import createLucideElement from "lucide/dist/esm/createElement.mjs";
import ZoomIn from "lucide/dist/esm/icons/zoom-in.mjs";
import ZoomOut from "lucide/dist/esm/icons/zoom-out.mjs";

import {
  connectApi,
  type DesktopApi,
  type WindowInteractionRegion,
  type WindowResizeEdge,
} from "./api";
import {
  createEditor,
  type EditorAction,
  type EditorController,
} from "./editor/editor";
import { createSelectionVisibilityCoordinator } from "./editor/selection-visibility";
import { setLanguage, t } from "./i18n";
import type {
  AppConfig,
  NoteSummary,
  OpenedNote,
  SaveResult,
  UpdateState,
} from "./types";
import { prepareForWindowMinimize, syncPinButtons } from "./window-controls";

const app = document.querySelector<HTMLElement>("#app")!;

let api: DesktopApi;
let config: AppConfig;
let notes: NoteSummary[] = [];
let currentNote: OpenedNote | null = null;
let editor: EditorController | null = null;
let currentContent = "";
let dirty = false;
let saving = false;
let locked = false;
let saveTimer: number | null = null;
let archiveCandidate: string | null = null;
let archiveTimer: number | null = null;
let deleteCandidate: string | null = null;
let deleteTimer: number | null = null;
let editorPreferenceSave: Promise<void> = Promise.resolve();
let systemFonts: string[] = [];
let overlayScrollbarCleanup: (() => void) | null = null;
let appVersion = "";
let updateState: UpdateState = { status: "idle", available_version: null };
let notifiedUpdateVersion: string | null = null;

const MIN_EDITOR_FONT_SIZE = 12;
const MAX_EDITOR_FONT_SIZE = 22;
const DEFAULT_EDITOR_FONT = "DengXian";

function applyEditorAppearance(): void {
  const family = config.editor_font.trim() || DEFAULT_EDITOR_FONT;
  const escapedFamily = family.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  document.documentElement.style.setProperty(
    "--editor-font-family",
    `"${escapedFamily}", "Microsoft YaHei", sans-serif`,
  );
  document.documentElement.style.setProperty("--editor-font-size", `${config.editor_font_size}px`);
  document.documentElement.classList.toggle("heading-divider-enabled", config.heading_divider);
  document.documentElement.classList.toggle(
    "heading-list-highlight-enabled",
    config.heading_list_highlight,
  );
}

function queueEditorPreferenceSave(): void {
  const editorFont = config.editor_font;
  const editorFontSize = config.editor_font_size;
  editorPreferenceSave = editorPreferenceSave
    .catch(() => {})
    .then(() => api.setEditorPreferences(editorFont, editorFontSize))
    .catch(showError);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

type IconName =
  | "archive"
  | "back"
  | "bold"
  | "check"
  | "copy"
  | "heading"
  | "github"
  | "italic"
  | "list"
  | "listChecks"
  | "listOrdered"
  | "minimize"
  | "pin"
  | "plus"
  | "settings"
  | "strikethrough"
  | "trash"
  | "update"
  | "undo2";

function icon(name: IconName): string {
  const paths = {
    archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    heading: '<path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/>',
    github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18 0 15 2a13.4 13.4 0 0 0-7 0C5-.1 3.7.5 3.7.5A5 5 0 0 0 3.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.5 6.8 7A4.8 4.8 0 0 0 8 18v4"/><path d="M8 19c-3 .9-3-1.5-4-2"/>',
    italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
    list: '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
    listChecks: '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>',
    listOrdered: '<path d="M11 5h10"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/>',
    minimize: '<path d="M5 12h14"/>',
    pin: '<path class="pin-stem" d="M12 17v5"/><path class="pin-body" d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
    strikethrough: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
    trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    update: '<path d="M21 12a9 9 0 0 1-15.2 6.5L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.2 5.5L21 8"/><path d="M21 3v5h-5"/>',
    undo2: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5A5.5 5.5 0 0 1 14.5 20H11"/>',
  };
  return `<svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function titleBar(
  title: string,
  back: (() => void) | null,
  showUpdateOnBack = true,
): HTMLElement {
  const bar = document.createElement("header");
  bar.className = "title-bar";
  const backUpdateClass = showUpdateOnBack
    ? ` update-indicator ${updateState.status === "available" ? "has-update" : ""}`
    : "";
  const backUpdateDot = showUpdateOnBack
    ? '<span class="update-dot" aria-hidden="true"></span>'
    : "";
  bar.innerHTML = `
    <div class="title-left">
      ${back ? `<button class="window-button no-drag${backUpdateClass}" data-action="back" aria-label="${t("back")}">${icon("back")}${backUpdateDot}</button>` : '<span class="app-mark">Bitty</span>'}
    </div>
    <div class="window-title" title="${escapeHtml(title)}">
      ${title ? `<span class="title-pin-indicator" aria-hidden="true"${config.always_on_top ? "" : " hidden"}>${icon("pin")}</span>` : ""}
      <span class="window-title-text">${escapeHtml(title)}</span>
    </div>
    <div class="window-actions">
      <button class="window-button no-drag ${config.always_on_top ? "is-active" : ""}" data-action="pin" aria-label="${t("pin")}" aria-pressed="${config.always_on_top}">${icon("pin")}</button>
      <button class="window-button no-drag" data-action="minimize" aria-label="${t("minimize")}">${icon("minimize")}</button>
    </div>`;
  if (back) bar.querySelector('[data-action="back"]')?.addEventListener("click", back);
  bar.querySelector('[data-action="pin"]')?.addEventListener("click", async () => {
    const next = !config.always_on_top;
    try {
      await api.setAlwaysOnTop(next);
      config.always_on_top = next;
      syncPinButtons(document, next);
    } catch (error) {
      syncPinButtons(document, config.always_on_top);
      showError(error);
    }
  });
  const minimizeButton = bar.querySelector<HTMLButtonElement>('[data-action="minimize"]');
  minimizeButton?.addEventListener("click", () => {
    prepareForWindowMinimize(minimizeButton);
    void api.minimizeWindow();
  });
  bar.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as Element).closest(".no-drag")) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    beginWindowInteraction(event, "caption");
  });
  return bar;
}

function beginWindowInteraction(
  event: PointerEvent,
  region: WindowInteractionRegion,
): void {
  const target = event.currentTarget as HTMLElement;
  event.preventDefault();
  target.setPointerCapture(event.pointerId);

  let updatePending = false;
  let interactionReady = false;
  let endRequested = false;
  let endSent = false;
  const finish = () => {
    if (!interactionReady || !endRequested || endSent) return;
    endSent = true;
    void api.endWindowInteraction();
  };
  const update = () => {
    if (updatePending) return;
    updatePending = true;
    window.requestAnimationFrame(() => {
      void api.updateWindowInteraction().finally(() => {
        updatePending = false;
      });
    });
  };
  const end = () => {
    target.removeEventListener("pointermove", update);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    endRequested = true;
    finish();
  };

  target.addEventListener("pointermove", update);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
  void api.startWindowInteraction(region)
    .then(async () => {
      await api.updateWindowInteraction();
      interactionReady = true;
      finish();
    })
    .catch((error) => {
      end();
      showError(error);
    });
}

const resizeEdges: WindowResizeEdge[] = [
  "top",
  "right",
  "bottom",
  "left",
  "top_left",
  "top_right",
  "bottom_right",
  "bottom_left",
];

function appendResizeHandles(shell: HTMLElement): void {
  for (const edge of resizeEdges) {
    const handle = document.createElement("div");
    handle.className = `resize-handle resize-${edge.replace("_", "-")}`;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      beginWindowInteraction(event, edge);
    });
    shell.append(handle);
  }
}

function attachOverlayScrollbar(scroller: HTMLElement): void {
  const parent = scroller.parentElement;
  if (!parent) return;
  parent.classList.add("scrollbar-hover-area");
  scroller.classList.add("overlay-scroll-surface");
  const rail = document.createElement("div");
  rail.className = "overlay-scrollbar";
  rail.innerHTML = '<div class="overlay-scrollbar-thumb"></div>';
  const thumb = rail.firstElementChild as HTMLElement;
  parent.append(rail);

  let animationFrame = 0;
  const sync = () => {
    animationFrame = 0;
    const viewportHeight = scroller.clientHeight;
    const maximumScroll = scroller.scrollHeight - viewportHeight;
    rail.style.top = `${scroller.offsetTop}px`;
    rail.style.height = `${viewportHeight}px`;
    rail.classList.toggle("is-scrollable", maximumScroll > 1);
    if (maximumScroll <= 1) return;
    const thumbHeight = Math.max(34, viewportHeight * viewportHeight / scroller.scrollHeight);
    const travel = viewportHeight - thumbHeight;
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${travel * scroller.scrollTop / maximumScroll}px)`;
  };
  const scheduleSync = () => {
    if (!animationFrame) animationFrame = window.requestAnimationFrame(sync);
  };
  const resizeObserver = new ResizeObserver(scheduleSync);
  const mutationObserver = new MutationObserver(scheduleSync);
  resizeObserver.observe(scroller);
  mutationObserver.observe(scroller, { childList: true, characterData: true, subtree: true });
  scroller.addEventListener("scroll", scheduleSync, { passive: true });

  thumb.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    thumb.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startScroll = scroller.scrollTop;
    const move = (moveEvent: PointerEvent) => {
      const travel = rail.clientHeight - thumb.offsetHeight;
      const maximumScroll = scroller.scrollHeight - scroller.clientHeight;
      if (travel > 0) {
        scroller.scrollTop = startScroll + (moveEvent.clientY - startY) * maximumScroll / travel;
      }
    };
    const end = () => {
      thumb.removeEventListener("pointermove", move);
      thumb.removeEventListener("pointerup", end);
      thumb.removeEventListener("pointercancel", end);
      if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId);
    };
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", end);
    thumb.addEventListener("pointercancel", end);
  });

  sync();
  overlayScrollbarCleanup = () => {
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    scroller.removeEventListener("scroll", scheduleSync);
    rail.remove();
    parent.classList.remove("scrollbar-hover-area");
    scroller.classList.remove("overlay-scroll-surface");
  };
}

function pageShell(
  title: string,
  back: (() => void) | null,
  quietTitleBar = false,
  showUpdateOnBack = true,
): HTMLElement {
  overlayScrollbarCleanup?.();
  overlayScrollbarCleanup = null;
  editor?.destroy();
  editor = null;
  app.replaceChildren();
  const shell = document.createElement("div");
  shell.className = "app-shell";
  shell.classList.toggle("quiet-title-bar", quietTitleBar);
  shell.append(titleBar(title, back, showUpdateOnBack));
  appendResizeHandles(shell);
  app.append(shell);
  return shell;
}

function showToast(message: string, kind: "info" | "warning" = "info"): void {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.textContent = message.replace(/[。.!！?？;；]+$/u, "");
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return t("unknownError");
}

function modal(options: {
  title: string;
  message: string;
  actions: { label: string; kind?: "primary" | "danger"; run: () => void | Promise<void> }[];
}): void {
  document.querySelector(".modal-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const panel = document.createElement("section");
  panel.className = "modal-panel";
  const heading = document.createElement("h2");
  heading.textContent = options.title;
  const message = document.createElement("p");
  message.textContent = options.message;
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  for (const action of options.actions) {
    const button = document.createElement("button");
    button.className = `button ${action.kind ?? ""}`;
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await action.run();
        backdrop.remove();
      } catch (error) {
        button.disabled = false;
        showError(error);
      }
    });
    actions.append(button);
  }
  panel.append(heading, message, actions);
  backdrop.append(panel);
  document.body.append(backdrop);
}

function showError(error: unknown): void {
  modal({
    title: t("operationFailed"),
    message: errorMessage(error),
    actions: [{ label: t("acknowledge"), kind: "primary", run: () => {} }],
  });
}

async function refreshNotes(): Promise<void> {
  notes = await api.listNotes();
}

async function renderHome(): Promise<void> {
  deleteCandidate = null;
  if (deleteTimer !== null) window.clearTimeout(deleteTimer);
  deleteTimer = null;
  currentNote = null;
  currentContent = "";
  dirty = false;
  locked = false;
  await api.rememberLastNote(null);
  try {
    await refreshNotes();
  } catch (error) {
    showError(error);
  }
  const shell = pageShell("", null);
  const main = document.createElement("main");
  main.className = "home-page";
  main.innerHTML = `
    <div class="home-heading">
      <h1 class="home-title">${t("homeTitle")}</h1>
      <div class="home-actions">
        <button class="icon-button" data-action="show-archive" aria-label="${t("archive")}">${icon("archive")}</button>
        <button class="icon-button update-indicator ${updateState.status === "available" ? "has-update" : ""}" data-action="settings" aria-label="${t("settings")}">${icon("settings")}<span class="update-dot" aria-hidden="true"></span></button>
      </div>
    </div>
    <div class="note-list" aria-live="polite"></div>
    <button class="create-button" data-action="create" aria-label="${t("createNote")}">${icon("plus")}</button>`;
  const list = main.querySelector<HTMLElement>(".note-list")!;
  if (notes.length === 0) {
    main.classList.add("is-empty");
    list.innerHTML = `<div class="empty-state"><p>${t("noNotes")}</p></div>`;
    const createArrow = document.createElement("div");
    createArrow.className = "empty-create-arrow";
    createArrow.setAttribute("aria-hidden", "true");
    createArrow.innerHTML = `<img src="${curvedArrowUrl}" alt="">`;
    main.append(createArrow);
  } else {
    for (const note of notes) {
      const item = document.createElement("article");
      item.className = "note-card";
      item.innerHTML = `
        <button class="note-open" aria-label="${escapeHtml(t("openNote", { name: note.name }))}">
          <strong>${escapeHtml(note.name.replace(/\.md$/i, ""))}</strong>
          <span>${escapeHtml(note.preview || t("emptyNote"))}</span>
        </button>
        <div class="note-actions">
          <button class="note-action copy-button" aria-label="${escapeHtml(t("copyNote", { name: note.name }))}">${icon("copy")}</button>
          <button class="note-action archive-button ${archiveCandidate === note.name ? "confirm" : ""}" aria-label="${escapeHtml(t("archiveNote", { name: note.name }))}">
            ${archiveCandidate === note.name ? icon("check") : icon("archive")}
          </button>
        </div>`;
      item.querySelector(".note-open")?.addEventListener("click", () => openNote(note.name));
      item.querySelector(".copy-button")?.addEventListener("click", () => showCopyDialog(note.name));
      item.querySelector(".archive-button")?.addEventListener("click", () => confirmArchive(note.name));
      list.append(item);
    }
  }
  main.querySelector('[data-action="show-archive"]')?.addEventListener("click", renderArchive);
  main.querySelector('[data-action="settings"]')?.addEventListener("click", renderSettings);
  main.querySelector('[data-action="create"]')?.addEventListener("click", showCreateDialog);
  shell.append(main);
  attachOverlayScrollbar(main);
}

async function renderArchive(): Promise<void> {
  archiveCandidate = null;
  if (archiveTimer !== null) window.clearTimeout(archiveTimer);
  archiveTimer = null;
  let archivedNotes: NoteSummary[] = [];
  try {
    archivedNotes = await api.listArchivedNotes();
  } catch (error) {
    showError(error);
  }
  const shell = pageShell("", renderHome);
  const main = document.createElement("main");
  main.className = "archive-page";
  main.innerHTML = `
    <div class="archive-heading"><h1>${t("archiveTitle")}</h1></div>
    <div class="note-list" aria-live="polite"></div>`;
  const list = main.querySelector<HTMLElement>(".note-list")!;
  if (archivedNotes.length === 0) {
    main.classList.add("is-empty");
    list.innerHTML = `<div class="empty-state"><p>${t("noArchivedNotes")}</p></div>`;
  } else {
    for (const note of archivedNotes) {
      const item = document.createElement("article");
      item.className = "note-card archived-note-card";
      item.innerHTML = `
        <div class="note-open archived-note-summary">
          <strong>${escapeHtml(note.name.replace(/\.md$/i, ""))}</strong>
          <span>${escapeHtml(note.preview || t("emptyNote"))}</span>
        </div>
        <div class="archived-note-actions">
          <button class="archived-action restore-button" aria-label="${escapeHtml(t("restoreNote", { name: note.name }))}">${icon("undo2")}</button>
          <button class="archived-action delete-button ${deleteCandidate === note.name ? "confirm" : ""}" aria-label="${escapeHtml(t("deleteNote", { name: note.name }))}">
            ${deleteCandidate === note.name ? icon("check") : icon("trash")}
          </button>
        </div>`;
      item.querySelector(".restore-button")?.addEventListener("click", () => restoreArchivedNote(note.name));
      item.querySelector(".delete-button")?.addEventListener("click", () => confirmDeleteArchivedNote(note.name));
      list.append(item);
    }
  }
  shell.append(main);
  attachOverlayScrollbar(main);
}

async function restoreArchivedNote(name: string): Promise<void> {
  try {
    await api.restoreArchivedNote(name);
    await renderArchive();
  } catch (error) {
    showError(error);
  }
}

async function confirmDeleteArchivedNote(name: string): Promise<void> {
  if (deleteCandidate !== name) {
    deleteCandidate = name;
    if (deleteTimer !== null) window.clearTimeout(deleteTimer);
    deleteTimer = window.setTimeout(() => {
      deleteCandidate = null;
      void renderArchive();
    }, 2000);
    await renderArchive();
    return;
  }
  deleteCandidate = null;
  if (deleteTimer !== null) window.clearTimeout(deleteTimer);
  deleteTimer = null;
  try {
    await api.deleteArchivedNote(name);
    await renderArchive();
  } catch (error) {
    showError(error);
  }
}

function availableNoteName(defaultStem: string): string {
  const existingNames = new Set(notes.map((note) => note.name.toLocaleLowerCase()));
  let defaultName = defaultStem;
  let suffix = 2;
  while (existingNames.has(`${defaultName}.md`.toLocaleLowerCase())) {
    defaultName = `${defaultStem} (${suffix})`;
    suffix += 1;
  }
  return defaultName;
}

function showNoteNameDialog(options: {
  title: string;
  defaultName: string;
  confirmLabel: string;
  run: (name: string) => Promise<void>;
}): void {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <section class="modal-panel create-panel">
      <h2>${escapeHtml(options.title)}</h2>
      <input type="text" maxlength="100" value="${escapeHtml(options.defaultName)}" aria-label="${t("noteName")}" />
      <div class="modal-actions"><button class="button" data-action="cancel">${t("cancel")}</button><button class="button primary" data-action="confirm">${escapeHtml(options.confirmLabel)}</button></div>
    </section>`;
  const input = backdrop.querySelector<HTMLInputElement>("input")!;
  const confirm = async () => {
    const button = backdrop.querySelector<HTMLButtonElement>('[data-action="confirm"]')!;
    button.disabled = true;
    try {
      await options.run(input.value);
      backdrop.remove();
    } catch (error) {
      button.disabled = false;
      showError(error);
    }
  };
  backdrop.querySelector('[data-action="cancel"]')?.addEventListener("click", () => backdrop.remove());
  backdrop.querySelector('[data-action="confirm"]')?.addEventListener("click", confirm);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void confirm();
    if (event.key === "Escape") backdrop.remove();
  });
  document.body.append(backdrop);
  input.focus();
  input.select();
}

function showCreateDialog(): void {
  const today = new Date();
  const defaultStem = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  showNoteNameDialog({
    title: t("createNote"),
    defaultName: availableNoteName(defaultStem),
    confirmLabel: t("create"),
    run: async (name) => showNote(await api.createNote(name)),
  });
}

function showCopyDialog(sourceName: string): void {
  const sourceStem = sourceName.replace(/\.md$/i, "");
  showNoteNameDialog({
    title: t("copy"),
    defaultName: availableNoteName(`${sourceStem} ${t("copySuffix")}`),
    confirmLabel: t("createCopy"),
    run: async (name) => {
      await api.duplicateNote(sourceName, name);
      await renderHome();
    },
  });
}

async function confirmArchive(name: string): Promise<void> {
  if (archiveCandidate !== name) {
    archiveCandidate = name;
    if (archiveTimer !== null) window.clearTimeout(archiveTimer);
    archiveTimer = window.setTimeout(() => {
      archiveCandidate = null;
      void renderHome();
    }, 2000);
    await renderHome();
    return;
  }
  archiveCandidate = null;
  if (archiveTimer !== null) window.clearTimeout(archiveTimer);
  try {
    await api.archiveNote(name);
    await renderHome();
  } catch (error) {
    showError(error);
  }
}

async function openNote(name: string): Promise<void> {
  try {
    await showNote(await api.openNote(name));
  } catch (error) {
    showError(error);
    await renderHome();
  }
}

async function showNote(note: OpenedNote): Promise<void> {
  currentNote = note;
  currentContent = note.content;
  dirty = false;
  locked = false;
  await api.rememberLastNote(note.name);
  const shell = pageShell(note.name, backToHome, true);
  const main = document.createElement("main");
  main.className = "note-page";
  main.innerHTML = `<div class="editor-host"></div><div class="format-toolbar" aria-label="${t("formatToolbar")}"></div>`;
  const host = main.querySelector<HTMLElement>(".editor-host")!;
  const toolbar = main.querySelector<HTMLElement>(".format-toolbar")!;
  toolbar.addEventListener("mousedown", (event) => event.preventDefault());
  let noteEditor: EditorController | null = null;
  const selectionVisibility = createSelectionVisibilityCoordinator(
    toolbar,
    () => noteEditor,
  );
  host.addEventListener("pointerdown", selectionVisibility.editorPressStarted, true);
  const created = createEditor(host, note.content, {
    onChange: (markdown) => {
      if (locked) return;
      currentContent = markdown;
      dirty = true;
      scheduleSave();
    },
    onFocusChange: (focused) => {
      selectionVisibility.focusChanged(focused && noteEditor?.mode === "wysiwyg");
    },
    onSelectionChange: () => {
      updateToolbar();
      selectionVisibility.selectionChanged();
    },
  }, config.spellcheck);
  noteEditor = created.controller;
  editor = noteEditor;
  currentContent = created.snapshot.markdown;
  if (created.snapshot.mode !== "raw") renderToolbar(toolbar);
  shell.append(main);
  attachOverlayScrollbar(host);
  window.setTimeout(() => editor?.focus(), 0);
}

const toolbarItems: { action: EditorAction; icon: IconName; title: Parameters<typeof t>[0] }[] = [
  { action: "heading", icon: "heading", title: "heading" },
  { action: "strong", icon: "bold", title: "bold" },
  { action: "em", icon: "italic", title: "italic" },
  { action: "strike", icon: "strikethrough", title: "strikethrough" },
  { action: "bullet", icon: "list", title: "bulletList" },
  { action: "ordered", icon: "listOrdered", title: "orderedList" },
  { action: "task", icon: "listChecks", title: "taskList" },
];

function renderToolbar(toolbar: HTMLElement): void {
  for (const [index, item] of toolbarItems.entries()) {
    if (index === 4) {
      const separator = document.createElement("span");
      separator.className = "format-toolbar-separator";
      separator.setAttribute("aria-hidden", "true");
      toolbar.append(separator);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = item.action;
    button.title = t(item.title);
    button.setAttribute("aria-label", t(item.title));
    button.innerHTML = icon(item.icon);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (!locked) editor?.run(item.action);
    });
    toolbar.append(button);
  }
  const separator = document.createElement("span");
  separator.className = "format-toolbar-separator";
  separator.setAttribute("aria-hidden", "true");
  toolbar.append(separator);
  for (const direction of [-1, 1] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "font-size-button";
    button.dataset.fontSizeDirection = String(direction);
    button.append(createLucideElement(direction < 0 ? ZoomOut : ZoomIn, {
      class: "lucide-icon",
      "aria-hidden": "true",
    }));
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      adjustEditorFontSize(direction);
    });
    toolbar.append(button);
  }
  updateToolbar(toolbar);
  updateFontSizeButtons(toolbar);
}

function adjustEditorFontSize(direction: -1 | 1): void {
  const next = Math.min(
    MAX_EDITOR_FONT_SIZE,
    Math.max(MIN_EDITOR_FONT_SIZE, config.editor_font_size + direction),
  );
  if (next === config.editor_font_size) return;
  config.editor_font_size = next;
  applyEditorAppearance();
  updateFontSizeButtons();
  queueEditorPreferenceSave();
}

function updateFontSizeButtons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>(".font-size-button").forEach((button) => {
    const direction = Number(button.dataset.fontSizeDirection);
    const unavailable = direction < 0
      ? config.editor_font_size <= MIN_EDITOR_FONT_SIZE
      : config.editor_font_size >= MAX_EDITOR_FONT_SIZE;
    button.classList.toggle("is-disabled", unavailable);
    button.setAttribute("aria-disabled", String(unavailable));
    button.title = t("fontSize", {
      direction: t(direction < 0 ? "decrease" : "increase"),
      size: config.editor_font_size,
    });
    button.setAttribute("aria-label", button.title);
  });
}

function updateToolbar(root: ParentNode = document): void {
  const active = editor?.activeActions() ?? new Set();
  const toolbar = root instanceof HTMLElement && root.classList.contains("format-toolbar")
    ? root
    : root.querySelector<HTMLElement>(".format-toolbar");
  toolbar?.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.classList.toggle("is-active", active.has(button.dataset.action as EditorAction));
  });
}

function scheduleSave(): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveNow(), 400);
}

async function saveNow(force = false): Promise<boolean> {
  if (!currentNote || saving) return !dirty;
  if (!dirty && !force) return true;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = null;
  saving = true;
  const contentToSave = currentContent;
  try {
    const result = await api.saveNote(currentNote, contentToSave, force);
    if (result.status === "saved" || result.status === "unchanged") {
      if (result.revision) currentNote.revision = result.revision;
      currentNote.content = contentToSave;
      dirty = currentContent !== contentToSave;
      locked = false;
      if (dirty) scheduleSave();
      return true;
    }
    if (result.status === "conflict") {
      showConflict(result);
    } else {
      showMissing();
    }
    locked = true;
    return false;
  } catch (error) {
    locked = true;
    showSaveFailure(error);
    return false;
  } finally {
    saving = false;
  }
}

function showConflict(result: SaveResult): void {
  modal({
    title: t("conflictTitle"),
    message: t("conflictMessage"),
    actions: [
      {
        label: t("reloadExternal"),
        run: async () => {
          if (!currentNote || result.external_content === null || result.revision === null) return;
          currentNote = {
            ...currentNote,
            content: result.external_content,
            revision: result.revision,
            has_bom: result.has_bom,
            newline: result.newline,
          };
          await showNote(currentNote);
        },
      },
      { label: t("copyCurrent"), run: copyCurrentContent },
      {
        label: t("overwriteExternal"),
        kind: "danger",
        run: async () => {
          if (!currentNote || result.revision === null) return;
          currentNote.revision = result.revision;
          locked = false;
          dirty = true;
          await saveNow(true);
        },
      },
    ],
  });
}

function showMissing(): void {
  modal({
    title: t("missingTitle"),
    message: t("missingMessage"),
    actions: [
      {
        label: t("returnHome"),
        run: async () => {
          dirty = false;
          locked = false;
          await renderHome();
        },
      },
      { label: t("copyCurrent"), run: copyCurrentContent },
      {
        label: t("recreate"),
        kind: "primary",
        run: async () => {
          if (!currentNote) return;
          currentNote = await api.recreateNote(currentNote, currentContent);
          await showNote(currentNote);
        },
      },
    ],
  });
}

function showSaveFailure(error: unknown): void {
  modal({
    title: t("saveFailed"),
    message: `${errorMessage(error)} ${t("contentKept")}`,
    actions: [
      { label: t("copyCurrent"), run: copyCurrentContent },
      {
        label: t("retrySave"),
        kind: "primary",
        run: async () => {
          locked = false;
          dirty = true;
          await saveNow();
        },
      },
    ],
  });
}

async function copyCurrentContent(): Promise<void> {
  await navigator.clipboard.writeText(currentContent);
  showToast(t("copied"));
}

async function backToHome(): Promise<void> {
  if (await saveNow()) await renderHome();
}

async function closeApplication(): Promise<void> {
  if (await saveNow()) {
    await editorPreferenceSave;
    await api.closeWindow();
  }
}

declare global {
  interface Window {
    desktopNotesRequestClose?: () => void;
  }
}

window.desktopNotesRequestClose = () => void closeApplication();

function updateButtonText(): string {
  return updateState.status === "available" ? t("update") : t("checkUpdate");
}

function showAvailableUpdateOnce(state: UpdateState): void {
  if (state.status !== "available" || !state.available_version) return;
  if (notifiedUpdateVersion === state.available_version) return;
  notifiedUpdateVersion = state.available_version;
  showToast(t("updateAvailable", { version: state.available_version }));
}

async function refreshUpdateState(force = false): Promise<UpdateState> {
  updateState = await api.checkUpdate(force);
  document.querySelectorAll(".update-indicator").forEach((element) => {
    element.classList.toggle("has-update", updateState.status === "available");
  });
  const updateButton = document.querySelector<HTMLElement>(".update-button");
  updateButton?.setAttribute("aria-label", updateButtonText());
  updateButton?.setAttribute("title", updateButtonText());
  if (!force) showAvailableUpdateOnce(updateState);
  return updateState;
}

async function renderSettings(): Promise<void> {
  const fontOptions = Array.from(new Set([config.editor_font, ...systemFonts]))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  const shell = pageShell("", renderHome, false, false);
  const main = document.createElement("main");
  main.className = "settings-page";
  main.innerHTML = `
    <div class="settings-heading">
      <div class="settings-title"><h1>${t("settingsTitle")}</h1><span>v${appVersion}</span></div>
      <div class="settings-actions">
        <button class="button compact-button update-button update-indicator ${updateState.status === "available" ? "has-update" : ""}" data-action="update" aria-label="${updateButtonText()}" title="${updateButtonText()}">${icon("update")}<span class="update-dot" aria-hidden="true"></span></button>
        <button class="button compact-button github-button" data-action="github" aria-label="${t("openGithub")}" title="${t("openGithub")}">${icon("github")}</button>
      </div>
    </div>
    <section class="setting-card toggle-row language-row">
      <label for="language-select">${t("language")}</label>
      <select id="language-select" class="font-select language-select" aria-label="${t("chooseLanguage")}">
        <option value="en" ${config.language === "en" ? "selected" : ""}>${t("english")}</option>
        <option value="zh-CN" ${config.language === "zh-CN" ? "selected" : ""}>${t("simplifiedChinese")}</option>
      </select>
    </section>
    <section class="setting-card toggle-row">
      <div><label for="autostart">${t("autostart")}</label></div>
      <input id="autostart" type="checkbox" ${config.autostart ? "checked" : ""} />
    </section>
    <section class="setting-card">
      <label>${t("markdownPath")}</label>
      <div class="path-row"><input type="text" readonly value="${escapeHtml(config.save_dir)}" /><button class="button" data-action="browse">${t("change")}</button><button class="button" data-action="open-directory">${t("open")}</button></div>
    </section>
    <section class="setting-card">
      <label for="editor-font">${t("editorFont")}</label>
      <select id="editor-font" class="font-select">
        ${fontOptions.map((font) => `<option value="${escapeHtml(font)}" ${font === config.editor_font ? "selected" : ""}>${escapeHtml(font)}</option>`).join("")}
      </select>
    </section>
    <section class="setting-card toggle-row">
      <div><label for="spellcheck">${t("spellcheck")}</label></div>
      <input id="spellcheck" type="checkbox" ${config.spellcheck ? "checked" : ""} />
    </section>
    <section class="setting-card toggle-row">
      <div><label for="heading-divider">${t("headingDivider")}</label></div>
      <input id="heading-divider" type="checkbox" ${config.heading_divider ? "checked" : ""} />
    </section>
    <section class="setting-card toggle-row">
      <div><label for="heading-list-highlight">${t("structureHighlight")}</label></div>
      <input id="heading-list-highlight" type="checkbox" ${config.heading_list_highlight ? "checked" : ""} />
    </section>`;
  const pathInput = main.querySelector<HTMLInputElement>('.path-row input')!;
  const browseButton = main.querySelector<HTMLButtonElement>('[data-action="browse"]')!;
  const openDirectoryButton = main.querySelector<HTMLButtonElement>('[data-action="open-directory"]')!;
  const languageSelect = main.querySelector<HTMLSelectElement>("#language-select")!;
  languageSelect.addEventListener("change", async () => {
    const previousLanguage = config.language;
    languageSelect.disabled = true;
    try {
      config.language = await api.setLanguage(languageSelect.value as typeof config.language);
      setLanguage(config.language);
      await renderSettings();
    } catch (error) {
      languageSelect.value = previousLanguage;
      languageSelect.disabled = false;
      showError(error);
    }
  });
  const showSettingsStatus = (message: string, kind: "info" | "warning" = "info") => {
    showToast(message, kind);
  };
  main.querySelector('[data-action="browse"]')?.addEventListener("click", async () => {
    try {
      const selected = await api.chooseDirectory();
      if (!selected || selected === config.save_dir) return;
      browseButton.disabled = true;
      openDirectoryButton.disabled = true;
      const migration = await api.migrateDirectory(selected);
      config.save_dir = selected;
      pathInput.value = selected;
      if (migration.retained_files.length) {
        showSettingsStatus(t("pathChangedWarning"), "warning");
      } else {
        showSettingsStatus(t("pathChanged"));
      }
    } catch (error) {
      showError(error);
    } finally {
      browseButton.disabled = false;
      openDirectoryButton.disabled = false;
    }
  });
  const updateButton = main.querySelector<HTMLButtonElement>('[data-action="update"]')!;
  updateButton.addEventListener("click", async () => {
    updateButton.disabled = true;
    try {
      if (updateState.status === "available") {
        updateButton.setAttribute("aria-label", t("downloadingUpdate"));
        updateButton.setAttribute("title", t("downloadingUpdate"));
        updateState = await api.installUpdate();
        if (updateState.status !== "available") showSettingsStatus(t("upToDate"));
        return;
      }
      updateButton.setAttribute("aria-label", t("checkingUpdate"));
      updateButton.setAttribute("title", t("checkingUpdate"));
      const state = await refreshUpdateState(true);
      if (state.status === "available" && state.available_version) {
        showSettingsStatus(t("updateAvailable", { version: state.available_version }));
      } else if (state.status === "unsupported") {
        showSettingsStatus(t("updateUnavailable"), "warning");
      } else {
        showSettingsStatus(t("upToDate"));
      }
    } catch (error) {
      showSettingsStatus(t("updateFailed"), "warning");
      void error;
    } finally {
      updateButton.setAttribute("aria-label", updateButtonText());
      updateButton.setAttribute("title", updateButtonText());
      updateButton.disabled = false;
    }
  });
  main.querySelector('[data-action="github"]')?.addEventListener("click", async () => {
    try {
      await api.openProjectHomepage();
    } catch (error) {
      showError(error);
    }
  });
  main.querySelector('[data-action="open-directory"]')?.addEventListener("click", async () => {
    try {
      await api.openDirectory(config.save_dir);
    } catch (error) {
      showError(error);
    }
  });
  const fontSelect = main.querySelector<HTMLSelectElement>("#editor-font")!;
  fontSelect.addEventListener("change", async () => {
    const previous = config.editor_font;
    const next = fontSelect.value;
    if (next === previous) return;
    fontSelect.disabled = true;
    try {
      await api.setEditorPreferences(next, config.editor_font_size);
      config.editor_font = next;
      applyEditorAppearance();
    } catch (error) {
      fontSelect.value = previous;
      showError(error);
    } finally {
      fontSelect.disabled = false;
    }
  });
  const headingDividerToggle = main.querySelector<HTMLInputElement>("#heading-divider")!;
  const spellcheckToggle = main.querySelector<HTMLInputElement>("#spellcheck")!;
  spellcheckToggle.addEventListener("change", async () => {
    const previous = config.spellcheck;
    const next = spellcheckToggle.checked;
    if (next === previous) return;
    spellcheckToggle.disabled = true;
    try {
      await api.setSpellcheck(next);
      config.spellcheck = next;
    } catch (error) {
      spellcheckToggle.checked = previous;
      showError(error);
    } finally {
      spellcheckToggle.disabled = false;
    }
  });
  headingDividerToggle.addEventListener("change", async () => {
    const previous = config.heading_divider;
    const next = headingDividerToggle.checked;
    if (next === previous) return;
    headingDividerToggle.disabled = true;
    try {
      await api.setHeadingDivider(next);
      config.heading_divider = next;
      applyEditorAppearance();
    } catch (error) {
      headingDividerToggle.checked = previous;
      showError(error);
    } finally {
      headingDividerToggle.disabled = false;
    }
  });
  const headingListHighlightToggle = main.querySelector<HTMLInputElement>(
    "#heading-list-highlight",
  )!;
  headingListHighlightToggle.addEventListener("change", async () => {
    const previous = config.heading_list_highlight;
    const next = headingListHighlightToggle.checked;
    if (next === previous) return;
    headingListHighlightToggle.disabled = true;
    try {
      await api.setHeadingListHighlight(next);
      config.heading_list_highlight = next;
      applyEditorAppearance();
    } catch (error) {
      headingListHighlightToggle.checked = previous;
      showError(error);
    } finally {
      headingListHighlightToggle.disabled = false;
    }
  });
  const autostartToggle = main.querySelector<HTMLInputElement>("#autostart")!;
  autostartToggle.addEventListener("change", async () => {
    const previous = config.autostart;
    const next = autostartToggle.checked;
    if (next === previous) return;
    autostartToggle.disabled = true;
    try {
      await api.setAutostart(next);
      config.autostart = next;
    } catch (error) {
      autostartToggle.checked = previous;
      showError(error);
    } finally {
      autostartToggle.disabled = false;
    }
  });
  shell.append(main);
  attachOverlayScrollbar(main);
}

async function checkExternalChange(): Promise<void> {
  if (!currentNote || saving || locked) return;
  try {
    const disk = await api.openNote(currentNote.name);
    if (disk.revision === currentNote.revision) return;
    if (!dirty) {
      await showNote(disk);
      showToast(t("externalReloaded"));
    } else {
      showConflict({
        status: "conflict",
        revision: disk.revision,
        external_content: disk.content,
        has_bom: disk.has_bom,
        newline: disk.newline,
      });
      locked = true;
    }
  } catch {
    if (dirty) showMissing();
    else await renderHome();
  }
}

async function syncAlwaysOnTop(): Promise<void> {
  try {
    const enabled = await api.getAlwaysOnTop();
    config.always_on_top = enabled;
    syncPinButtons(document, enabled);
  } catch (error) {
    showError(error);
  }
}

async function start(): Promise<void> {
  app.innerHTML = `<div class="loading"><span>Bitty</span><p>${t("opening")}</p></div>`;
  api = await connectApi();
  const bootstrap = await api.bootstrap();
  config = bootstrap.config;
  setLanguage(config.language);
  notes = bootstrap.notes;
  systemFonts = bootstrap.system_fonts;
  appVersion = bootstrap.app_version;
  updateState = bootstrap.update_state;
  applyEditorAppearance();
  await syncAlwaysOnTop();
  window.addEventListener("focus", () => {
    void checkExternalChange();
    void syncAlwaysOnTop();
  });
  let restoredNote = false;
  if (config.last_note) {
    try {
      await showNote(await api.openNote(config.last_note));
      restoredNote = true;
    } catch {
      config.last_note = null;
    }
  }
  if (!restoredNote) await renderHome();
  if (bootstrap.update_result) {
    showToast(
      bootstrap.update_result.status === "success"
        ? t("updateSucceeded", { version: bootstrap.update_result.version })
        : t("updateFailed"),
      bootstrap.update_result.status === "success" ? "info" : "warning",
    );
  }
  showAvailableUpdateOnce(updateState);
  void refreshUpdateState(false).catch(() => {});
  window.setInterval(() => void refreshUpdateState(false).catch(() => {}), 60 * 60 * 1000);
}

void start().catch((error) => {
  app.innerHTML = `<div class="fatal-error"><h1>${t("startupFailed")}</h1><p>${escapeHtml(errorMessage(error))}</p></div>`;
});
