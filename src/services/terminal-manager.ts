import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  newPtyId,
  onPtyData,
  onPtyExit,
  ptyResize,
  ptySpawn,
  ptyWrite,
} from "./pty";

// Per-service xterm + persistent shell. Selecting a service auto-spawns a
// `cmd` PTY rooted at the service's cwd; the user can then type commands
// freely (install deps, inspect git, etc.) and clicking Start types the
// configured command into that same shell. Stop sends Ctrl+C — the shell
// stays alive for further use.
interface ServiceTerminal {
  term: Terminal;
  fit: FitAddon;
  shellPtyId: string | null;
  unlistenData?: UnlistenFn;
  unlistenExit?: UnlistenFn;
  inputDisposer?: { dispose(): void };
  resizeDisposer?: { dispose(): void };
  onShellExit: ((code: number) => void) | null;
}

const cache = new Map<string, ServiceTerminal>();

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
    stashEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(stashEl);
  }
  return stashEl;
}

let visibleServiceId: string | null = null;

function makeTerminal(): ServiceTerminal {
  const term = new Terminal({
    fontFamily:
      '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.3,
    cursorBlink: true,
    allowProposedApi: true,
    theme: {
      background: "#0c0e14",
      foreground: "#e8eaf2",
      cursor: "#8b5cf6",
      cursorAccent: "#0c0e14",
      selectionBackground: "rgba(139, 92, 246, 0.3)",
      black: "#1a1d29",
      red: "#ef4444",
      green: "#10b981",
      yellow: "#f59e0b",
      blue: "#60a5fa",
      magenta: "#a78bfa",
      cyan: "#22d3ee",
      white: "#cbd0e0",
      brightBlack: "#54596b",
      brightRed: "#f87171",
      brightGreen: "#34d399",
      brightYellow: "#fbbf24",
      brightBlue: "#93c5fd",
      brightMagenta: "#c4b5fd",
      brightCyan: "#67e8f9",
      brightWhite: "#e8eaf2",
    },
    scrollback: 5000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  return {
    term,
    fit,
    shellPtyId: null,
    onShellExit: null,
  };
}

export function getServiceTerminal(serviceId: string): ServiceTerminal {
  let entry = cache.get(serviceId);
  if (!entry) {
    entry = makeTerminal();
    cache.set(serviceId, entry);
  }
  return entry;
}

export function attachToHost(serviceId: string, host: HTMLDivElement): void {
  const entry = getServiceTerminal(serviceId);

  if (visibleServiceId && visibleServiceId !== serviceId) {
    const prev = cache.get(visibleServiceId);
    if (prev?.term.element) {
      getStash().appendChild(prev.term.element);
    }
  }

  if (!entry.term.element) {
    entry.term.open(host);
  } else if (entry.term.element.parentElement !== host) {
    host.appendChild(entry.term.element);
  }

  visibleServiceId = serviceId;

  requestAnimationFrame(() => {
    try {
      entry.fit.fit();
      entry.term.refresh(0, entry.term.rows - 1);
      entry.term.focus();
    } catch {
      // ignore
    }
  });
}

export function parkVisible(): void {
  if (!visibleServiceId) return;
  const entry = cache.get(visibleServiceId);
  if (entry?.term.element) {
    getStash().appendChild(entry.term.element);
  }
  visibleServiceId = null;
}

export function refitVisible(): void {
  if (!visibleServiceId) return;
  const entry = cache.get(visibleServiceId);
  if (!entry) return;
  try {
    entry.fit.fit();
    entry.term.refresh(0, entry.term.rows - 1);
  } catch {
    // ignore
  }
}

// ── Shell lifecycle ────────────────────────────────────────────────────────

function shellCommand(): { command: string; args: string[] } {
  // Windows-only for now. cmd.exe is universally available; PowerShell
  // could be a per-service preference later.
  return { command: "cmd", args: [] };
}

/**
 * Spawn the persistent cmd shell for `serviceId` if it isn't already running.
 * Idempotent — calling twice is a no-op once a shell is up.
 */
export async function ensureShell(
  serviceId: string,
  cwd: string,
  env: Record<string, string>,
  onShellExit: (code: number) => void,
): Promise<string> {
  const entry = getServiceTerminal(serviceId);
  if (entry.shellPtyId) return entry.shellPtyId;

  // Tear down any stale bindings before opening a new shell.
  entry.unlistenData?.();
  entry.unlistenExit?.();
  entry.inputDisposer?.dispose();
  entry.resizeDisposer?.dispose();

  const ptyId = newPtyId();
  entry.onShellExit = onShellExit;

  entry.inputDisposer = entry.term.onData((data) => {
    if (entry.shellPtyId) ptyWrite(entry.shellPtyId, data).catch(() => {});
  });
  entry.resizeDisposer = entry.term.onResize(({ cols, rows }) => {
    if (entry.shellPtyId) ptyResize(entry.shellPtyId, cols, rows).catch(() => {});
  });

  // CRITICAL: subscribe to data + exit before invoking spawn; the Rust
  // reader thread starts streaming the cmd banner as soon as the child
  // exists, and missed bytes can't be replayed.
  entry.unlistenData = await onPtyData(ptyId, (chunk) => entry.term.write(chunk));
  entry.unlistenExit = await onPtyExit(ptyId, (code) => {
    entry.shellPtyId = null;
    entry.unlistenData?.();
    entry.unlistenExit?.();
    entry.unlistenData = undefined;
    entry.unlistenExit = undefined;
    const cb = entry.onShellExit;
    entry.onShellExit = null;
    cb?.(code);
  });

  entry.shellPtyId = ptyId;

  const { command, args } = shellCommand();
  await ptySpawn({
    ptyId,
    command,
    args,
    cwd,
    env,
    cols: entry.term.cols || 120,
    rows: entry.term.rows || 32,
  });

  return ptyId;
}

export function getShellPtyId(serviceId: string): string | null {
  return cache.get(serviceId)?.shellPtyId ?? null;
}

export function disposeServiceTerminal(serviceId: string): void {
  const entry = cache.get(serviceId);
  if (!entry) return;
  entry.unlistenData?.();
  entry.unlistenExit?.();
  entry.inputDisposer?.dispose();
  entry.resizeDisposer?.dispose();
  if (visibleServiceId === serviceId) visibleServiceId = null;
  entry.term.dispose();
  cache.delete(serviceId);
}
