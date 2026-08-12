export type ServiceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "crashed";

/**
 * One terminal inside a service. Every service owns at least one pane;
 * splitting adds siblings that share the service's cwd/env but keep their
 * own shell, their own status and their own command history.
 *
 * Panes are runtime-only — shells don't survive an app restart, so there's
 * nothing worth persisting.
 */
export interface TerminalPane {
  id: string;
  /** 1-based, stable for the pane's lifetime. Shown in the sidebar. */
  index: number;
  status: ServiceStatus;
  ptyId: string | null;
  /** Last command line submitted here — what Restart re-runs. */
  lastCommand: string | null;
  /** Split weight; dragging a divider redistributes it between neighbours. */
  flex: number;
}

export interface Service {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  panes: TerminalPane[];
  activePaneId: string | null;
}

export interface AppGroup {
  id: string;
  name: string;
  services: Service[];
  collapsed?: boolean;
}

/**
 * A hand-picked set of services to run and watch together — e.g. api +
 * desktop + tunnel out of a project that also holds a dozen other services.
 * Opening a group tiles exactly its members side by side.
 *
 * Members are referenced by id and may come from different apps.
 */
export interface TerminalGroup {
  id: string;
  name: string;
  serviceIds: string[];
  collapsed?: boolean;
}

export interface DashyConfig {
  apps: AppGroup[];
  groups: TerminalGroup[];
}
