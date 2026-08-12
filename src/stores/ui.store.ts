import { createStore } from "solid-js/store";

// Layout preferences. Lives in localStorage rather than the Tauri config
// file — it's per-window chrome, not part of the user's service definitions.
const STORAGE_KEY = "dashy.ui";

export const SIDEBAR_MIN_WIDTH = 190;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 264;

interface UiState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
}

function clampWidth(px: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(px)));
}

function load(): UiState {
  const fallback: UiState = {
    sidebarCollapsed: false,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<UiState>;
    return {
      sidebarCollapsed: parsed.sidebarCollapsed ?? fallback.sidebarCollapsed,
      sidebarWidth: clampWidth(parsed.sidebarWidth ?? fallback.sidebarWidth),
    };
  } catch {
    return fallback;
  }
}

const [state, setState] = createStore<UiState>(load());

export const uiStore = state;

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled — layout just won't survive a restart.
  }
}

export function toggleSidebar() {
  setState("sidebarCollapsed", (c) => !c);
  persist();
}

export function setSidebarCollapsed(collapsed: boolean) {
  setState("sidebarCollapsed", collapsed);
  persist();
}

/** Called continuously while dragging; persistence is deferred to drag end. */
export function setSidebarWidth(px: number) {
  setState("sidebarWidth", clampWidth(px));
}

export function commitSidebarWidth() {
  persist();
}
