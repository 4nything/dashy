import { Show, createMemo, onCleanup, onMount } from "solid-js";
import { GroupView } from "./components/GroupView";
import { ServicePanel } from "./components/ServicePanel";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { addPane, appsStore, findGroup } from "./stores/apps.store";
import { initZoom, nudgeZoom, resetZoom, toggleSidebar } from "./stores/ui.store";

export default function App() {
  // The main area follows the selection: a group tiles its members, a
  // service gets the focused view with its splits.
  const selectedGroup = createMemo(() =>
    appsStore.selectedGroupId ? findGroup(appsStore.selectedGroupId) : undefined,
  );

  onMount(() => {
    initZoom();

    // Capture phase: xterm has focus most of the time and would otherwise
    // swallow these before they reach the window.
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();

      // Text size, the same keys every editor and terminal uses. `=` is the
      // unshifted +, and the numpad reports "Add"/"Subtract".
      if (!e.shiftKey && (key === "=" || key === "+" || key === "add")) {
        e.preventDefault();
        e.stopPropagation();
        nudgeZoom(1);
        return;
      }
      if (!e.shiftKey && (key === "-" || key === "subtract")) {
        e.preventDefault();
        e.stopPropagation();
        nudgeZoom(-1);
        return;
      }
      if (!e.shiftKey && key === "0") {
        e.preventDefault();
        e.stopPropagation();
        resetZoom();
        return;
      }

      if (!e.shiftKey && key === "b") {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar();
        return;
      }
      // Ctrl+Shift+5 — same split shortcut VS Code uses. `%` is what the
      // shifted 5 reports on most layouts.
      if (e.shiftKey && (key === "5" || key === "%")) {
        e.preventDefault();
        e.stopPropagation();
        const serviceId = appsStore.selectedServiceId;
        if (serviceId) addPane(serviceId);
      }
    };

    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });

  return (
    <div class="window-shell">
      <TitleBar />
      <div class="flex-1 flex min-h-0 app-shell">
        <Sidebar />
        <Show when={selectedGroup()} fallback={<ServicePanel />}>
          {(group) => <GroupView group={group()} />}
        </Show>
      </div>
    </div>
  );
}
