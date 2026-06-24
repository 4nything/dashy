import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { CaretDownIcon } from "@squidlab/phosphor-solid/caret-down";
import { CaretRightIcon } from "@squidlab/phosphor-solid/caret-right";
import { CircleNotchIcon } from "@squidlab/phosphor-solid/circle-notch";
import { DotsThreeVerticalIcon } from "@squidlab/phosphor-solid/dots-three-vertical";
import { PencilSimpleIcon } from "@squidlab/phosphor-solid/pencil-simple";
import { PlayIcon } from "@squidlab/phosphor-solid/play";
import { PlusIcon } from "@squidlab/phosphor-solid/plus";
import { StackIcon } from "@squidlab/phosphor-solid/stack";
import { StopIcon } from "@squidlab/phosphor-solid/stop";
import { TrashIcon } from "@squidlab/phosphor-solid/trash";
import { For, Show, createMemo, createSignal } from "solid-js";
import {
  appsStore,
  deleteApp as deleteAppAction,
  deleteService as deleteServiceAction,
  findApp,
  findService,
  selectService,
  toggleAppCollapsed,
} from "../stores/apps.store";
import { ptyKill } from "../services/pty";
import {
  startAllInGroup,
  startService,
  stopAllInGroup,
  stopService,
} from "../services/service-runner";
import { disposeServiceTerminal } from "../services/terminal-manager";
import type { Service } from "../types";
import { AppDialog, type AppDialogTarget } from "./AppDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { ServiceDialog, type ServiceDialogTarget } from "./ServiceDialog";

function statusDotClass(status: Service["status"]) {
  const map: Record<Service["status"], string> = {
    stopped: "dot dot-stopped",
    starting: "dot dot-warning",
    stopping: "dot dot-warning",
    running: "dot dot-running",
    crashed: "dot dot-crashed",
  };
  return map[status];
}

async function performDeleteService(serviceId: string) {
  const svc = findService(serviceId);
  if (svc?.ptyId) {
    try {
      await ptyKill(svc.ptyId);
    } catch (e) {
      console.error("pty kill on delete failed:", e);
    }
  }
  disposeServiceTerminal(serviceId);
  deleteServiceAction(serviceId);
}

async function performDeleteApp(appId: string) {
  const app = findApp(appId);
  if (!app) return;
  await Promise.all(
    app.services.map(async (svc) => {
      if (svc.ptyId) {
        try {
          await ptyKill(svc.ptyId);
        } catch (e) {
          console.error("pty kill on delete failed:", e);
        }
      }
      disposeServiceTerminal(svc.id);
    }),
  );
  deleteAppAction(appId);
}

// ── Service-level play/stop button ─────────────────────────────────────────

function ServiceRunButton(props: { service: Service }) {
  const status = () => props.service.status;
  const isRunning = () => status() === "running";
  const isTransitioning = () => status() === "starting" || status() === "stopping";

  function onClick(e: MouseEvent) {
    e.stopPropagation();
    if (isRunning()) stopService(props.service.id);
    else if (!isTransitioning()) startService(props.service.id);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isTransitioning()}
      title={isRunning() ? "Stop" : "Start"}
      class="size-6 shrink-0 grid place-items-center rounded-md btn-ghost"
    >
      <Show
        when={isTransitioning()}
        fallback={
          isRunning() ? (
            <StopIcon size={12} weight="fill" />
          ) : (
            <PlayIcon size={12} weight="fill" />
          )
        }
      >
        <CircleNotchIcon size={12} weight="bold" class="animate-spin" />
      </Show>
    </button>
  );
}

// ── Group-level run-all controls ───────────────────────────────────────────

function GroupRunControls(props: { appId: string; services: Service[] }) {
  const runningCount = () => props.services.filter((s) => s.status === "running").length;
  const startableCount = () =>
    props.services.filter((s) => s.status === "stopped" || s.status === "crashed").length;

  function onPlay(e: MouseEvent) {
    e.stopPropagation();
    startAllInGroup(props.appId);
  }
  function onStop(e: MouseEvent) {
    e.stopPropagation();
    stopAllInGroup(props.appId);
  }

  return (
    <>
      <button
        type="button"
        onClick={onPlay}
        disabled={startableCount() === 0}
        title={`Start ${startableCount()} stopped service${startableCount() === 1 ? "" : "s"}`}
        class="size-6 grid place-items-center rounded-md btn-ghost"
      >
        <PlayIcon size={11} weight="fill" />
      </button>
      <button
        type="button"
        onClick={onStop}
        disabled={runningCount() === 0}
        title={`Stop ${runningCount()} running service${runningCount() === 1 ? "" : "s"}`}
        class="size-6 grid place-items-center rounded-md btn-ghost"
      >
        <StopIcon size={11} weight="fill" />
      </button>
    </>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const [appDialog, setAppDialog] = createSignal<AppDialogTarget>(null);
  const [serviceDialog, setServiceDialog] = createSignal<ServiceDialogTarget>(null);

  const [deleteServiceId, setDeleteServiceId] = createSignal<string | null>(null);
  const [deleteAppId, setDeleteAppId] = createSignal<string | null>(null);

  const deleteServiceCandidate = createMemo(() => {
    const id = deleteServiceId();
    return id ? findService(id) : undefined;
  });
  const deleteAppCandidate = createMemo(() => {
    const id = deleteAppId();
    return id ? findApp(id) : undefined;
  });

  return (
    <aside class="w-64 shrink-0 border-r border-[var(--color-border)] sidebar-bg flex flex-col">
      <div class="px-4 h-12 border-b border-[var(--color-border)] flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="size-6 rounded-md bg-gradient-to-br from-[var(--color-accent)] to-[#5b21b6] grid place-items-center shadow-[0_0_12px_var(--color-accent-glow)]">
            <StackIcon size={13} weight="fill" class="text-white" />
          </div>
          <span class="font-semibold tracking-tight text-[15px]">Dashy</span>
        </div>
        <button
          type="button"
          onClick={() => setAppDialog({ kind: "add" })}
          title="New app"
          class="size-7 grid place-items-center rounded-md btn-ghost"
        >
          <PlusIcon size={14} weight="bold" />
        </button>
      </div>

      <AppDialog target={appDialog()} onClose={() => setAppDialog(null)} />
      <ServiceDialog target={serviceDialog()} onClose={() => setServiceDialog(null)} />

      <ConfirmDialog
        open={deleteServiceId() !== null}
        title="Delete service?"
        description={
          deleteServiceCandidate()
            ? `"${deleteServiceCandidate()?.name}" will be removed. If it's running, the process will be killed first. This can't be undone.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const id = deleteServiceId();
          if (id) performDeleteService(id);
          setDeleteServiceId(null);
        }}
        onCancel={() => setDeleteServiceId(null)}
      />

      <ConfirmDialog
        open={deleteAppId() !== null}
        title="Delete app?"
        description={
          deleteAppCandidate()
            ? `"${deleteAppCandidate()?.name}" and its ${deleteAppCandidate()?.services.length} service(s) will be removed. Running processes will be killed first. This can't be undone.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const id = deleteAppId();
          if (id) performDeleteApp(id);
          setDeleteAppId(null);
        }}
        onCancel={() => setDeleteAppId(null)}
      />

      <div class="flex-1 overflow-y-auto py-3">
        <Show when={appsStore.loaded && appsStore.apps.length === 0}>
          <div class="px-4 py-12 text-center">
            <div class="size-10 rounded-xl bg-[var(--color-bg-3)] grid place-items-center mx-auto mb-3 border border-[var(--color-border)]">
              <StackIcon size={18} weight="duotone" class="text-[var(--color-text-dim)]" />
            </div>
            <p class="text-xs text-[var(--color-text-dim)] mb-3">No apps yet</p>
            <button
              type="button"
              onClick={() => setAppDialog({ kind: "add" })}
              class="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
            >
              Create your first app →
            </button>
          </div>
        </Show>

        <For each={appsStore.apps}>
          {(app) => (
            <div class="mb-1">
              <div class="flex items-center px-2 group/group gap-0.5">
                <button
                  type="button"
                  onClick={() => toggleAppCollapsed(app.id)}
                  class="flex-1 px-1.5 py-1 text-left text-[10.5px] uppercase tracking-[0.08em] font-semibold text-[var(--color-text-dim)] hover:text-[var(--color-text)] flex items-center gap-1.5 min-w-0 transition-colors"
                >
                  <Show
                    when={app.collapsed}
                    fallback={<CaretDownIcon size={9} weight="bold" />}
                  >
                    <CaretRightIcon size={9} weight="bold" />
                  </Show>
                  <span class="truncate">{app.name}</span>
                </button>

                <div class="flex items-center gap-0.5 opacity-0 group-hover/group:opacity-100 transition-opacity">
                  <GroupRunControls appId={app.id} services={app.services} />
                  <button
                    type="button"
                    onClick={() => setServiceDialog({ kind: "add", appId: app.id })}
                    title="Add service"
                    class="size-6 grid place-items-center rounded-md btn-ghost"
                  >
                    <PlusIcon size={11} weight="bold" />
                  </button>

                  <DropdownMenu placement="bottom-end" gutter={4}>
                    <DropdownMenu.Trigger
                      title="More"
                      class="size-6 grid place-items-center rounded-md btn-ghost"
                    >
                      <DotsThreeVerticalIcon size={13} weight="bold" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="z-50 min-w-[160px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-2)] p-1 shadow-2xl text-sm">
                        <DropdownMenu.Item
                          onSelect={() => setAppDialog({ kind: "edit", appId: app.id })}
                          class="px-2.5 py-1.5 rounded-md cursor-default outline-none flex items-center gap-2 data-[highlighted]:bg-[var(--color-bg-3)]"
                        >
                          <PencilSimpleIcon size={12} weight="bold" class="text-[var(--color-text-dim)]" />
                          Rename…
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onSelect={() => setDeleteAppId(app.id)}
                          class="px-2.5 py-1.5 rounded-md cursor-default outline-none flex items-center gap-2 text-[var(--color-danger)] data-[highlighted]:bg-[rgba(239,68,68,0.1)]"
                        >
                          <TrashIcon size={12} weight="bold" />
                          Delete app…
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
              </div>

              <Show when={!app.collapsed}>
                <Show
                  when={app.services.length > 0}
                  fallback={
                    <button
                      type="button"
                      onClick={() => setServiceDialog({ kind: "add", appId: app.id })}
                      class="mx-2 mt-1 w-[calc(100%-1rem)] px-3 py-1.5 text-left text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] italic rounded-md hover:bg-[var(--color-bg-3)] transition-colors"
                    >
                      no services — click to add
                    </button>
                  }
                >
                  <ul class="px-1 mt-0.5">
                    <For each={app.services}>
                      {(svc) => {
                        const isActive = () => appsStore.selectedServiceId === svc.id;
                        return (
                          <li
                            class={`flex items-center pr-1 group/item gap-0.5 rounded-md transition-colors ${
                              isActive() ? "sidebar-item-active" : "hover:bg-[var(--color-bg-3)]"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => selectService(svc.id)}
                              class={`flex-1 pl-3 py-1.5 text-left text-[13px] flex items-center gap-2.5 min-w-0 transition-colors ${
                                isActive()
                                  ? "text-[var(--color-text)]"
                                  : "text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
                              }`}
                            >
                              <span class={statusDotClass(svc.status)} />
                              <span class="truncate font-medium">{svc.name}</span>
                            </button>

                            <ServiceRunButton service={svc} />

                            <div class="opacity-0 group-hover/item:opacity-100 transition-opacity">
                              <DropdownMenu placement="bottom-end" gutter={4}>
                                <DropdownMenu.Trigger
                                  class="size-6 grid place-items-center rounded-md btn-ghost"
                                  title="More"
                                >
                                  <DotsThreeVerticalIcon size={13} weight="bold" />
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Portal>
                                  <DropdownMenu.Content class="z-50 min-w-[140px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-2)] p-1 shadow-2xl text-sm">
                                    <DropdownMenu.Item
                                      onSelect={() => setServiceDialog({ kind: "edit", serviceId: svc.id })}
                                      class="px-2.5 py-1.5 rounded-md cursor-default outline-none flex items-center gap-2 data-[highlighted]:bg-[var(--color-bg-3)]"
                                    >
                                      <PencilSimpleIcon size={12} weight="bold" class="text-[var(--color-text-dim)]" />
                                      Edit…
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item
                                      onSelect={() => setDeleteServiceId(svc.id)}
                                      class="px-2.5 py-1.5 rounded-md cursor-default outline-none flex items-center gap-2 text-[var(--color-danger)] data-[highlighted]:bg-[rgba(239,68,68,0.1)]"
                                    >
                                      <TrashIcon size={12} weight="bold" />
                                      Delete
                                    </DropdownMenu.Item>
                                  </DropdownMenu.Content>
                                </DropdownMenu.Portal>
                              </DropdownMenu>
                            </div>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Show>
              </Show>
            </div>
          )}
        </For>
      </div>
    </aside>
  );
}
