// Imperative actions to start / stop services. Used by both the service
// panel buttons and the sidebar (per-service + per-group) controls. Lives
// outside any component so the Solid render tree stays free of side-effect
// orchestration code.
//
// Status model: "running" reflects the user's intent (they clicked Start),
// not whether a process is technically alive. We don't append markers to
// commands so the shell history stays clean — the trade-off is that a
// command finishing on its own won't auto-flip the status; the user will
// see the prompt return in the terminal and click Stop (or just hit Start
// again to re-run).

import {
  appsStore,
  findService,
  setServicePtyId,
  setServiceStatus,
} from "../stores/apps.store";
import { ptyWrite } from "./pty";
import { ensureShell } from "./terminal-manager";

function quoteIfNeeded(s: string): string {
  return s.includes(" ") ? `"${s}"` : s;
}

function buildCommandLine(command: string, args: string[]): string {
  return [quoteIfNeeded(command), ...args.map(quoteIfNeeded)].join(" ");
}

export async function startService(serviceId: string): Promise<void> {
  const svc = findService(serviceId);
  if (!svc) return;
  if (svc.status === "starting" || svc.status === "stopping") return;

  setServiceStatus(serviceId, "starting");

  try {
    const shellId = await ensureShell(serviceId, svc.cwd, svc.env, (code) => {
      setServicePtyId(serviceId, null);
      setServiceStatus(serviceId, code === 0 ? "stopped" : "crashed");
    });
    setServicePtyId(serviceId, shellId);

    const cmdLine = buildCommandLine(svc.command, svc.args);
    await ptyWrite(shellId, `${cmdLine}\r\n`);
    setServiceStatus(serviceId, "running");
  } catch (e) {
    console.error("start failed:", e);
    setServiceStatus(serviceId, "crashed");
  }
}

export async function stopService(serviceId: string): Promise<void> {
  const svc = findService(serviceId);
  if (!svc?.ptyId) return;
  if (svc.status === "stopping" || svc.status === "stopped") return;

  setServiceStatus(serviceId, "stopping");
  try {
    await ptyWrite(svc.ptyId, "\x03");
  } catch (e) {
    console.error("ctrl+c failed:", e);
    setServiceStatus(serviceId, "running");
    return;
  }

  // Brief visual feedback, then settle on "stopped". We don't poll the
  // shell — Ctrl+C is fire-and-forget; the user sees the prompt come back
  // in the terminal as the real signal.
  setTimeout(() => {
    const current = findService(serviceId);
    if (current?.status === "stopping") {
      setServiceStatus(serviceId, "stopped");
    }
  }, 400);
}

export async function startAllInGroup(appId: string): Promise<void> {
  const app = appsStore.apps.find((a) => a.id === appId);
  if (!app) return;
  await Promise.all(
    app.services
      .filter((s) => s.status === "stopped" || s.status === "crashed")
      .map((s) => startService(s.id)),
  );
}

export async function stopAllInGroup(appId: string): Promise<void> {
  const app = appsStore.apps.find((a) => a.id === appId);
  if (!app) return;
  await Promise.all(
    app.services.filter((s) => s.status === "running").map((s) => stopService(s.id)),
  );
}
