import { invoke } from "@tauri-apps/api/core";

export interface PersistedService {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface PersistedApp {
  id: string;
  name: string;
  services: PersistedService[];
  collapsed: boolean;
}

export interface PersistedConfig {
  apps: PersistedApp[];
}

export function configLoad(): Promise<PersistedConfig> {
  return invoke<PersistedConfig>("config_load");
}

export function configSave(config: PersistedConfig): Promise<void> {
  return invoke("config_save", { config });
}
