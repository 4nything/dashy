#!/usr/bin/env bash
# Dashy on Ubuntu: Tauri's system libraries, Node and Rust from Ubuntu's own repositories, a
# release build, and the .deb it makes installed (it appears in the application menu). Run from
# this folder, as your user (it asks for sudo for apt only):
#
#     ./instalar.sh
#
# Re-running it rebuilds and reinstalls: that is how you update. The first build takes minutes.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }
cd "$here"

[ "$(id -u)" != 0 ] || { echo "Corrélo como tu usuario, no con sudo: pide sudo solo para apt." >&2; exit 1; }
command -v apt-get >/dev/null || { echo "Este instalador es para Ubuntu/Debian (apt)." >&2; exit 1; }

step "Librerías de Tauri, Node y Rust (apt)"
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev \
  libsoup-3.0-dev libjavascriptcoregtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev \
  nodejs npm cargo rustc

# Ubuntu's Node first: an old one from snap (/snap/bin) would otherwise win and Vite 6 needs 20+.
export PATH=/usr/bin:$PATH
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  echo "Node $(node -v) es muy viejo (hace falta 20 o más)." >&2
  exit 1
fi
echo "Node $(node -v) · npm $(npm -v) · $(rustc --version)"

step "Dependencias del frontend"
npm ci --no-audit --no-fund

step "Compilando (release; la primera vez tarda)"
npm run tauri build -- --bundles deb

step "Instalando el .deb"
deb="$(ls -t "$here"/src-tauri/target/release/bundle/deb/*.deb | head -1)"
sudo apt-get install -y "$deb"

printf '\n\033[32mListo.\033[0m Dashy está en el menú de aplicaciones, o: dashy\n'
echo "Si Dashy no aparece en la bandeja: GNOME necesita la extensión AppIndicator (Ubuntu la trae activa)."
