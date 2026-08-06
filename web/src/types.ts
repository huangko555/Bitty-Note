export interface NoteSummary {
  name: string;
  preview: string;
  modified_ms: number;
}

export interface OpenedNote {
  name: string;
  content: string;
  revision: string;
  has_bom: boolean;
  newline: "\n" | "\r\n";
}

export interface SaveResult {
  status: "saved" | "unchanged" | "conflict" | "missing";
  revision: string | null;
  external_content: string | null;
  has_bom: boolean;
  newline: "\n" | "\r\n";
}

export type AppLanguage = "en" | "zh-CN";

export interface UpdateState {
  status: "idle" | "available" | "unsupported" | "store";
  available_version: string | null;
}

export interface UpdateResult {
  status: "success" | "failed";
  version: string;
}

export interface AppConfig {
  save_dir: string;
  language: AppLanguage;
  autostart: boolean;
  always_on_top: boolean;
  window_x: number | null;
  window_y: number | null;
  window_width: number;
  window_height: number;
  last_note: string | null;
  editor_font: string;
  editor_font_size: number;
  spellcheck: boolean;
  heading_divider: boolean;
  heading_list_highlight: boolean;
  editor_highlight_color: string;
  last_update_check_ms: number | null;
  available_version: string | null;
  pending_update_version: string | null;
}

export interface BootstrapData {
  config: AppConfig;
  notes: NoteSummary[];
  system_fonts: string[];
  app_version: string;
  update_state: UpdateState;
  update_result: UpdateResult | null;
}

export interface MigrationResult {
  copied_count: number;
  recycled_count: number;
  retained_files: string[];
}
