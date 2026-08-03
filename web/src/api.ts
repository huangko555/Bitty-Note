import type {
  BootstrapData,
  MigrationResult,
  OpenedNote,
  SaveResult,
  UpdateState,
} from "./types";
import type { AppLanguage } from "./types";
import { t } from "./i18n";

interface PythonApi {
  bootstrap(): Promise<BootstrapData>;
  list_notes(): Promise<BootstrapData["notes"]>;
  list_archived_notes(): Promise<BootstrapData["notes"]>;
  create_note(name: string): Promise<OpenedNote>;
  duplicate_note(name: string, requestedName: string): Promise<OpenedNote>;
  open_note(name: string): Promise<OpenedNote>;
  save_note(
    name: string,
    content: string,
    revision: string,
    hasBom: boolean,
    newline: "\n" | "\r\n",
    force: boolean,
  ): Promise<SaveResult>;
  recreate_note(
    name: string,
    content: string,
    hasBom: boolean,
    newline: "\n" | "\r\n",
  ): Promise<OpenedNote>;
  archive_note(name: string): Promise<{ archived_name: string }>;
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
  set_spellcheck(enabled: boolean): Promise<{ enabled: boolean }>;
  set_heading_list_highlight(enabled: boolean): Promise<{ enabled: boolean }>;
  set_language(language: AppLanguage): Promise<{ language: AppLanguage }>;
  check_update(force: boolean): Promise<UpdateState>;
  install_update(): Promise<UpdateState>;
  open_project_homepage(): Promise<void>;
  start_window_interaction(region: WindowInteractionRegion): Promise<void>;
  update_window_interaction(): Promise<void>;
  end_window_interaction(): Promise<void>;
  minimize_window(): Promise<void>;
  close_window(): Promise<void>;
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
  listNotes(): Promise<BootstrapData["notes"]>;
  listArchivedNotes(): Promise<BootstrapData["notes"]>;
  createNote(name: string): Promise<OpenedNote>;
  duplicateNote(name: string, requestedName: string): Promise<OpenedNote>;
  openNote(name: string): Promise<OpenedNote>;
  saveNote(note: OpenedNote, content: string, force?: boolean): Promise<SaveResult>;
  recreateNote(note: OpenedNote, content: string): Promise<OpenedNote>;
  archiveNote(name: string): Promise<void>;
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
  setSpellcheck(enabled: boolean): Promise<void>;
  setHeadingListHighlight(enabled: boolean): Promise<void>;
  setLanguage(language: AppLanguage): Promise<AppLanguage>;
  checkUpdate(force?: boolean): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  openProjectHomepage(): Promise<void>;
  startWindowInteraction(region: WindowInteractionRegion): Promise<void>;
  updateWindowInteraction(): Promise<void>;
  endWindowInteraction(): Promise<void>;
  minimizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
}

function desktopApi(raw: PythonApi): DesktopApi {
  return {
    bootstrap: () => raw.bootstrap(),
    listNotes: () => raw.list_notes(),
    listArchivedNotes: () => raw.list_archived_notes(),
    createNote: (name) => raw.create_note(name),
    duplicateNote: (name, requestedName) => raw.duplicate_note(name, requestedName),
    openNote: (name) => raw.open_note(name),
    saveNote: (note, content, force = false) =>
      raw.save_note(
        note.name,
        content,
        note.revision,
        note.has_bom,
        note.newline,
        force,
      ),
    recreateNote: (note, content) =>
      raw.recreate_note(note.name, content, note.has_bom, note.newline),
    archiveNote: async (name) => {
      await raw.archive_note(name);
    },
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
    setSpellcheck: async (enabled) => {
      await raw.set_spellcheck(enabled);
    },
    setHeadingListHighlight: async (enabled) => {
      await raw.set_heading_list_highlight(enabled);
    },
    setLanguage: async (language) => (await raw.set_language(language)).language,
    checkUpdate: (force = false) => raw.check_update(force),
    installUpdate: () => raw.install_update(),
    openProjectHomepage: () => raw.open_project_homepage(),
    startWindowInteraction: (region) => raw.start_window_interaction(region),
    updateWindowInteraction: () => raw.update_window_interaction(),
    endWindowInteraction: () => raw.end_window_interaction(),
    minimizeWindow: () => raw.minimize_window(),
    closeWindow: () => raw.close_window(),
  };
}

function browserMock(): DesktopApi {
  let notes: OpenedNote[] = [];
  let archivedNotes: OpenedNote[] = [];
  let saveDir = "Browser preview (no files are written)";
  let autostart = true;
  let alwaysOnTop = false;
  let language: AppLanguage = "en";
  const revision = () => `${Date.now()}-${Math.random()}`;
  const summary = (items: OpenedNote[]) =>
    items.map((note, index) => ({
      name: note.name,
      preview: note.content
        .replaceAll("<!-- bitty-empty-line -->", "")
        .replace(/[#*~\[\]-]/g, "")
        .slice(0, 80),
      modified_ms: Date.now() - index,
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
        last_note: null,
        editor_font: "DengXian",
        editor_font_size: 14,
        spellcheck: false,
        heading_divider: true,
        heading_list_highlight: true,
        last_update_check_ms: null,
        available_version: null,
        pending_update_version: null,
      },
      notes: summary(notes),
      system_fonts: ["Microsoft YaHei", "DengXian", "SimSun", "KaiTi"],
      app_version: "1.1.1",
      update_state: { status: "unsupported", available_version: null },
      update_result: null,
    }),
    listNotes: async () => summary(notes),
    listArchivedNotes: async () => summary(archivedNotes),
    createNote: async (requested) => {
      const note: OpenedNote = {
        name: uniqueName(requested),
        content: "",
        revision: revision(),
        has_bom: false,
        newline: "\n",
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
    openNote: async (name) => {
      const note = notes.find((item) => item.name === name);
      if (!note) throw new Error(t("missingTitle"));
      return { ...note };
    },
    saveNote: async (note, content) => {
      const stored = notes.find((item) => item.name === note.name);
      if (!stored) return { status: "missing", revision: null, external_content: null, has_bom: false, newline: "\n" };
      stored.content = content;
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
      let archivedName = note.name;
      let index = 2;
      while (archivedNotes.some((item) => item.name.toLowerCase() === archivedName.toLowerCase())) {
        archivedName = `${note.name.replace(/\.md$/i, "")} (${index}).md`;
        index += 1;
      }
      archivedNotes.unshift({ ...note, name: archivedName });
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
    setSpellcheck: async () => {},
    setHeadingListHighlight: async () => {},
    setLanguage: async (nextLanguage) => {
      language = nextLanguage;
      return language;
    },
    checkUpdate: async () => ({ status: "unsupported", available_version: null }),
    installUpdate: async () => ({ status: "unsupported", available_version: null }),
    openProjectHomepage: async () => {
      window.open("https://github.com/huangko555/Bitty-Note", "_blank", "noopener");
    },
    startWindowInteraction: async () => {},
    updateWindowInteraction: async () => {},
    endWindowInteraction: async () => {},
    minimizeWindow: async () => {},
    closeWindow: async () => {},
  };
}

export async function connectApi(): Promise<DesktopApi> {
  if (window.pywebview?.api) return desktopApi(window.pywebview.api);
  if (import.meta.env.DEV) return browserMock();
  await new Promise<void>((resolve) => {
    // WebView2 can take a few seconds to inject the native bridge on a cold
    // start. Keep the loading view alive long enough to avoid falling back to
    // browser preview mode inside the packaged application.
    const timeout = window.setTimeout(resolve, 5_000);
    window.addEventListener(
      "pywebviewready",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
  return window.pywebview?.api ? desktopApi(window.pywebview.api) : browserMock();
}
