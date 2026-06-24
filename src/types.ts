export type ServiceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "crashed";

export interface Service {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  status: ServiceStatus;
  ptyId: string | null;
}

export interface AppGroup {
  id: string;
  name: string;
  services: Service[];
  collapsed?: boolean;
}

export interface DashyConfig {
  apps: AppGroup[];
}
