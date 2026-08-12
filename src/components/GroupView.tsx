import { ArrowClockwiseIcon } from "@squidlab/phosphor-solid/arrow-clockwise";
import { ArrowsOutSimpleIcon } from "@squidlab/phosphor-solid/arrows-out-simple";
import { CircleNotchIcon } from "@squidlab/phosphor-solid/circle-notch";
import { PlayIcon } from "@squidlab/phosphor-solid/play";
import { SquaresFourIcon } from "@squidlab/phosphor-solid/squares-four";
import { StopIcon } from "@squidlab/phosphor-solid/stop";
import { For, Show, createEffect, createMemo } from "solid-js";
import {
  ensureActivePane,
  groupServices,
  groupStatus,
  selectService,
  serviceStatus,
} from "../stores/apps.store";
import {
  restartService,
  startGroup,
  startService,
  stopGroup,
  stopService,
} from "../services/service-runner";
import type { Service, TerminalGroup } from "../types";
import { statusDotClass, statusLabel, statusPillClass } from "./status";
import { TerminalPaneView } from "./Terminal";

/** One member of the group: its active terminal, with per-service controls. */
function ServiceTile(props: { service: Service }) {
  const status = () => serviceStatus(props.service);
  const busy = () => status() === "starting" || status() === "stopping";
  const running = () => status() === "running";
  const paneId = () => props.service.activePaneId;

  return (
    <div class="group-tile terminal-frame">
      <div class="tile-head">
        <span class={statusDotClass(status())} style={{ width: "6px", height: "6px" }} />
        <span class="text-[11.5px] font-medium truncate">{props.service.name}</span>
        <span class="text-[10.5px] font-mono text-[var(--color-text-faint)] truncate min-w-0">
          {props.service.command} {props.service.args.join(" ")}
        </span>

        <div class="ml-auto flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() =>
              running() ? stopService(props.service.id) : startService(props.service.id)
            }
            disabled={busy()}
            title={running() ? "Stop" : "Start"}
            class="size-6 grid place-items-center rounded-lg btn-ghost"
          >
            <Show
              when={busy()}
              fallback={
                running() ? (
                  <StopIcon size={10} weight="fill" />
                ) : (
                  <PlayIcon size={10} weight="fill" />
                )
              }
            >
              <CircleNotchIcon size={10} weight="bold" class="animate-spin" />
            </Show>
          </button>
          <button
            type="button"
            onClick={() => restartService(props.service.id)}
            title="Restart last command"
            class="size-6 grid place-items-center rounded-lg btn-ghost"
          >
            <ArrowClockwiseIcon size={11} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => selectService(props.service.id)}
            title="Open focused"
            class="size-6 grid place-items-center rounded-lg btn-ghost"
          >
            <ArrowsOutSimpleIcon size={11} weight="bold" />
          </button>
        </div>
      </div>

      <div class="flex-1 min-h-0">
        <Show when={paneId()}>{(id) => <TerminalPaneView paneId={id()} />}</Show>
      </div>
    </div>
  );
}

/**
 * A group's terminals side by side. The grid reflows with the window — three
 * members sit in one row on a wide screen and wrap on a narrow one, with the
 * rows sharing the available height.
 */
export function GroupView(props: { group: TerminalGroup }) {
  const members = createMemo(() => groupServices(props.group));
  const status = createMemo(() => groupStatus(props.group));

  // Opening a group materialises a terminal for each member so they're all
  // live and side by side, which is the whole point of the view.
  createEffect(() => {
    for (const svc of members()) ensureActivePane(svc.id);
  });

  const runningCount = createMemo(
    () => members().filter((svc) => serviceStatus(svc) === "running").length,
  );

  return (
    <main class="flex-1 flex flex-col min-w-0 panel glass">
      <header class="px-4 h-14 flex items-center justify-between gap-3 border-b border-[var(--color-border)] shrink-0">
        <div class="min-w-0 flex items-center gap-3">
          <h1 class="text-[15px] font-semibold tracking-tight truncate">
            {props.group.name}
          </h1>
          <span class={statusPillClass(status())}>
            <span class={statusDotClass(status())} style={{ width: "6px", height: "6px" }} />
            {statusLabel(status())}
          </span>
          <span class="text-[11px] text-[var(--color-text-faint)] shrink-0">
            {runningCount()}/{members().length} running
          </span>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => startGroup(props.group.id)}
            disabled={members().length === 0}
            class="btn-primary px-3.5 h-8 text-[13px] rounded-xl flex items-center gap-1.5"
          >
            <PlayIcon size={11} weight="fill" />
            Start all
          </button>
          <button
            type="button"
            onClick={() => stopGroup(props.group.id)}
            disabled={runningCount() === 0}
            class="btn-secondary px-3.5 h-8 text-[13px] rounded-xl flex items-center gap-1.5"
          >
            <StopIcon size={11} weight="fill" />
            Stop all
          </button>
        </div>
      </header>

      <Show
        when={members().length > 0}
        fallback={
          <div class="flex-1 grid place-items-center">
            <div class="text-center">
              <div class="size-16 rounded-3xl glass-raised grid place-items-center mx-auto mb-4">
                <SquaresFourIcon size={26} weight="duotone" class="text-[var(--color-text-dim)]" />
              </div>
              <p class="text-sm font-medium text-[var(--color-text-dim)]">
                This group is empty
              </p>
              <p class="text-xs text-[var(--color-text-faint)] mt-1">
                Edit it, or drag a service onto it in the sidebar
              </p>
            </div>
          </div>
        }
      >
        <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3">
          <div class="group-grid">
            <For each={members()}>{(svc) => <ServiceTile service={svc} />}</For>
          </div>
        </div>
      </Show>
    </main>
  );
}
