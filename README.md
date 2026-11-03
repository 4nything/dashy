# Dashy

A service dashboard with grouped terminals: each service has its own shell (xterm.js over a PTY),
Start/Stop/Restart buttons, and a status that follows what the shell is really doing. Tauri 2 +
SolidJS. Windows and Linux.

## Run it (development)

    npm ci
    npm run tauri dev

## Build it

    npm run tauri build                       # Windows: NSIS and MSI
    npm run tauri build -- --bundles deb      # Linux: a .deb (no AppImage tooling needed)

### What Linux needs

Node 20 or newer (Vite 6), Rust (rustup), and Tauri's system libraries. On Ubuntu:

    sudo apt install build-essential pkg-config libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev \
      libsoup-3.0-dev libjavascriptcoregtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev

The tray icon needs an AppIndicator host: Ubuntu's GNOME has one by default. Closing the window
only hides it (to the tray); *Quit* in the tray menu exits and ends every shell.

## The shell

On Windows a service opens `cmd`; elsewhere it opens `$SHELL` (bash if unset), interactive, in the
service's folder, so aliases and tools that your `.bashrc` sets up (nvm, direnv...) are there.

How "busy" is decided differs on purpose:

- **Windows**: `cmd` can't be asked, so the screen is read: a cmd/PowerShell prompt under the
  cursor means idle.
- **Linux**: the terminal knows which process group is in the foreground (the shell's own while it
  waits, the job's while a command runs), so any prompt works. The prompt is learned from the
  cursor line the first time the shell is idle, which is how a hand-typed command is told apart
  from it.

*Stop* sends Ctrl+C; if the prompt doesn't come back it kills the shell and everything under it
(`taskkill /T` on Windows, a walk of `/proc` on Linux).

## Tests

    cd src-tauri && cargo test --lib

The PTY tests start a real `bash` on Unix.
