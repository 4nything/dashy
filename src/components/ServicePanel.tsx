import { CircleNotchIcon } from "@squidlab/phosphor-solid/circle-notch";
import { PlayIcon } from "@squidlab/phosphor-solid/play";
import { StopIcon } from "@squidlab/phosphor-solid/stop";
import { TerminalIcon } from "@squidlab/phosphor-solid/terminal";
import { Show, createMemo } from "solid-js";
import { appsStore, findService } from "../stores/apps.store";
import { startService, stopService } from "../services/service-runner";
import type { Service } from "../types";
import { TerminalView } from "./Terminal";

function StatusPill(props: { status: Service["status"] }) {
  const labelMap: Record<Service["status"], string> = {
    stopped: "Stopped",
    starting: "Starting",
    running: "Running",
    stopping: "Stopping",
    crashed: "Crashed",
  };
  const dotClassMap: Record<Service["status"], string> = {
    stopped: "dot dot-stopped",
    starting: "dot dot-warning",
    stopping: "dot dot-warning",
    running: "dot dot-running",
    crashed: "dot dot-crashed",
  };
  const pillClassMap: Record<Service["status"], string> = {
    stopped: "status-pill status-pill-stopped",
    starting: "status-pill status-pill-warning",
    stopping: "status-pill status-pill-warning",
    running: "status-pill status-pill-running",
    crashed: "status-pill status-pill-crashed",
  };
  return (
    <span class={pillClassMap[props.status]}>
      <span class={dotClassMap[props.status]} style={{ width: "6px", height: "6px" }} />
      {labelMap[props.status]}
    </span>
  );
}

export function ServicePanel() {
  const service = createMemo(() =>
    appsStore.selectedServiceId ? findService(appsStore.selectedServiceId) : undefined,
  );

  return (
    <main class="flex-1 flex flex-col min-w-0 app-bg">
      <Show
        when={service()}
        fallback={
          <div class="flex-1 grid place-items-center">
            <div class="text-center">
              <div class="size-14 rounded-2xl bg-[var(--color-bg-2)] grid place-items-center mx-auto mb-4 border border-[var(--color-border)] shadow-[0_0_24px_rgba(139,92,246,0.06)]">
                <TerminalIcon size={26} weight="duotone" class="text-[var(--color-text-dim)]" />
              </div>
              <p class="text-sm font-medium text-[var(--color-text-dim)] mb-1">
                Select a service from the sidebar
              </p>
              <p class="text-xs text-[var(--color-text-faint)]">
                Or hit <kbd class="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-bg-3)] border border-[var(--color-border)] font-mono">+</kbd> to add a new app
              </p>
            </div>
          </div>
        }
      >
        {(svc) => (
          <>
            <header class="px-6 h-12 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg-2)]/40 backdrop-blur">
              <div class="min-w-0 flex items-center gap-3">
                <h1 class="text-[15px] font-semibold truncate">{svc().name}</h1>
                <StatusPill status={svc().status} />
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => startService(svc().id)}
                  class="btn-primary px-3.5 h-8 text-[13px] rounded-md flex items-center gap-1.5"
                  disabled={
                    svc().status === "running" ||
                    svc().status === "starting" ||
                    svc().status === "stopping"
                  }
                >
                  <Show
                    when={svc().status === "starting"}
                    fallback={<PlayIcon size={11} weight="fill" />}
                  >
                    <CircleNotchIcon size={11} weight="bold" class="animate-spin" />
                  </Show>
                  {svc().status === "starting" ? "Starting…" : "Start"}
                </button>
                <button
                  type="button"
                  onClick={() => stopService(svc().id)}
                  class="btn-secondary px-3.5 h-8 text-[13px] rounded-md flex items-center gap-1.5"
                  disabled={svc().status !== "running"}
                >
                  <Show
                    when={svc().status === "stopping"}
                    fallback={<StopIcon size={11} weight="fill" />}
                  >
                    <CircleNotchIcon size={11} weight="bold" class="animate-spin" />
                  </Show>
                  {svc().status === "stopping" ? "Stopping…" : "Stop"}
                </button>
              </div>
            </header>

            <div class="px-6 pt-3 pb-1">
              <p class="text-xs text-[var(--color-text-faint)] font-mono truncate">
                <span class="text-[var(--color-text-dim)]">{svc().command}</span>{" "}
                <span>{svc().args.join(" ")}</span>
                <span class="opacity-50 mx-2">·</span>
                <span class="text-[var(--color-text-dim)]">{svc().cwd}</span>
              </p>
            </div>

            <div class="flex-1 px-6 pb-6 pt-2 overflow-hidden">
              <div class="terminal-frame h-full w-full">
                <TerminalView serviceId={svc().id} />
              </div>
            </div>
          </>
        )}
      </Show>
    </main>
  );
}
