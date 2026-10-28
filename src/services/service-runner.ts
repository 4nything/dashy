// Imperative actions to start / stop / restart what's running in a terminal
// pane. Used by the service panel header, the sidebar rows and the group
// controls. Lives outside any component so the Solid render tree stays free
// of side-effect orchestration code.
//
// Status model: a pane's status is *observed*, not assumed. terminal-manager
// watches the shell and reports idle/busy; we map that onto the status the
// UI shows. "starting" and "stopping" are the two intent states that bridge
// the gap between clicking a button and the shell actually reacting.

import {
  appsStore,
  ensureActivePane,
  findGroup,
  findPane,
  findService,
  groupServices,
  removePane,
  serviceStatus,
  setPaneLastCommand,
  setPanePtyId,
  setPaneStatus,
} from "../stores/apps.store";
import type { Service } from "../types";
import { ptyKill } from "./pty";
import {
  beginStopWindow,
  disposePaneTerminal,
  ensureShell,
  getActivity,
  getShellPtyId,
  setLastCommand,
  setPaneHooks,
  type ShellActivity,
  waitForIdle,
  writeToPane,
} from "./terminal-manager";

function quoteIfNeeded(s: string): string {
  return s.includes(" ") ? `"${s}"` : s;
}

export function buildCommandLine(command: string, args: string[]): string {
  return [quoteIfNeeded(command), ...args.map(quoteIfNeeded)].join(" ");
}

export function serviceCommandLine(svc: Service): string {
  return buildCommandLine(svc.command, svc.args);
}

/**
 * Map observed shell activity onto the pane status. This is what makes a
 * command the user typed by hand flip the dot to green — the Run button is
 * no longer the only thing that can start a "run".
 */
function applyActivity(paneId: string, activity: ShellActivity) {
  const found = findPane(paneId);
  if (!found) return;
  const status = found.pane.status;

  if (activity === "busy") {
    if (status !== "running") setPaneStatus(paneId, "running");
    return;
  }
  // While "starting", an idle report usually just means the command echo
  // hasn't landed yet. startPane reconciles that shortly after, so ignoring
  // it here avoids a Starting → Idle → Running flicker.
  if (status === "starting" || status === "stopped") return;
  setPaneStatus(paneId, "stopped");
}

/** How long a pane may sit in "starting" before we trust observed activity. */
const START_SETTLE_MS = 1200;

/**
 * Wire a pane's terminal to the store without opening anything. Shells are
 * spawned on demand — viewing a service used to cost it a `cmd` process per
 * pane, for the rest of the session, whether or not you ever typed in it.
 * After this the pane is live enough to ask for its own shell on the first
 * keystroke (onNeedShell), which is the other half of "on demand".
 */
export function preparePane(paneId: string): void {
  setPaneHooks(paneId, {
    onActivity: (activity) => applyActivity(paneId, activity),
    onCommand: (command) => setPaneLastCommand(paneId, command),
    onExit: (code) => {
      setPanePtyId(paneId, null);
      setPaneStatus(paneId, code === 0 ? "stopped" : "crashed");
    },
    onNeedShell: () => {
      ensurePaneShell(paneId).catch((e) => console.error("shell spawn failed:", e));
    },
  });
}

/**
 * Bring up (or reuse) the pane's shell. Safe to call repeatedly —
 * ensureShell is idempotent.
 */
export async function ensurePaneShell(paneId: string): Promise<string | null> {
  const found = findPane(paneId);
  if (!found) return null;
  const { service } = found;

  // A pane that was never viewed has no hooks yet, and Start can reach one
  // through the sidebar.
  preparePane(paneId);

  const ptyId = await ensureShell(paneId, service.cwd, service.env);
  setPanePtyId(paneId, ptyId);
  return ptyId;
}

// ── Pane-level actions ─────────────────────────────────────────────────────

/** Type `commandLine` (default: the service's configured command) and run it. */
export async function startPane(paneId: string, commandLine?: string): Promise<void> {
  const found = findPane(paneId);
  if (!found) return;
  if (found.pane.status === "starting" || found.pane.status === "stopping") return;

  const cmdLine = (commandLine ?? serviceCommandLine(found.service)).trim();
  if (!cmdLine) return;

  setPaneStatus(paneId, "starting");
  try {
    await ensurePaneShell(paneId);
    setPaneLastCommand(paneId, cmdLine);
    setLastCommand(paneId, cmdLine);
    await writeToPane(paneId, `${cmdLine}\r\n`);
    // From here the activity watcher takes over. It flips us to "running"
    // once the shell leaves the prompt; this reconcile catches the cases it
    // can't report — a one-shot command that already finished, or a shell
    // that was busy before we typed and so never changed state.
    settleStarting(paneId);
  } catch (e) {
    console.error("start failed:", e);
    setPaneStatus(paneId, "crashed");
  }
}

function settleStarting(paneId: string) {
  window.setTimeout(() => {
    const current = findPane(paneId);
    if (current?.pane.status !== "starting") return;
    setPaneStatus(paneId, getActivity(paneId) === "busy" ? "running" : "stopped");
  }, START_SETTLE_MS);
}

/**
 * Ctrl+C whatever is in the foreground and wait for the prompt to come
 * back. The batch-job "(Y/N)?" question is answered for us by
 * terminal-manager while the stop window is open.
 */
export async function stopPane(paneId: string): Promise<boolean> {
  const found = findPane(paneId);
  if (!found?.pane.ptyId) return true;
  if (getActivity(paneId) === "idle") {
    setPaneStatus(paneId, "stopped");
    return true;
  }

  setPaneStatus(paneId, "stopping");
  beginStopWindow(paneId);
  try {
    await writeToPane(paneId, "\x03");
  } catch (e) {
    console.error("ctrl+c failed:", e);
    setPaneStatus(paneId, "running");
    return false;
  }

  const settled = await waitForIdle(paneId);
  if (!settled) {
    // Never came back to a prompt — don't leave the UI stuck on "Stopping".
    setPaneStatus(paneId, getActivity(paneId) === "busy" ? "running" : "stopped");
  }
  return settled;
}

/**
 * Stop and re-run *this pane's last command* — not the service's configured
 * one. If you ran something else in here, that's what comes back.
 */
export async function restartPane(paneId: string): Promise<void> {
  const found = findPane(paneId);
  if (!found) return;
  const cmdLine = (found.pane.lastCommand ?? serviceCommandLine(found.service)).trim();
  if (!cmdLine) return;

  await ensurePaneShell(paneId);

  if (getActivity(paneId) === "busy") {
    const settled = await stopPane(paneId);
    if (!settled) return; // couldn't get a prompt back; don't pile on
  }

  setPaneStatus(paneId, "starting");
  setPaneLastCommand(paneId, cmdLine);
  setLastCommand(paneId, cmdLine);
  await writeToPane(paneId, `${cmdLine}\r\n`);
  settleStarting(paneId);
}

/** What Restart would re-run, for tooltips. */
export function restartTarget(paneId: string): string | null {
  const found = findPane(paneId);
  if (!found) return null;
  return (found.pane.lastCommand ?? serviceCommandLine(found.service)).trim() || null;
}

// ── Teardown ───────────────────────────────────────────────────────────────

/** Kill the pane's shell, drop its xterm, and remove it from the service. */
export async function closePane(paneId: string): Promise<void> {
  await killPaneShell(paneId);
  removePane(paneId);
}

async function killPaneShell(paneId: string): Promise<void> {
  const ptyId = getShellPtyId(paneId);
  if (ptyId) {
    try {
      await ptyKill(ptyId);
    } catch (e) {
      console.error("pty kill failed:", e);
    }
  }
  disposePaneTerminal(paneId);
}

/** Tear down every shell a service owns, without touching the store. */
export async function disposeServiceShells(serviceId: string): Promise<void> {
  const svc = findService(serviceId);
  if (!svc) return;
  await Promise.all(svc.panes.map((p) => killPaneShell(p.id)));
}

// ── Service-level actions ──────────────────────────────────────────────────

export async function startService(serviceId: string): Promise<void> {
  const paneId = ensureActivePane(serviceId);
  if (paneId) await startPane(paneId);
}

/** Stop every pane that's actually doing something. */
export async function stopService(serviceId: string): Promise<void> {
  const svc = findService(serviceId);
  if (!svc) return;
  await Promise.all(
    svc.panes
      .filter((p) => p.status !== "stopped" && p.status !== "crashed")
      .map((p) => stopPane(p.id)),
  );
}

export async function restartService(serviceId: string): Promise<void> {
  const paneId = ensureActivePane(serviceId);
  if (paneId) await restartPane(paneId);
}

// ── Custom groups ──────────────────────────────────────────────────────────
// A group is a hand-picked set of services the user runs together. These
// fan out over its members in the group's own order.

export async function startGroup(groupId: string): Promise<void> {
  const group = findGroup(groupId);
  if (!group) return;
  await Promise.all(
    groupServices(group)
      .filter((svc) => serviceStatus(svc) !== "running" && serviceStatus(svc) !== "starting")
      .map((svc) => startService(svc.id)),
  );
}

export async function stopGroup(groupId: string): Promise<void> {
  const group = findGroup(groupId);
  if (!group) return;
  await Promise.all(groupServices(group).map((svc) => stopService(svc.id)));
}

export async function restartGroup(groupId: string): Promise<void> {
  const group = findGroup(groupId);
  if (!group) return;
  await Promise.all(groupServices(group).map((svc) => restartService(svc.id)));
}

export async function startAllInGroup(appId: string): Promise<void> {
  const app = appsStore.apps.find((a) => a.id === appId);
  if (!app) return;
  await Promise.all(
    app.services
      .filter((s) => !s.panes.some((p) => p.status === "running" || p.status === "starting"))
      .map((s) => startService(s.id)),
  );
}

export async function stopAllInGroup(appId: string): Promise<void> {
  const app = appsStore.apps.find((a) => a.id === appId);
  if (!app) return;
  await Promise.all(app.services.map((s) => stopService(s.id)));
}
