import type { ServiceStatus } from "../types";

const DOT_CLASS: Record<ServiceStatus, string> = {
  stopped: "dot dot-stopped",
  starting: "dot dot-warning",
  stopping: "dot dot-warning",
  running: "dot dot-running",
  crashed: "dot dot-crashed",
};

const PILL_CLASS: Record<ServiceStatus, string> = {
  stopped: "status-pill status-pill-stopped",
  starting: "status-pill status-pill-warning",
  stopping: "status-pill status-pill-warning",
  running: "status-pill status-pill-running",
  crashed: "status-pill status-pill-crashed",
};

const LABEL: Record<ServiceStatus, string> = {
  stopped: "Idle",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  crashed: "Crashed",
};

export function statusDotClass(status: ServiceStatus): string {
  return DOT_CLASS[status];
}

export function statusPillClass(status: ServiceStatus): string {
  return PILL_CLASS[status];
}

export function statusLabel(status: ServiceStatus): string {
  return LABEL[status];
}
