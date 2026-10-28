import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface SpawnRequest {
  ptyId: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export function newPtyId(): string {
  return crypto.randomUUID();
}

export async function ptySpawn(req: SpawnRequest): Promise<void> {
  // Tauri serde maps camelCase JS to snake_case Rust; we just rename
  // ptyId → pty_id explicitly in the payload to match SpawnRequest.
  await invoke("pty_spawn", {
    req: {
      pty_id: req.ptyId,
      command: req.command,
      args: req.args,
      cwd: req.cwd,
      env: req.env,
      cols: req.cols,
      rows: req.rows,
    },
  });
}

export function ptyWrite(ptyId: string, data: string): Promise<void> {
  return invoke("pty_write", { ptyId, data });
}

export function ptyResize(ptyId: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { ptyId, cols, rows });
}

export function ptyKill(ptyId: string): Promise<void> {
  return invoke("pty_kill", { ptyId });
}

/**
 * Kill every shell the backend still tracks. Only safe to call before any
 * pane exists — see pty_kill_all on the Rust side.
 */
export function ptyKillAll(): Promise<void> {
  return invoke("pty_kill_all");
}

export function onPtyData(ptyId: string, handler: (chunk: string) => void): Promise<UnlistenFn> {
  return listen<string>(`pty:${ptyId}:data`, (e) => handler(e.payload));
}

export function onPtyExit(ptyId: string, handler: (exitCode: number) => void): Promise<UnlistenFn> {
  return listen<number>(`pty:${ptyId}:exit`, (e) => handler(e.payload));
}
