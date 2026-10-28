import { createStore } from "solid-js/store";
import { getCurrentWebview } from "@tauri-apps/api/webview";

// Layout + appearance preferences. Lives in localStorage rather than the
// Tauri config file — it's per-window chrome, not part of the user's service
// definitions.
const STORAGE_KEY = "dashy.ui";

export const SIDEBAR_MIN_WIDTH = 190;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 264;

/**
 * Text size for the whole app is the webview's own zoom, the way a real
 * terminal emulator does it: one knob that scales chrome, labels and
 * terminal together, with no per-element font plumbing. The terminal has a
 * second, independent size below for when you want it denser than the UI.
 */
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.1;

export const TERM_FONT_SIZE_MIN = 9;
export const TERM_FONT_SIZE_MAX = 22;

/**
 * Terminal font choices. Everything here is monospaced on purpose — a
 * proportional face (Inter and friends) makes every column of `ls`, every
 * table and every progress bar wander. Geist Mono is the humanist, flat-sided
 * one: closest to Inter's feel without breaking alignment. The rest are
 * already on the machine.
 */
export const TERM_FONTS: { label: string; stack: string }[] = [
  { label: "Geist Mono", stack: '"Geist Mono Variable", "Geist Mono"' },
  { label: "JetBrains Mono", stack: '"JetBrains Mono Variable", "JetBrains Mono"' },
  { label: "Cascadia Code", stack: '"Cascadia Code", "Cascadia Mono"' },
  { label: "Consolas", stack: "Consolas" },
  { label: "Lucida Console", stack: '"Lucida Console"' },
];

/** Always appended, so a missing family still lands on something fixed-width. */
const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

interface UiState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  zoom: number;
  termFontSize: number;
  /** Index into TERM_FONTS, or -1 when termFontCustom is in use. */
  termFontIndex: number;
  /** Hand-typed family name; wins over termFontIndex when non-empty. */
  termFontCustom: string;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clampWidth(px: number): number {
  return Math.round(clamp(px, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
}

const fallback: UiState = {
  sidebarCollapsed: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  zoom: 1,
  termFontSize: 13,
  termFontIndex: 0,
  termFontCustom: "",
};

function load(): UiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<UiState>;
    return {
      sidebarCollapsed: p.sidebarCollapsed ?? fallback.sidebarCollapsed,
      sidebarWidth: clampWidth(p.sidebarWidth ?? fallback.sidebarWidth),
      zoom: clamp(p.zoom ?? fallback.zoom, ZOOM_MIN, ZOOM_MAX),
      termFontSize: Math.round(
        clamp(p.termFontSize ?? fallback.termFontSize, TERM_FONT_SIZE_MIN, TERM_FONT_SIZE_MAX),
      ),
      termFontIndex:
        p.termFontIndex !== undefined && p.termFontIndex >= 0 && p.termFontIndex < TERM_FONTS.length
          ? p.termFontIndex
          : fallback.termFontIndex,
      termFontCustom: p.termFontCustom ?? fallback.termFontCustom,
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
    // Storage disabled — preferences just won't survive a restart.
  }
}

// ── Sidebar ────────────────────────────────────────────────────────────────

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

// ── Text size ──────────────────────────────────────────────────────────────

function applyZoom(z: number) {
  getCurrentWebview()
    .setZoom(z)
    .catch((e) => console.error("setZoom failed:", e));
}

export function setZoom(z: number) {
  const next = clamp(Math.round(z * 100) / 100, ZOOM_MIN, ZOOM_MAX);
  setState("zoom", next);
  applyZoom(next);
  persist();
}

export function nudgeZoom(direction: 1 | -1) {
  setZoom(state.zoom + direction * ZOOM_STEP);
}

export function resetZoom() {
  setZoom(1);
}

/** Restore the saved zoom once at startup. */
export function initZoom() {
  if (state.zoom !== 1) applyZoom(state.zoom);
}

// ── Terminal font ──────────────────────────────────────────────────────────

/** Listeners that re-apply the font to live xterm instances. */
const fontListeners = new Set<() => void>();

export function onTerminalFontChange(fn: () => void): () => void {
  fontListeners.add(fn);
  return () => fontListeners.delete(fn);
}

function notifyFontChange() {
  persist();
  for (const fn of fontListeners) fn();
}

export function terminalFontFamily(): string {
  const custom = state.termFontCustom.trim();
  if (custom) {
    const quoted = /[\s]/.test(custom) ? `"${custom}"` : custom;
    return `${quoted}, ${MONO_FALLBACK}`;
  }
  const chosen = TERM_FONTS[state.termFontIndex] ?? TERM_FONTS[0];
  return `${chosen.stack}, ${MONO_FALLBACK}`;
}

export function setTerminalFontIndex(index: number) {
  setState("termFontIndex", clamp(index, 0, TERM_FONTS.length - 1));
  setState("termFontCustom", "");
  notifyFontChange();
}

export function setTerminalFontCustom(family: string) {
  setState("termFontCustom", family);
  notifyFontChange();
}

export function setTerminalFontSize(px: number) {
  setState(
    "termFontSize",
    Math.round(clamp(px, TERM_FONT_SIZE_MIN, TERM_FONT_SIZE_MAX)),
  );
  notifyFontChange();
}

export function nudgeTerminalFontSize(direction: 1 | -1) {
  setTerminalFontSize(state.termFontSize + direction);
}
