mod config;
mod pty;
mod tray;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Single instance MUST be registered before any plugin/window setup
        // so the second-launch path returns immediately without doing
        // anything else. The callback runs in the existing instance and
        // brings the main window back to the user.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(pty::PtyRegistry::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_kill_all,
            config::config_load,
            config::config_save,
        ])
        .setup(|app| {
            tray::install(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close-to-tray: intercept the user clicking the X and hide the
            // window instead of letting Tauri close it. The tray "Quit" menu
            // is the only path that actually exits.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building dashy");

    app.run(|app_handle, event| {
        // When the user picks Quit from the tray (or anything else triggers
        // app.exit), kill every child shell first so we don't orphan any
        // dev servers / processes the user spawned through Dashy.
        if let RunEvent::ExitRequested { .. } = event {
            let registry = app_handle.state::<pty::PtyRegistry>();
            registry.kill_all();
        }
    });
}
