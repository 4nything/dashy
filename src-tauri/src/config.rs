// Persistence for the user's apps + services.
//
// Stored as JSON in `<app_data_dir>/dashy/config.json`. Writes go to a sibling
// `.tmp` file first and are then atomically renamed, so a crash mid-write
// can't corrupt the live file.
//
// Runtime-only fields (status, pty id) live in the frontend store and are
// NOT serialized — when the file is reloaded everything starts as `stopped`
// with no PTY attached.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedConfig {
    #[serde(default)]
    pub apps: Vec<PersistedApp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedApp {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub services: Vec<PersistedService>,
    #[serde(default)]
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedService {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
pub fn config_load(app: AppHandle) -> Result<PersistedConfig, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(PersistedConfig::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("config parse error: {e}"))
}

#[tauri::command]
pub fn config_save(app: AppHandle, config: PersistedConfig) -> Result<(), String> {
    let path = config_path(&app)?;
    let serialized = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;

    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serialized).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}
