import { ArrowClockwiseIcon } from "@squidlab/phosphor-solid/arrow-clockwise";
import { CircleNotchIcon } from "@squidlab/phosphor-solid/circle-notch";
import { ColumnsPlusRightIcon } from "@squidlab/phosphor-solid/columns-plus-right";
import { PlayIcon } from "@squidlab/phosphor-solid/play";
import { StopIcon } from "@squidlab/phosphor-solid/stop";
import { TerminalIcon } from "@squidlab/phosphor-solid/terminal";
import { Show, createEffect, createMemo } from "solid-js";
import {
  addPane,
  appsStore,
  ensureActivePane,
  findService,
  serviceStatus,
} from "../stores/apps.store";
import {
  restartService,
  restartTarget,
  startService,
  stopService,
} from "../services/service-runner";
import { statusLabel, statusPillClass, statusDotClass } from "./status";
import { TerminalSplit } from "./TerminalSplit";

export function ServicePanel() {
  const service = createMemo(() =>
    appsStore.selectedServiceId ? findService(appsStore.selectedServiceId) : undefined,
  );

  // Opening a service materialises its first terminal. Idempotent, so this
  // re-running when panes change is harmless.
  createEffect(() => {
    const svc = service();
    if (svc) ensureActivePane(svc.id);
  });

  const status = createMemo(() => {
    const svc = service();
    return svc ? serviceStatus(svc) : "stopped";
  });

  const activePaneId = createMemo(() => service()?.activePaneId ?? null);

  return (
    <main class="flex-1 flex flex-col min-w-0 panel glass">
      <Show
        when={service()}
        fallback={
          <div class="flex-1 grid place-items-center">
            <div class="text-center">
              <div class="size-16 rounded-3xl glass-raised grid place-items-center mx-auto mb-4">
                <TerminalIcon size={28} weight="duotone" class="text-[var(--color-text-dim)]" />
              </div>
              <p class="text-sm font-medium text-[var(--color-text-dim)] mb-1">
                Select a service from the sidebar
              </p>
              <p class="text-xs text-[var(--color-text-faint)]">
                Or hit <Kbd>+</Kbd> to add a new app
              </p>
            </div>
          </div>
        }
      >
        {(svc) => (
          <>
            <header class="px-4 h-14 flex items-center justify-between gap-3 border-b border-[var(--color-border)]">
              <div class="min-w-0 flex items-center gap-3">
                <h1 class="text-[15px] font-semibold tracking-tight truncate">
                  {svc().name}
                </h1>
                <span class={statusPillClass(status())}>
                  <span
                    class={statusDotClass(status())}
                    style={{ width: "6px", height: "6px" }}
                  />
                  {statusLabel(status())}
                </span>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => startService(svc().id)}
                  class="btn-primary px-3.5 h-8 text-[13px] rounded-xl flex items-center gap-1.5"
                  disabled={status() === "starting" || status() === "stopping"}
                >
                  <Show
                    when={status() === "starting"}
                    fallback={<PlayIcon size={11} weight="fill" />}
                  >
                    <CircleNotchIcon size={11} weight="bold" class="animate-spin" />
                  </Show>
                  {status() === "starting" ? "Starting…" : "Start"}
                </button>

                <button
                  type="button"
                  onClick={() => restartService(svc().id)}
                  class="btn-secondary px-3.5 h-8 text-[13px] rounded-xl flex items-center gap-1.5"
                  disabled={status() === "starting" || status() === "stopping"}
                  title={
                    activePaneId()
                      ? `Restart: ${restartTarget(activePaneId()!) ?? "last command"}`
                      : "Restart the last command"
                  }
                >
                  <ArrowClockwiseIcon size={12} weight="bold" />
                  Restart
                </button>

                <button
                  type="button"
                  onClick={() => stopService(svc().id)}
                  class="btn-secondary px-3.5 h-8 text-[13px] rounded-xl flex items-center gap-1.5"
                  disabled={status() === "stopped" || status() === "stopping"}
                >
                  <Show
                    when={status() === "stopping"}
                    fallback={<StopIcon size={11} weight="fill" />}
                  >
                    <CircleNotchIcon size={11} weight="bold" class="animate-spin" />
                  </Show>
                  {status() === "stopping" ? "Stopping…" : "Stop"}
                </button>

                <div class="w-px h-5 bg-[var(--color-border-strong)] mx-0.5" />

                <button
                  type="button"
                  onClick={() => addPane(svc().id)}
                  title="Split terminal (Ctrl+Shift+5)"
                  class="size-8 grid place-items-center rounded-xl btn-ghost"
                >
                  <ColumnsPlusRightIcon size={15} weight="bold" />
                </button>
              </div>
            </header>

            <div class="px-4 pt-2.5 pb-1.5">
              <p class="text-[11px] text-[var(--color-text-faint)] font-mono truncate">
                <span class="text-[var(--color-text-dim)]">{svc().command}</span>{" "}
                <span>{svc().args.join(" ")}</span>
                <span class="opacity-40 mx-2">·</span>
                <span class="text-[var(--color-text-dim)]">{svc().cwd}</span>
              </p>
            </div>

            <div class="flex-1 px-4 pb-4 pt-1 overflow-hidden">
              <TerminalSplit service={svc()} />
            </div>
          </>
        )}
      </Show>
    </main>
  );
}

function Kbd(props: { children: any }) {
  return (
    <kbd class="px-1.5 py-0.5 rounded-md text-[10px] bg-[var(--color-bg-3)] border border-[var(--color-border-strong)] font-mono">
      {props.children}
    </kbd>
  );
}
