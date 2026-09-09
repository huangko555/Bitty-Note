import type {
  BootstrapData,
  MigrationResult,
  OpenedNote,
  SaveResult,
  UpdateState,
} from "./types";
import type { AppLanguage, TextHighlightColor } from "./types";
import { t } from "./i18n";

interface PythonApi {
  bootstrap(): Promise<BootstrapData>;
  window_ready(): Promise<void>;
  list_notes(): Promise<BootstrapData["notes"]>;
  list_archived_notes(): Promise<BootstrapData["notes"]>;
  create_note(name: string): Promise<OpenedNote>;
  duplicate_note(name: string, requestedName: string): Promise<OpenedNote>;
  rename_note(name: string, requestedName: string): Promise<OpenedNote>;
  acquire_note(name: string): Promise<{ available: boolean }>;
  open_note_window(name: string): Promise<{ status: "opened" | "focused" }>;
  show_main_window(): Promise<void>;
  open_note_in_editor(name: string): Promise<void>;
  request_note_rename(name: string): Promise<{ status: "available" | "focused" }>;
  open_note(name: string): Promise<OpenedNote>;
  save_note(
    name: string,
    content: string,
    revision: string,
    hasBom: boolean,
    newline: "\n" | "\r\n",
    background: string,
    force: boolean,
  ): Promise<SaveResult>;
  recreate_note(
    name: string,
    content: string,
    hasBom: boolean,
    newline: "\n" | "\r\n",
    background: string,
  ): Promise<OpenedNote>;
  archive_note(name: string): Promise<{ archived_name: string }>;
  trash_note(name: string): Promise<void>;
  set_note_pinned(name: string, pinned: boolean): Promise<{ pinned_notes: string[] }>;
  restore_archived_note(name: string): Promise<{ restored_name: string }>;
  delete_archived_note(name: string): Promise<void>;
  choose_directory(): Promise<string | null>;
  open_directory(path: string): Promise<void>;
  migrate_directory(path: string): Promise<MigrationResult>;
  set_autostart(enabled: boolean): Promise<{ enabled: boolean }>;
  remember_last_note(name: string | null): Promise<void>;
  set_always_on_top(enabled: boolean): Promise<{ enabled: boolean }>;
  get_always_on_top(): Promise<{ enabled: boolean }>;
  set_editor_preferences(
    editorFont: BootstrapData["config"]["editor_font"],
    editorFontSize: number,
  ): Promise<{ editor_font: BootstrapData["config"]["editor_font"]; editor_font_size: number }>;
  set_heading_divider(enabled: boolean): Promise<{ enabled: boolean }>;
  set_heading_list_highlight(enabled: boolean): Promise<{ enabled: boolean }>;
  set_editor_highlight_color(color: string): Promise<{ color: string }>;
  set_text_highlight_color(color: TextHighlightColor): Promise<{ color: TextHighlightColor }>;
  set_language(language: AppLanguage): Promise<{ language: AppLanguage }>;
  check_update(force: boolean): Promise<UpdateState>;
  install_update(): Promise<UpdateState>;
  open_project_homepage(): Promise<void>;
  start_window_interaction(region: WindowInteractionRegion): Promise<void>;
  update_window_interaction(): Promise<void>;
  end_window_interaction(): Promise<void>;
  minimize_window(): Promise<void>;
  close_window(): Promise<void>;
  cancel_close(): Promise<void>;
}

export type WindowResizeEdge =
  | "left"
  | "right"
  | "top"
  | "top_left"
  | "top_right"
  | "bottom"
  | "bottom_left"
  | "bottom_right";

export type WindowInteractionRegion = "caption" | WindowResizeEdge;

declare global {
  interface Window {
    pywebview?: { api: PythonApi };
  }
}

export interface DesktopApi {
  bootstrap(): Promise<BootstrapData>;
  windowReady(): Promise<void>;
  listNotes(): Promise<BootstrapData["notes"]>;
  listArchivedNotes(): Promise<BootstrapData["notes"]>;
  createNote(name: string): Promise<OpenedNote>;
  duplicateNote(name: string, requestedName: string): Promise<OpenedNote>;
  renameNote(name: string, requestedName: string): Promise<OpenedNote>;
  acquireNote(name: string): Promise<boolean>;
  openNoteWindow(name: string): Promise<"opened" | "focused">;
  showMainWindow(): Promise<void>;
  openNoteInEditor(name: string): Promise<void>;
  requestNoteRename(name: string): Promise<"available" | "focused">;
  openNote(name: string): Promise<OpenedNote>;
  saveNote(note: OpenedNote, content: string, force?: boolean): Promise<SaveResult>;
  recreateNote(note: OpenedNote, content: string): Promise<OpenedNote>;
  archiveNote(name: string): Promise<void>;
  moveNoteToTrash(name: string): Promise<void>;
  setNotePinned(name: string, pinned: boolean): Promise<string[]>;
  restoreArchivedNote(name: string): Promise<void>;
  deleteArchivedNote(name: string): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  openDirectory(path: string): Promise<void>;
  migrateDirectory(path: string): Promise<MigrationResult>;
  setAutostart(enabled: boolean): Promise<void>;
  rememberLastNote(name: string | null): Promise<void>;
  setAlwaysOnTop(enabled: boolean): Promise<void>;
  getAlwaysOnTop(): Promise<boolean>;
  setEditorPreferences(
    editorFont: BootstrapData["config"]["editor_font"],
    editorFontSize: number,
  ): Promise<void>;
  setHeadingDivider(enabled: boolean): Promise<void>;
  setHeadingListHighlight(enabled: boolean): Promise<void>;
  setEditorHighlightColor(color: string): Promise<string>;
  setTextHighlightColor(color: TextHighlightColor): Promise<TextHighlightColor>;
  setLanguage(language: AppLanguage): Promise<AppLanguage>;
  checkUpdate(force?: boolean): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  openProjectHomepage(): Promise<void>;
  startWindowInteraction(region: WindowInteractionRegion): Promise<void>;
  updateWindowInteraction(): Promise<void>;
  endWindowInteraction(): Promise<void>;
  minimizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  cancelClose(): Promise<void>;
}

function desktopApi(raw: PythonApi): DesktopApi {
  return {
    bootstrap: () => raw.bootstrap(),
    windowReady: () => raw.window_ready(),
    listNotes: () => raw.list_notes(),
    listArchivedNotes: () => raw.list_archived_notes(),
    createNote: (name) => raw.create_note(name),
    duplicateNote: (name, requestedName) => raw.duplicate_note(name, requestedName),
    renameNote: (name, requestedName) => raw.rename_note(name, requestedName),
    acquireNote: async (name) => (await raw.acquire_note(name)).available,
    openNoteWindow: async (name) => (await raw.open_note_window(name)).status,
    showMainWindow: () => raw.show_main_window(),
    openNoteInEditor: (name) => raw.open_note_in_editor(name),
    requestNoteRename: async (name) => (await raw.request_note_rename(name)).status,
    openNote: (name) => raw.open_note(name),
    saveNote: (note, content, force = false) =>
      raw.save_note(
        note.name,
        content,
        note.revision,
        note.has_bom,
        note.newline,
        note.background ?? "default",
        force,
      ),
    recreateNote: (note, content) =>
      raw.recreate_note(
        note.name,
        content,
        note.has_bom,
        note.newline,
        note.background ?? "default",
      ),
    archiveNote: async (name) => {
      await raw.archive_note(name);
    },
    moveNoteToTrash: (name) => raw.trash_note(name),
    setNotePinned: async (name, pinned) => (await raw.set_note_pinned(name, pinned)).pinned_notes,
    restoreArchivedNote: async (name) => {
      await raw.restore_archived_note(name);
    },
    deleteArchivedNote: (name) => raw.delete_archived_note(name),
    chooseDirectory: () => raw.choose_directory(),
    openDirectory: (path) => raw.open_directory(path),
    migrateDirectory: (path) => raw.migrate_directory(path),
    setAutostart: async (enabled) => {
      await raw.set_autostart(enabled);
    },
    rememberLastNote: (name) => raw.remember_last_note(name),
    setAlwaysOnTop: async (enabled) => {
      await raw.set_always_on_top(enabled);
    },
    getAlwaysOnTop: async () => (await raw.get_always_on_top()).enabled,
    setEditorPreferences: async (editorFont, editorFontSize) => {
      await raw.set_editor_preferences(editorFont, editorFontSize);
    },
    setHeadingDivider: async (enabled) => {
      await raw.set_heading_divider(enabled);
    },
    setHeadingListHighlight: async (enabled) => {
      await raw.set_heading_list_highlight(enabled);
    },
    setEditorHighlightColor: async (color) => (
      await raw.set_editor_highlight_color(color)
    ).color,
    setTextHighlightColor: async (color) => (
      await raw.set_text_highlight_color(color)
    ).color,
    setLanguage: async (language) => (await raw.set_language(language)).language,
    checkUpdate: (force = false) => raw.check_update(force),
    installUpdate: () => raw.install_update(),
    openProjectHomepage: () => raw.open_project_homepage(),
    startWindowInteraction: (region) => raw.start_window_interaction(region),
    updateWindowInteraction: () => raw.update_window_interaction(),
    endWindowInteraction: () => raw.end_window_interaction(),
    minimizeWindow: () => raw.minimize_window(),
    closeWindow: () => raw.close_window(),
    cancelClose: () => raw.cancel_close(),
  };
}

const EMPTY_LINE_MARKER = "<!-- bitty-empty-line -->";
const FOLDED_MARKER = "<!-- bitty-folded -->";
const TEXT_HIGHLIGHT_MARKUP = /==(?:\{(?:red|yellow|blue|green)\}|(?!\{))(.*?)==/g;
const MARKDOWN_MARKERS = /^(?:#{1,6}\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)|(\*\*|__|~~|(?<!\*)\*(?!\*)|(?<!_)_(?!_))/g;

function plainPreview(text: string): string {
  const previewLines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
      .replace(TEXT_HIGHLIGHT_MARKUP, "$1")
      .replace(MARKDOWN_MARKERS, "")
      .replaceAll(FOLDED_MARKER, "")
      .trim();
    if (line === EMPTY_LINE_MARKER) continue;
    if (line) previewLines.push(line);
    if (previewLines.length === 3) break;
  }
  const preview = previewLines.join(" ");
  return preview.length <= 120 ? preview : `${preview.slice(0, 119)}…`;
}

function browserMock(): DesktopApi {
  const searchParams = new URLSearchParams(window.location.search);
  const notePreviewEnabled = import.meta.env.DEV && searchParams.get("preview") === "note";
  const homePreviewEnabled = import.meta.env.DEV && searchParams.get("preview") === "home";
  let notes: OpenedNote[] = homePreviewEnabled
    ? [
      {
        name: "今天要做.md",
        content: "整理一下今天最重要的三件事。",
        revision: "preview-home-1",
        has_bom: false,
        newline: "\n",
        background: "sand",
      },
      {
        name: "设计想法.md",
        content: "便签正文保持清爽，只用底边表达颜色。",
        revision: "preview-home-2",
        has_bom: false,
        newline: "\n",
        background: "sky",
      },
      {
        name: "稍后阅读.md",
        content: "把零散的资料集中到这里。",
        revision: "preview-home-3",
        has_bom: false,
        newline: "\n",
        background: "rose",
      },
      {
        name: "默认便签.md",
        content: "这是没有设置背景颜色时的卡片效果。",
        revision: "preview-home-4",
        has_bom: false,
        newline: "\n",
        background: "default",
      },
      {
        name: "会议记录.md",
        content: "整理讨论结论和后续事项。",
        revision: "preview-home-5",
        has_bom: false,
        newline: "\n",
        background: "default",
      },
      {
        name: "购物清单.md",
        content: "记下周末需要采购的物品。",
        revision: "preview-home-6",
        has_bom: false,
        newline: "\n",
        background: "default",
      },
      {
        name: "灵感碎片.md",
        content: "随手收集还没有整理的想法。",
        revision: "preview-home-7",
        has_bom: false,
        newline: "\n",
        background: "default",
      },
      {
        name: "本周计划.md",
        content: "集中处理本周准备推进的事情。",
        revision: "preview-home-8",
        has_bom: false,
        newline: "\n",
        background: "default",
      },
    ]
    : notePreviewEnabled
      ? [{
        name: "便签详情预览.md",
        content: "# 便签详情\n\n这是用于调整界面的本地预览便签。\n\n- 可以修改背景颜色\n- 可以展开右上角菜单\n- 可以测试标题重命名状态",
        revision: "preview-note",
        has_bom: false,
        newline: "\n",
        background: "sand",
      }]
      : [];
  let archivedNotes: OpenedNote[] = [];
  let demoUpdateAvailable = false;
  const updateDemoEnabled = import.meta.env.DEV && (
    import.meta.env.VITE_UPDATE_DEMO === "1"
    || searchParams.get("update-demo") === "1"
  );
  const demoDelay = (milliseconds: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
  let saveDir = "Browser preview (no files are written)";
  let autostart = true;
  let alwaysOnTop = false;
  let language: AppLanguage = notePreviewEnabled || homePreviewEnabled ? "zh-CN" : "en";
  let textHighlightColor: TextHighlightColor = "red";
  let pinnedNotes: string[] = [];
  const revision = () => `${Date.now()}-${Math.random()}`;
  const summary = (items: OpenedNote[]) =>
    items.map((note, index) => ({
      name: note.name,
      preview: plainPreview(note.content),
      modified_ms: Date.now() - index,
      pinned: pinnedNotes.some((item) => item.toLocaleLowerCase() === note.name.toLocaleLowerCase()),
      background: note.background ?? "default",
    }));
  const uniqueName = (requested: string) => {
    const base = (requested.trim() || new Date().toISOString().slice(0, 10)).replace(/\.md$/i, "");
    let name = `${base}.md`;
    let index = 2;
    while (notes.some((note) => note.name.toLowerCase() === name.toLowerCase())) {
      name = `${base} (${index}).md`;
      index += 1;
    }
    return name;
  };
  return {
    bootstrap: async () => ({
      config: {
        save_dir: saveDir,
        language,
        autostart,
        always_on_top: alwaysOnTop,
        window_x: null,
        window_y: null,
        window_width: 350,
        window_height: 530,
        note_window_sizes: {},
        pinned_notes: [...pinnedNotes],
        last_note: null,
        editor_font: "DengXian",
        editor_font_size: 14,
        heading_divider: true,
        heading_list_highlight: true,
        editor_highlight_color: "#456FC4",
        text_highlight_color: textHighlightColor,
        last_update_check_ms: null,
        available_version: null,
        pending_update_version: null,
      },
      notes: summary(notes),
      system_fonts: ["Microsoft YaHei", "DengXian", "SimSun", "KaiTi"],
      app_version: "1.8.0",
      update_state: { status: "unsupported", available_version: null },
      update_result: null,
      window_role: notePreviewEnabled ? "note" : "main",
      initial_note: notePreviewEnabled ? notes[0]?.name ?? null : null,
    }),
    windowReady: async () => {},
    listNotes: async () => summary([...notes].sort((left, right) => {
      const leftPinned = pinnedNotes.some((item) => item.toLocaleLowerCase() === left.name.toLocaleLowerCase());
      const rightPinned = pinnedNotes.some((item) => item.toLocaleLowerCase() === right.name.toLocaleLowerCase());
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      return notes.indexOf(left) - notes.indexOf(right);
    })),
    listArchivedNotes: async () => summary(archivedNotes),
    createNote: async (requested) => {
      const note: OpenedNote = {
        name: uniqueName(requested),
        content: "",
        revision: revision(),
        has_bom: false,
        newline: "\n",
        background: "default",
      };
      notes.unshift(note);
      return { ...note };
    },
    duplicateNote: async (name, requested) => {
      const source = notes.find((item) => item.name === name);
      if (!source) throw new Error(t("missingTitle"));
      const note: OpenedNote = {
        ...source,
        name: uniqueName(requested),
        revision: revision(),
      };
      notes.unshift(note);
      return { ...note };
    },
    renameNote: async (name, requested) => {
      const note = notes.find((item) => item.name === name);
      if (!note) throw new Error(t("missingTitle"));
      const stem = (requested.trim() || new Date().toISOString().slice(0, 10))
        .replace(/\.md$/i, "");
      const renamedName = `${stem}.md`;
      if (notes.some((item) => (
        item !== note && item.name.toLocaleLowerCase() === renamedName.toLocaleLowerCase()
      ))) {
        throw new Error(t("noteNameExists", { name: renamedName }));
      }
      note.name = renamedName;
      pinnedNotes = pinnedNotes.map((item) => (
        item.toLocaleLowerCase() === name.toLocaleLowerCase() ? renamedName : item
      ));
      return { ...note };
    },
    acquireNote: async () => true,
    openNoteWindow: async () => "opened",
    showMainWindow: async () => {},
    openNoteInEditor: async () => {},
    requestNoteRename: async () => "available",
    openNote: async (name) => {
      const note = notes.find((item) => item.name === name);
      if (!note) throw new Error(t("missingTitle"));
      return { ...note };
    },
    saveNote: async (note, content) => {
      const stored = notes.find((item) => item.name === note.name);
      if (!stored) return { status: "missing", revision: null, external_content: null, has_bom: false, newline: "\n" };
      stored.content = content;
      stored.background = note.background ?? "default";
      stored.revision = revision();
      return { status: "saved", revision: stored.revision, external_content: null, has_bom: false, newline: "\n" };
    },
    recreateNote: async (note, content) => {
      const recreated = { ...note, content, revision: revision() };
      notes.unshift(recreated);
      return { ...recreated };
    },
    archiveNote: async (name) => {
      const note = notes.find((item) => item.name === name);
      if (!note) throw new Error(t("missingTitle"));
      notes = notes.filter((item) => item.name !== name);
      pinnedNotes = pinnedNotes.filter((item) => item.toLocaleLowerCase() !== name.toLocaleLowerCase());
      let archivedName = note.name;
      let index = 2;
      while (archivedNotes.some((item) => item.name.toLowerCase() === archivedName.toLowerCase())) {
        archivedName = `${note.name.replace(/\.md$/i, "")} (${index}).md`;
        index += 1;
      }
      archivedNotes.unshift({ ...note, name: archivedName });
    },
    moveNoteToTrash: async (name) => {
      if (!notes.some((item) => item.name === name)) {
        throw new Error(t("missingTitle"));
      }
      notes = notes.filter((item) => item.name !== name);
      pinnedNotes = pinnedNotes.filter((item) => item.toLocaleLowerCase() !== name.toLocaleLowerCase());
    },
    setNotePinned: async (name, pinned) => {
      if (!notes.some((item) => item.name === name)) {
        throw new Error(t("missingTitle"));
      }
      pinnedNotes = pinnedNotes.filter(
        (item) => item.toLocaleLowerCase() !== name.toLocaleLowerCase(),
      );
      if (pinned) pinnedNotes.unshift(name);
      return [...pinnedNotes];
    },
    restoreArchivedNote: async (name) => {
      const note = archivedNotes.find((item) => item.name === name);
      if (!note) throw new Error(t("missingTitle"));
      archivedNotes = archivedNotes.filter((item) => item.name !== name);
      const restoredName = uniqueName(note.name.replace(/\.md$/i, ""));
      notes.unshift({ ...note, name: restoredName });
    },
    deleteArchivedNote: async (name) => {
      if (!archivedNotes.some((item) => item.name === name)) {
        throw new Error(t("missingTitle"));
      }
      archivedNotes = archivedNotes.filter((item) => item.name !== name);
    },
    chooseDirectory: async () => "Browser preview/New folder",
    openDirectory: async () => {},
    migrateDirectory: async (path) => {
      saveDir = path;
      const copiedCount = notes.length + archivedNotes.length;
      return { copied_count: copiedCount, recycled_count: copiedCount, retained_files: [] };
    },
    setAutostart: async (enabled) => {
      autostart = enabled;
    },
    rememberLastNote: async () => {},
    setAlwaysOnTop: async (enabled) => {
      alwaysOnTop = enabled;
    },
    getAlwaysOnTop: async () => alwaysOnTop,
    setEditorPreferences: async () => {},
    setHeadingDivider: async () => {},
    setHeadingListHighlight: async () => {},
    setEditorHighlightColor: async (color) => color.toUpperCase(),
    setTextHighlightColor: async (color) => {
      textHighlightColor = color;
      return color;
    },
    setLanguage: async (nextLanguage) => {
      language = nextLanguage;
      return language;
    },
    checkUpdate: async (force = false) => {
      if (!updateDemoEnabled) return { status: "unsupported", available_version: null };
      if (!force) return { status: "idle", available_version: null };
      await demoDelay(1_200);
      demoUpdateAvailable = true;
      return { status: "available", available_version: "1.2.0" };
    },
    installUpdate: async () => {
      if (!updateDemoEnabled || !demoUpdateAvailable) {
        return { status: "unsupported", available_version: null };
      }
      await demoDelay(1_600);
      demoUpdateAvailable = false;
      return { status: "idle", available_version: null };
    },
    openProjectHomepage: async () => {
      window.open("https://github.com/huangko555/Bitty-Note", "_blank", "noopener");
    },
    startWindowInteraction: async () => {},
    updateWindowInteraction: async () => {},
    endWindowInteraction: async () => {},
    minimizeWindow: async () => {},
    closeWindow: async () => {},
    cancelClose: async () => {},
  };
}

export async function connectApi(): Promise<DesktopApi> {
  const getNativeApi = (): PythonApi | null => {
    const api = window.pywebview?.api;
    return typeof api?.bootstrap === "function" ? api : null;
  };

  const initialApi = getNativeApi();
  if (initialApi) return desktopApi(initialApi);
  if (import.meta.env.DEV) return browserMock();
  await new Promise<void>((resolve) => {
    // WebView2 can take a few seconds to inject the native bridge on a cold
    // start. Keep the loading view alive long enough to avoid falling back to
    // browser preview mode inside the packaged application.
    const finish = () => {
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      resolve();
    };
    const poll = window.setInterval(() => {
      if (getNativeApi()) finish();
    }, 25);
    const timeout = window.setTimeout(finish, 5_000);
  });
  const readyApi = getNativeApi();
  return readyApi ? desktopApi(readyApi) : browserMock();
}
