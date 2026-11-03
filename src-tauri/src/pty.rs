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
    /// The shell's own pid, kept so we can reach its descendants. None if
    /// the platform wouldn't tell us.
    pid: Option<u32>,
}

/// Kill a shell *and everything it started*.
///
/// `child_killer` only reaches the shell itself. Anything it launched -- a
/// `cargo run`, an `npm run dev` and whatever those spawned in turn -- is a
/// grandchild, and Windows does not cascade kills, so those keep running
/// with nothing attached to them. That is how a Stop can look like it did
/// nothing at all while the server is still serving.
///
/// `taskkill /T` walks the tree; `/F` makes it unconditional. Shelling out
/// is coarser than assigning the shell to a job object at spawn time (a job
/// would be atomic, and would catch a child spawned during the kill), but it
/// needs no new dependency and no unsafe. Worth revisiting if a process ever
/// escapes it.
fn kill_tree(pid: Option<u32>) {
    #[cfg(windows)]
    if let Some(pid) = pid {
        use std::os::windows::process::CommandExt;
        /// Without this the kill flashes a console window on screen.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(unix)]
    if let Some(pid) = pid {
        // Deepest first, so a parent can't start another child while its
        // children are being taken out. SIGKILL, like taskkill's /F.
        for p in descendants(pid).into_iter().rev() {
            unsafe {
                libc::kill(p, libc::SIGKILL);
            }
        }
    }
}

/// Every process under `root`, parents before children, from /proc.
///
/// A child that already lost its parent (daemonized, or reparented to init
/// when the shell died) is not found; Ctrl+C and the shell's own hangup cover
/// the ordinary dev-server case, this covers what they leave running.
#[cfg(unix)]
fn descendants(root: u32) -> Vec<i32> {
    let mut children: HashMap<i32, Vec<i32>> = HashMap::new();
    if let Ok(dir) = std::fs::read_dir("/proc") {
        for entry in dir.flatten() {
            let Some(pid) = entry.file_name().to_str().and_then(|n| n.parse::<i32>().ok()) else {
                continue;
            };
            let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else {
                continue;
            };
            // "pid (comm) state ppid ...": comm may hold spaces and
            // parentheses, so the fields start after the *last* ')'.
            let Some(rest) = stat.rfind(')').map(|i| &stat[i + 1..]) else {
                continue;
            };
            let ppid = rest.split_whitespace().nth(1).and_then(|f| f.parse::<i32>().ok());
            if let Some(ppid) = ppid {
                children.entry(ppid).or_default().push(pid);
            }
        }
    }
    let mut found = Vec::new();
    let mut queue = vec![root as i32];
    while let Some(parent) = queue.pop() {
        for &child in children.get(&parent).into_iter().flatten() {
            found.push(child);
            queue.push(child);
        }
    }
    found
}

impl PtyRegistry {
    /// Kill every tracked child. Called on app exit so that spawned shells
    /// (and whatever the user started inside them) don't outlive Dashy.
    pub fn kill_all(&self) {
        let mut sessions = self.sessions.lock();
        for (_, mut session) in sessions.drain() {
            kill_tree(session.pid);
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

    // An empty command asks for the user's own shell: $SHELL, or bash. The
    // frontend sends "cmd" on Windows and leaves this to the backend elsewhere.
    let program = if req.command.is_empty() { default_shell() } else { req.command.clone() };
    let mut cmd = CommandBuilder::new(&program);
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
    let pid = child.process_id();

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
            pid,
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
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
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

/// The shell the user logs in with, as the terminal emulators do.
fn default_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/bash".into())
}

/// Is something other than the shell holding the terminal?
///
/// The terminal knows which process group is in the foreground: the shell's
/// own while it waits at a prompt, the job's while a command runs. That
/// answers "busy?" without reading the screen for a prompt, which only
/// works for prompts we can recognise.
#[cfg(unix)]
fn foreground_busy(master: &dyn MasterPty, shell_pid: Option<u32>) -> Option<bool> {
    let shell = shell_pid? as i32;
    let foreground = master.process_group_leader()?;
    Some(foreground != shell)
}

#[tauri::command]
pub fn pty_busy(registry: State<'_, PtyRegistry>, pty_id: String) -> Result<bool, String> {
    #[cfg(unix)]
    {
        let sessions = registry.sessions.lock();
        let session = sessions.get(&pty_id).ok_or("pty not found")?;
        foreground_busy(session.master.as_ref(), session.pid)
            .ok_or_else(|| "foreground process unknown".to_string())
    }
    #[cfg(not(unix))]
    {
        let _ = (registry, pty_id);
        Err("pty_busy is only available on Unix".into())
    }
}

#[tauri::command]
pub fn pty_kill(
    registry: State<'_, PtyRegistry>,
    pty_id: String,
) -> Result<(), String> {
    let mut sessions = registry.sessions.lock();
    if let Some(mut session) = sessions.remove(&pty_id) {
        kill_tree(session.pid);
        let _ = session.child_killer.kill();
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::Read;
    use std::time::{Duration, Instant};

    fn alive(pid: i32) -> bool {
        // A killed child stays a zombie until its parent reaps it.
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .map(|s| !s.rsplit(')').next().unwrap_or("").trim_start().starts_with('Z'))
            .unwrap_or(false)
    }

    fn wait_until(what: &str, mut f: impl FnMut() -> bool) {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            if f() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("timed out waiting for {what}");
    }

    #[test]
    fn kill_tree_takes_out_grandchildren() {
        let mut shell = std::process::Command::new("sh")
            .args(["-c", "sleep 300 & sleep 300 & wait"])
            .spawn()
            .unwrap();
        let shell_pid = shell.id();
        wait_until("two sleeps under the shell", || descendants(shell_pid).len() >= 2);
        let kids = descendants(shell_pid);

        kill_tree(Some(shell_pid));
        let _ = shell.kill();
        let _ = shell.wait();

        wait_until("the grandchildren to die", || kids.iter().all(|&p| !alive(p)));
    }

    #[test]
    fn descendants_of_a_leaf_is_empty() {
        let mut leaf = std::process::Command::new("sleep").arg("300").spawn().unwrap();
        assert!(descendants(leaf.id()).is_empty());
        let _ = leaf.kill();
        let _ = leaf.wait();
    }

    #[test]
    fn foreground_busy_follows_the_job_not_the_prompt() {
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        // --norc: the prompt is whatever it is; it must not matter.
        let mut cmd = CommandBuilder::new("bash");
        cmd.args(["--norc", "-i"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        let pid = child.process_id();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            while reader.read(&mut buf).map(|n| n > 0).unwrap_or(false) {}
        });

        wait_until("bash at its prompt", || foreground_busy(pair.master.as_ref(), pid) == Some(false));

        writer.write_all(b"sleep 300\n").unwrap();
        wait_until("sleep in the foreground", || foreground_busy(pair.master.as_ref(), pid) == Some(true));

        writer.write_all(&[0x03]).unwrap(); // Ctrl+C, as the Stop button sends it
        wait_until("bash back at its prompt", || foreground_busy(pair.master.as_ref(), pid) == Some(false));

        let _ = child.kill();
    }
}
