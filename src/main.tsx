/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { ptyKillAll } from "./services/pty";
import "@xterm/xterm/css/xterm.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Before the first pane exists, any shell the backend still tracks is a
// leftover from a previous page load (dev hot-reload, webview refresh) that
// nothing in this frontend can reach. Clear them, then render — on failure,
// render anyway rather than showing a blank window.
ptyKillAll()
  .catch((e) => console.error("orphan shell cleanup failed:", e))
  .finally(() => render(() => <App />, root));
