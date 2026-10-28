// PTY-backed process registry.
//
// The frontend pre-generates a UUID, subscribes to `pty:<id>:data` /
// `pty:<id>:exit`, then calls `pty_spawn` with that id. This guarantees no
// output is dropped between spawn and listener wiring.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct PtyRegistry {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child_killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}

impl PtyRegistry {
    /// Kill every tracked child. Called on app exit so that spawned shells
    /// (and whatever the user started inside them) don't outlive Dashy.
    pub fn kill_all(&self) {
        let mut sessions = self.sessions.lock();
        for (_, mut session) in sessions.drain() {
            let _ = session.child_killer.kill();
        }
    }
}

/// Kill every tracked shell. Called by the frontend the moment it boots:
/// a fresh page owns no panes, so anything still in the registry is left
/// over from a previous page load (a dev hot-reload, a webview refresh) and
/// is unreachable from the UI. Leaking those is how you end up with a pile
/// of invisible cmd.exe processes.
#[tauri::command]
pub fn pty_kill_all(registry: State<'_, PtyRegistry>) -> Result<(), String> {
    registry.kill_all();
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct SpawnRequest {
    /// Frontend-generated UUID. Lets the JS side subscribe to
    /// `pty:<id>:data` / `pty:<id>:exit` BEFORE calling pty_spawn,
    /// so the first bytes (e.g. cmd.exe banner) aren't dropped on
    /// the floor before the listener is wired.
    pub pty_id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
}

fn default_cols() -> u16 { 120 }
fn default_rows() -> u16 { 32 }

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    registry: State<'_, PtyRegistry>,
    req: SpawnRequest,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: req.rows,
            cols: req.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&req.command);
    cmd.args(&req.args);
    cmd.cwd(&req.cwd);
    for (k, v) in &req.env {
        cmd.env(k, v);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;
    let killer = child.clone_killer();

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let pty_id = req.pty_id;
    let id_for_thread = pty_id.clone();
    let app_for_thread = app.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_for_thread.emit(&format!("pty:{}:data", id_for_thread), chunk);
                }
                Err(_) => break,
            }
        }
        let exit = child.wait().ok().map(|s| s.exit_code()).unwrap_or(0);
        let _ = app_for_thread.emit(&format!("pty:{}:exit", id_for_thread), exit);
    });

    registry.sessions.lock().insert(
        pty_id,
        PtySession {
            master: pair.master,
            writer,
            child_killer: killer,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn pty_write(
    registry: State<'_, PtyRegistry>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = registry.sessions.lock();
    let session = sessions.get_mut(&pty_id).ok_or("pty not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    registry: State<'_, PtyRegistry>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = registry.sessions.lock();
    let session = sessions.get(&pty_id).ok_or("pty not found")?;
    session
        .master
        .resize(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(
    registry: State<'_, PtyRegistry>,
    pty_id: String,
) -> Result<(), String> {
    let mut sessions = registry.sessions.lock();
    if let Some(mut session) = sessions.remove(&pty_id) {
        let _ = session.child_killer.kill();
    }
    Ok(())
}
