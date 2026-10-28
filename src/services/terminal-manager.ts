import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  onTerminalFontChange,
  terminalFontFamily,
  uiStore,
} from "../stores/ui.store";
import {
  newPtyId,
  onPtyData,
  onPtyExit,
  ptyResize,
  ptySpawn,
  ptyWrite,
} from "./pty";

// Per-pane xterm + persistent shell. Opening a service auto-spawns a `cmd`
// PTY rooted at its cwd; the user can type freely and clicking Start types
// the configured command into that same shell. Splitting a service adds
// another pane, each with its own independent shell.
//
// Beyond plumbing bytes, this module watches the stream to answer two
// questions the UI needs and the PTY can't tell us directly:
//
//   1. Is the shell busy? We can't ask cmd.exe, so we look at where the
//      cursor is sitting once output settles. Cursor parked on a prompt =
//      idle; anything else = a foreground process owns the terminal. That
//      makes a hand-typed `npm run dev` light up the status dot exactly
//      like the Start button does.
//
//   2. Did Ctrl+C hit a batch wrapper? npm/ng/yarn are .cmd shims, so cmd
//      answers Ctrl+C with "Terminate batch job (Y/N)?" and waits. We reply
//      for the user instead of making them press Ctrl+C twice.

export type ShellActivity = "idle" | "busy";

export interface PaneHooks {
  onActivity?: (activity: ShellActivity) => void;
  /** Fired when the user submits a command line by hand. */
  onCommand?: (command: string) => void;
  onExit?: (code: number) => void;
  /**
   * Someone typed into a pane whose shell was never opened. Wired by
   * service-runner, which is the layer that knows the service's cwd and env.
   */
  onNeedShell?: () => void;
}

/**
 * A cmd.exe / PowerShell prompt anchored at the start of the cursor line.
 * Deliberately a prefix match: `C:\proj>npm run d` is still "sitting at a
 * prompt, mid-typing", which is what keeps half-typed commands from being
 * mistaken for a running process.
 */
const PROMPT_RE = /^(?:PS\s+)?[A-Za-z]:\\[^\n>]*>/;

/**
 * The batch-job question. The wording is localized (EN "Terminate batch job
 * (Y/N)?", ES "(S/N)", DE "(J/N)", FR "(O/N)") but the shape isn't, and the
 * affirmative is always the first letter — so we echo back whatever it is
 * rather than hardcoding "Y".
 */
const BATCH_PROMPT_RE = /\(\s*([A-Za-z])\s*\/\s*([A-Za-z])\s*\)\s*\?/;

/** How long output must be quiet before we re-read the cursor line. */
const SETTLE_MS = 130;
/**
 * A chatty process (a dev server logging every few ms) would defer the
 * settle check forever, so we force one at least this often. Without it,
 * the noisiest processes — exactly the ones worth showing as running —
 * would never flip the status.
 */
const MAX_SETTLE_DEFER_MS = 500;
/** How long after a Ctrl+C we keep watching for the batch-job question. */
const STOP_WINDOW_MS = 10_000;
/** Only the tail of the stream can contain a live prompt. */
const TAIL_LIMIT = 400;

interface PaneTerminal {
  term: Terminal;
  fit: FitAddon;
  shellPtyId: string | null;
  unlistenData?: UnlistenFn;
  unlistenExit?: UnlistenFn;
  inputDisposer?: { dispose(): void };
  resizeDisposer?: { dispose(): void };
  hooks: PaneHooks;
  activity: ShellActivity;
  lastCommand: string | null;
  /**
   * Keystrokes typed before the shell finished coming up. Replayed once it's
   * there, so a fast `npm run dev` into a cold pane doesn't lose its first
   * few characters.
   */
  pendingInput: string;
  /**
   * True from the moment a spawn starts until the PTY is actually up. The
   * pty id is assigned before the spawn round-trip finishes, so this — not
   * shellPtyId — is what says whether input can be written yet.
   */
  spawning: boolean;
  /** Element currently hosting the xterm, or null while parked offscreen. */
  host: HTMLElement | null;
  /** Viewport line to restore after re-mounting; see restoreScroll(). */
  savedViewportY: number;
  savedAtBottom: boolean;
  settleTimer?: number;
  /** Epoch ms of the first output in the current un-settled burst; 0 when idle. */
  settlePendingSince: number;
  /** Epoch ms until which a Ctrl+C reply is expected; 0 when not stopping. */
  stopDeadline: number;
  /** Rolling plain-text tail of recent output, used for prompt matching. */
  tail: string;
  idleWaiters: Set<() => void>;
}

const cache = new Map<string, PaneTerminal>();

// Terminals are never destroyed on navigation — they're moved into a hidden
// stash so scrollback and the live shell survive switching services.
let stashEl: HTMLDivElement | null = null;
function getStash(): HTMLDivElement {
  if (!stashEl) {
    stashEl = document.createElement("div");
    stashEl.style.position = "fixed";
    stashEl.style.left = "-99999px";
    stashEl.style.top = "0";
    stashEl.style.width = "1200px";
    stashEl.style.height = "800px";
    stashEl.style.overflow = "hidden";
    stashEl.style.pointerEvents = "none";
    // Parked terminals keep their DOM (scrollback + live shell survive a view
    // switch) but stop rendering — see .terminal-stash in index.css. Offscreen
    // is not the same as not painted: without this, every service you've ever
    // opened goes on costing frames for the rest of the session.
    stashEl.className = "terminal-stash";
    stashEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(stashEl);
  }
  return stashEl;
}

function makeTerminal(paneId: string): PaneTerminal {
  const term = new Terminal({
    fontFamily: terminalFontFamily(),
    fontSize: uiStore.termFontSize,
    lineHeight: 1.35,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    allowProposedApi: true,
    // Opaque on purpose. A translucent terminal has to be composited against
    // everything painted behind it on every frame of output — with a few panes
    // streaming logs that was the single biggest GPU cost in the app. The
    // frame underneath paints --color-term-bg, the same colour.
    allowTransparency: false,
    theme: {
      background: "#0a0c14",
      foreground: "#e7eaf6",
      cursor: "#a78bfa",
      cursorAccent: "#0b0d15",
      selectionBackground: "rgba(139, 92, 246, 0.32)",
      black: "#1a1d29",
      red: "#ff6b6b",
      green: "#3ddc97",
      yellow: "#ffc857",
      blue: "#6fb1fc",
      magenta: "#b18cff",
      cyan: "#4fe3d7",
      white: "#cbd0e0",
      brightBlack: "#5b6079",
      brightRed: "#ff8f8f",
      brightGreen: "#5ef0b0",
      brightYellow: "#ffd77a",
      brightBlue: "#9ccbff",
      brightMagenta: "#cbb2ff",
      brightCyan: "#7ff5eb",
      brightWhite: "#f2f4ff",
    },
    scrollback: 5000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);

  const entry: PaneTerminal = {
    term,
    fit,
    shellPtyId: null,
    hooks: {},
    activity: "idle",
    lastCommand: null,
    pendingInput: "",
    spawning: false,
    host: null,
    savedViewportY: 0,
    savedAtBottom: true,
    settlePendingSince: 0,
    stopDeadline: 0,
    tail: "",
    idleWaiters: new Set(),
  };

  // Wired once for the life of the pane, deliberately not inside ensureShell:
  // a pane with no shell still has to notice the first keystroke, because
  // that keystroke is what opens the shell.
  entry.inputDisposer = term.onData((data) => handleInput(entry, paneId, data));

  // No shell until it's asked for, so say so — an empty black rectangle
  // doesn't explain itself. Written into the buffer rather than overlaid, so
  // it scrolls away above the shell's own banner like any other output.
  term.write("\x1b[2m  Type here, or hit Start, to open a shell.\x1b[0m\r\n\r\n");

  return entry;
}

/**
 * Re-apply the user's font choice to every live pane. Writing fontFamily or
 * fontSize makes xterm re-measure its cell grid, so each pane needs a refit
 * afterwards or it keeps rendering on the old geometry.
 */
function applyFontToAll(): void {
  const family = terminalFontFamily();
  for (const [paneId, entry] of cache) {
    entry.term.options.fontFamily = family;
    entry.term.options.fontSize = uiStore.termFontSize;
    refitPane(paneId);
  }
}

onTerminalFontChange(applyFontToAll);

export function getPaneTerminal(paneId: string): PaneTerminal {
  let entry = cache.get(paneId);
  if (!entry) {
    entry = makeTerminal(paneId);
    cache.set(paneId, entry);
  }
  return entry;
}

export function setPaneHooks(paneId: string, hooks: PaneHooks): void {
  getPaneTerminal(paneId).hooks = hooks;
}

// ── Mounting ───────────────────────────────────────────────────────────────

export function isAtBottom(paneId: string): boolean {
  const entry = cache.get(paneId);
  if (!entry) return true;
  const buf = entry.term.buffer.active;
  return buf.viewportY >= buf.baseY;
}

/**
 * Moving an element between parents resets `scrollTop` on everything
 * scrollable inside it, which leaves xterm's viewport out of sync with its
 * buffer: the right text is on screen, but the scrollbar sits at the top
 * and the wheel scrolls from the wrong place. Bouncing the scroll position
 * makes xterm re-emit onScroll, which re-syncs the DOM to the buffer.
 */
function restoreScroll(entry: PaneTerminal): void {
  const buf = entry.term.buffer.active;
  const target = entry.savedAtBottom
    ? buf.baseY
    : Math.min(Math.max(entry.savedViewportY, 0), buf.baseY);

  entry.term.scrollToTop();
  if (target > 0) entry.term.scrollToLine(target);
}

export function attachPane(paneId: string, host: HTMLElement): void {
  const entry = getPaneTerminal(paneId);

  if (!entry.term.element) {
    entry.term.open(host);
  } else if (entry.term.element.parentElement !== host) {
    host.appendChild(entry.term.element);
  }
  entry.host = host;

  requestAnimationFrame(() => {
    refitPane(paneId);
    restoreScroll(entry);
  });
}

/**
 * Park a pane's terminal offscreen. `host` is the element the caller thinks
 * it owns — if another view has already adopted the terminal (switching to
 * the grid can mount the new host before the old one tears down), this is a
 * no-op instead of yanking the terminal out of the live view.
 */
export function detachPane(paneId: string, host?: HTMLElement): void {
  const entry = cache.get(paneId);
  if (!entry) return;
  if (host && entry.host !== host) return;
  const buf = entry.term.buffer.active;
  entry.savedViewportY = buf.viewportY;
  entry.savedAtBottom = buf.viewportY >= buf.baseY;
  if (entry.term.element) getStash().appendChild(entry.term.element);
  entry.host = null;
}

export function refitPane(paneId: string): void {
  const entry = cache.get(paneId);
  // Skip parked terminals — they'd fit themselves to the stash's fake size.
  if (!entry?.host) return;
  try {
    entry.fit.fit();
    entry.term.refresh(0, entry.term.rows - 1);
  } catch {
    // Host not laid out yet; the next resize tick will catch it.
  }
}

export function focusPane(paneId: string): void {
  cache.get(paneId)?.term.focus();
}

// ── Activity detection ─────────────────────────────────────────────────────

/**
 * The whole logical line the cursor sits on, re-joined across soft wraps.
 * Without the un-wrapping a long command would push the cursor onto a
 * continuation row, the prompt would fall off the front of it, and we'd
 * mistake "still typing" for "a process is running".
 */
function cursorLine(entry: PaneTerminal): string {
  const buf = entry.term.buffer.active;
  const cursorRow = buf.baseY + buf.cursorY;

  let start = cursorRow;
  while (start > 0 && buf.getLine(start)?.isWrapped) start -= 1;

  let text = "";
  for (let row = start; row <= cursorRow; row++) {
    const line = buf.getLine(row);
    if (!line) break;
    // Interior rows of a wrap are full-width, so only the last one is
    // worth trimming.
    text += line.translateToString(row === cursorRow);
  }
  return text;
}

function isAtPrompt(entry: PaneTerminal): boolean {
  return PROMPT_RE.test(cursorLine(entry));
}

function resolveIdleWaiters(entry: PaneTerminal) {
  const waiters = [...entry.idleWaiters];
  entry.idleWaiters.clear();
  for (const w of waiters) w();
}

function runSettle(entry: PaneTerminal) {
  if (entry.settleTimer !== undefined) {
    clearTimeout(entry.settleTimer);
    entry.settleTimer = undefined;
  }
  entry.settlePendingSince = 0;

  const next: ShellActivity = isAtPrompt(entry) ? "idle" : "busy";
  if (next === entry.activity) return;
  entry.activity = next;
  if (next === "idle") {
    entry.stopDeadline = 0;
    resolveIdleWaiters(entry);
  }
  entry.hooks.onActivity?.(next);
}

function scheduleSettle(entry: PaneTerminal) {
  const now = Date.now();
  if (entry.settlePendingSince === 0) entry.settlePendingSince = now;

  // Output that never stops still has to be evaluated eventually.
  if (now - entry.settlePendingSince >= MAX_SETTLE_DEFER_MS) {
    runSettle(entry);
    return;
  }

  if (entry.settleTimer !== undefined) clearTimeout(entry.settleTimer);
  entry.settleTimer = window.setTimeout(() => runSettle(entry), SETTLE_MS);
}

/** Strip escape sequences so prompt matching isn't fooled by color codes. */
function plain(chunk: string): string {
  return chunk
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "");
}

function handleOutput(entry: PaneTerminal, chunk: string) {
  entry.tail = (entry.tail + plain(chunk)).slice(-TAIL_LIMIT);

  // Only inside a stop window, so a legitimate "(y/n)" question from the
  // user's own program is never answered behind their back.
  if (entry.stopDeadline > Date.now()) {
    const match = BATCH_PROMPT_RE.exec(entry.tail);
    if (match) {
      entry.tail = "";
      const affirmative = match[1];
      if (entry.shellPtyId) {
        ptyWrite(entry.shellPtyId, `${affirmative}\r`).catch(() => {});
      }
    }
  }

  scheduleSettle(entry);
}

/** Keystrokes held while a shell comes up; a runaway buffer helps nobody. */
const PENDING_INPUT_LIMIT = 4096;

/**
 * Keystrokes from this pane's xterm. A pane whose shell isn't up yet asks
 * for one and holds what was typed until it arrives — typing into a cold
 * terminal is exactly how you open it.
 */
function handleInput(entry: PaneTerminal, paneId: string, data: string): void {
  if (!entry.shellPtyId || entry.spawning) {
    if (entry.pendingInput.length < PENDING_INPUT_LIMIT) entry.pendingInput += data;
    entry.hooks.onNeedShell?.();
    return;
  }
  // Read the command off the screen rather than accumulating keystrokes —
  // that way history recall (↑) and clipboard pastes are captured too.
  if (data.includes("\r")) {
    const cmd = pendingCommand(entry);
    if (cmd) {
      entry.lastCommand = cmd;
      entry.hooks.onCommand?.(cmd);
    }
  }
  // A hand-typed Ctrl+C deserves the same batch-prompt handling as the
  // Stop button, otherwise the user is back to answering Y themselves.
  if (data.includes("\x03")) beginStopWindow(paneId);
  ptyWrite(entry.shellPtyId, data).catch(() => {});
}

/** Everything the user typed after the prompt on the current line. */
function pendingCommand(entry: PaneTerminal): string {
  const text = cursorLine(entry);
  const match = PROMPT_RE.exec(text);
  if (!match) return "";
  return text.slice(match[0].length).trim();
}

export function getActivity(paneId: string): ShellActivity {
  return cache.get(paneId)?.activity ?? "idle";
}

export function getLastCommand(paneId: string): string | null {
  return cache.get(paneId)?.lastCommand ?? null;
}

export function setLastCommand(paneId: string, command: string | null): void {
  getPaneTerminal(paneId).lastCommand = command;
}

/**
 * Arm the batch-job auto-answer. Called whenever a Ctrl+C is sent, whether
 * by the Stop button or typed by the user.
 */
export function beginStopWindow(paneId: string): void {
  const entry = getPaneTerminal(paneId);
  entry.stopDeadline = Date.now() + STOP_WINDOW_MS;
  entry.tail = "";
}

/** Resolves true once the shell is back at a prompt, false on timeout. */
export function waitForIdle(paneId: string, timeoutMs = 8000): Promise<boolean> {
  const entry = getPaneTerminal(paneId);
  if (entry.activity === "idle") return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer: number | undefined;
    const waiter = () => {
      if (timer !== undefined) clearTimeout(timer);
      resolve(true);
    };
    timer = window.setTimeout(() => {
      entry.idleWaiters.delete(waiter);
      resolve(false);
    }, timeoutMs);
    entry.idleWaiters.add(waiter);
  });
}

export function writeToPane(paneId: string, data: string): Promise<void> {
  const entry = cache.get(paneId);
  if (!entry?.shellPtyId) return Promise.resolve();
  return ptyWrite(entry.shellPtyId, data);
}

// ── Shell lifecycle ────────────────────────────────────────────────────────

function shellCommand(): { command: string; args: string[] } {
  // Windows-only for now. cmd.exe is universally available; PowerShell
  // could be a per-service preference later.
  return { command: "cmd", args: [] };
}

/**
 * Spawn the persistent cmd shell for `paneId` if it isn't already running.
 * Idempotent — calling twice is a no-op once a shell is up.
 */
export async function ensureShell(
  paneId: string,
  cwd: string,
  env: Record<string, string>,
): Promise<string> {
  const entry = getPaneTerminal(paneId);
  if (entry.shellPtyId) return entry.shellPtyId;

  // Tear down any stale bindings before opening a new shell. The input
  // handler is not one of them: it belongs to the pane, not to the shell,
  // and it's what brings a new shell up in the first place.
  entry.unlistenData?.();
  entry.unlistenExit?.();
  entry.resizeDisposer?.dispose();

  const ptyId = newPtyId();
  entry.spawning = true;

  entry.resizeDisposer = entry.term.onResize(({ cols, rows }) => {
    if (entry.shellPtyId) ptyResize(entry.shellPtyId, cols, rows).catch(() => {});
  });

  // CRITICAL: subscribe to data + exit before invoking spawn; the Rust
  // reader thread starts streaming the cmd banner as soon as the child
  // exists, and missed bytes can't be replayed.
  entry.unlistenData = await onPtyData(ptyId, (chunk) => {
    entry.term.write(chunk);
    handleOutput(entry, chunk);
  });
  entry.unlistenExit = await onPtyExit(ptyId, (code) => {
    entry.shellPtyId = null;
    entry.unlistenData?.();
    entry.unlistenExit?.();
    entry.unlistenData = undefined;
    entry.unlistenExit = undefined;
    entry.activity = "idle";
    entry.stopDeadline = 0;
    resolveIdleWaiters(entry);
    entry.hooks.onExit?.(code);
  });

  entry.shellPtyId = ptyId;

  const { command, args } = shellCommand();
  try {
    await ptySpawn({
      ptyId,
      command,
      args,
      cwd,
      env,
      cols: entry.term.cols || 120,
      rows: entry.term.rows || 32,
    });
  } catch (e) {
    // Don't leave the pane pointing at a shell that never opened — the next
    // keystroke should be free to try again.
    entry.shellPtyId = null;
    throw e;
  } finally {
    entry.spawning = false;
  }

  // Replay whatever was typed while the shell was coming up.
  if (entry.pendingInput) {
    const buffered = entry.pendingInput;
    entry.pendingInput = "";
    await ptyWrite(ptyId, buffered);
  }

  return ptyId;
}

export function getShellPtyId(paneId: string): string | null {
  return cache.get(paneId)?.shellPtyId ?? null;
}

/**
 * Forget the pane's shell while keeping its terminal — scrollback, size and
 * all. Used after a shell is force-killed: dropping the exit listener here
 * is deliberate, since the kill *is* the exit and we already know what it
 * means. It also clears the binding synchronously, so the next ensureShell
 * opens a fresh shell instead of returning the dead pty id it would still
 * be holding while the exit event made its way across the IPC boundary.
 */
export function clearPaneShell(paneId: string): void {
  const entry = cache.get(paneId);
  if (!entry) return;
  entry.unlistenData?.();
  entry.unlistenExit?.();
  entry.unlistenData = undefined;
  entry.unlistenExit = undefined;
  entry.resizeDisposer?.dispose();
  entry.resizeDisposer = undefined;
  entry.shellPtyId = null;
  entry.spawning = false;
  entry.activity = "idle";
  entry.stopDeadline = 0;
  entry.pendingInput = "";
  entry.tail = "";
  resolveIdleWaiters(entry);
}

export function disposePaneTerminal(paneId: string): void {
  const entry = cache.get(paneId);
  if (!entry) return;
  if (entry.settleTimer !== undefined) clearTimeout(entry.settleTimer);
  entry.unlistenData?.();
  entry.unlistenExit?.();
  entry.inputDisposer?.dispose();
  entry.resizeDisposer?.dispose();
  resolveIdleWaiters(entry);
  entry.term.dispose();
  cache.delete(paneId);
}
