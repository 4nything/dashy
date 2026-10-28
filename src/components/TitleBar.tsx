import { getCurrentWindow } from "@tauri-apps/api/window";
import { CornersInIcon } from "@squidlab/phosphor-solid/corners-in";
import { CornersOutIcon } from "@squidlab/phosphor-solid/corners-out";
import { MinusIcon } from "@squidlab/phosphor-solid/minus";
import { SidebarSimpleIcon } from "@squidlab/phosphor-solid/sidebar-simple";
import { StackIcon } from "@squidlab/phosphor-solid/stack";
import { XIcon } from "@squidlab/phosphor-solid/x";
import { createSignal, onCleanup, onMount } from "solid-js";
import { AppearanceMenu } from "./AppearanceMenu";
import { toggleSidebar, uiStore } from "../stores/ui.store";

const appWindow = getCurrentWindow();

/**
 * Custom window chrome. The native frame is off (`decorations: false` in
 * tauri.conf.json), so this bar is both the title bar and the drag handle —
 * `data-tauri-drag-region` moves the window and double-click maximises it.
 * Resizing from the window edges is still handled natively.
 */
export function TitleBar() {
  const [maximized, setMaximized] = createSignal(false);

  onMount(() => {
    let unlisten: (() => void) | undefined;
    appWindow.isMaximized().then(setMaximized).catch(() => {});
    appWindow
      .onResized(() => {
        appWindow.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((un) => {
        unlisten = un;
      })
      .catch(() => {});
    onCleanup(() => unlisten?.());
  });

  return (
    <div data-tauri-drag-region class="title-bar">
      <div class="flex items-center gap-2.5 pl-3 shrink-0 pointer-events-none">
        <div class="size-6 rounded-lg brand-mark grid place-items-center">
          <StackIcon size={12} weight="fill" class="text-white" />
        </div>
        <span class="text-[13px] font-semibold tracking-tight">Dashy</span>
      </div>

      {/* Spacer doubles as the drag surface. */}
      <div data-tauri-drag-region class="flex-1 h-full" />

      <div class="flex items-center gap-1 pr-1.5 shrink-0">
        <AppearanceMenu />

        <button
          type="button"
          onClick={toggleSidebar}
          title={uiStore.sidebarCollapsed ? "Show sidebar (Ctrl+B)" : "Hide sidebar (Ctrl+B)"}
          class="size-7 grid place-items-center rounded-lg btn-ghost"
        >
          <SidebarSimpleIcon size={14} weight="bold" />
        </button>

        <div class="w-px h-4 bg-[var(--color-hairline)] mx-1" />

        <button
          type="button"
          onClick={() => appWindow.minimize()}
          title="Minimize"
          class="win-btn"
        >
          <MinusIcon size={13} weight="bold" />
        </button>
        <button
          type="button"
          onClick={() => appWindow.toggleMaximize()}
          title={maximized() ? "Restore" : "Maximize"}
          class="win-btn"
        >
          {maximized() ? (
            <CornersInIcon size={13} weight="bold" />
          ) : (
            <CornersOutIcon size={13} weight="bold" />
          )}
        </button>
        <button
          type="button"
          onClick={() => appWindow.close()}
          title="Close to tray"
          class="win-btn win-btn-close"
        >
          <XIcon size={13} weight="bold" />
        </button>
      </div>
    </div>
  );
}
