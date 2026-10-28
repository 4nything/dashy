import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { ArrowClockwiseIcon } from "@squidlab/phosphor-solid/arrow-clockwise";
import { CaretDownIcon } from "@squidlab/phosphor-solid/caret-down";
import { CaretRightIcon } from "@squidlab/phosphor-solid/caret-right";
import { CircleNotchIcon } from "@squidlab/phosphor-solid/circle-notch";
import { ColumnsPlusRightIcon } from "@squidlab/phosphor-solid/columns-plus-right";
import { DotsThreeVerticalIcon } from "@squidlab/phosphor-solid/dots-three-vertical";
import { PencilSimpleIcon } from "@squidlab/phosphor-solid/pencil-simple";
import { PlayIcon } from "@squidlab/phosphor-solid/play";
import { PlusIcon } from "@squidlab/phosphor-solid/plus";
import { SquaresFourIcon } from "@squidlab/phosphor-solid/squares-four";
import { StackIcon } from "@squidlab/phosphor-solid/stack";
import { StopIcon } from "@squidlab/phosphor-solid/stop";
import { TrashIcon } from "@squidlab/phosphor-solid/trash";
import { XIcon } from "@squidlab/phosphor-solid/x";
import { For, Show, createMemo, createSignal } from "solid-js";
import {
  addPane,
  addServiceToGroup,
  appsStore,
  deleteApp as deleteAppAction,
  deleteGroup as deleteGroupAction,
  deleteService as deleteServiceAction,
  findApp,
  findGroup,
  findService,
  groupServices,
  groupStatus,
  moveApp,
  moveGroup,
  moveGroupMember,
  movePane,
  moveService,
  removeServiceFromGroup,
  selectGroup,
  selectService,
  serviceStatus,
  setActivePane,
  toggleAppCollapsed,
  toggleGroupCollapsed,
} from "../stores/apps.store";
import {
  beginDrag,
  clearDrop,
  dragItem,
  dropClass,
  edgeFromEvent,
  endDrag,
  hoverDrop,
  memberRowId,
} from "../stores/dnd";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  commitSidebarWidth,
  setSidebarWidth,
  uiStore,
} from "../stores/ui.store";
import {
  closePane,
  disposeServiceShells,
  restartPane,
  startAllInGroup,
  startGroup,
  startPane,
  startService,
  stopAllInGroup,
  stopGroup,
  stopPane,
  stopService,
} from "../services/service-runner";
import { focusPane } from "../services/terminal-manager";
import type { Service, ServiceStatus, TerminalGroup, TerminalPane } from "../types";
import { AppDialog, type AppDialogTarget } from "./AppDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { GroupDialog, type GroupDialogTarget } from "./GroupDialog";
import { ServiceDialog, type ServiceDialogTarget } from "./ServiceDialog";
import { statusDotClass } from "./status";

async function performDeleteService(serviceId: string) {
  await disposeServiceShells(serviceId);
  deleteServiceAction(serviceId);
}

async function performDeleteApp(appId: string) {
  const app = findApp(appId);
  if (!app) return;
  await Promise.all(app.services.map((svc) => disposeServiceShells(svc.id)));
  deleteAppAction(appId);
}

function paneProcessName(pane: TerminalPane): string {
  const cmd = pane.lastCommand?.trim();
  if (!cmd) return "cmd";
  return cmd.split(/\s+/)[0] ?? "cmd";
}

function startDrag(e: DragEvent, id: string) {
  // Chromium won't initiate a drag without payload on the transfer.
  e.dataTransfer?.setData("text/plain", id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function acceptDrop(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

// ── Run / stop toggle, shared by service rows and pane rows ────────────────

function RunToggle(props: {
  status: ServiceStatus;
  size?: number;
  onStart: () => void;
  onStop: () => void;
  title?: string;
}) {
  const isRunning = () => props.status === "running";
  const isTransitioning = () =>
    props.status === "starting" || props.status === "stopping";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (isRunning()) props.onStop();
        else if (!isTransitioning()) props.onStart();
      }}
      disabled={isTransitioning()}
      title={props.title ?? (isRunning() ? "Stop" : "Start")}
      class="size-6 shrink-0 grid place-items-center rounded-lg btn-ghost"
    >
      <Show
        when={isTransitioning()}
        fallback={
          isRunning() ? (
            <StopIcon size={props.size ?? 11} weight="fill" />
          ) : (
            <PlayIcon size={props.size ?? 11} weight="fill" />
          )
        }
      >
        <CircleNotchIcon size={props.size ?? 11} weight="bold" class="animate-spin" />
      </Show>
    </button>
  );
}

function GroupRunControls(props: { appId: string; services: Service[] }) {
  const runningCount = () =>
    props.services.filter((s) => serviceStatus(s) === "running").length;
  const startableCount = () =>
    props.services.filter((s) => serviceStatus(s) !== "running").length;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          startAllInGroup(props.appId);
        }}
        disabled={startableCount() === 0}
        title={`Start ${startableCount()} idle service${startableCount() === 1 ? "" : "s"}`}
        class="size-6 grid place-items-center rounded-lg btn-ghost"
      >
        <PlayIcon size={11} weight="fill" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          stopAllInGroup(props.appId);
        }}
        disabled={runningCount() === 0}
        title={`Stop ${runningCount()} running service${runningCount() === 1 ? "" : "s"}`}
        class="size-6 grid place-items-center rounded-lg btn-ghost"
      >
        <StopIcon size={11} weight="fill" />
      </button>
    </>
  );
}

// ── Split terminals, nested under their service ────────────────────────────

function PaneRows(props: { service: Service }) {
  function focus(paneId: string) {
    selectService(props.service.id);
    setActivePane(paneId);
    focusPane(paneId);
  }

  return (
    <ul class="mt-0.5 mb-1">
      <For each={props.service.panes}>
        {(pane) => {
          const isActive = () =>
            appsStore.selectedServiceId === props.service.id &&
            props.service.activePaneId === pane.id;

          let row!: HTMLLIElement;

          return (
            <li
              ref={row}
              draggable={true}
              onDragStart={(e) => {
                e.stopPropagation();
                startDrag(e, pane.id);
                beginDrag({ kind: "pane", paneId: pane.id });
              }}
              onDragEnd={endDrag}
              onDragOver={(e) => {
                e.stopPropagation();
                if (dragItem()?.kind !== "pane") return;
                acceptDrop(e);
                hoverDrop(pane.id, edgeFromEvent(e, row));
              }}
              onDragLeave={() => clearDrop(pane.id)}
              onDrop={(e) => {
                e.stopPropagation();
                const item = dragItem();
                if (item?.kind === "pane") {
                  e.preventDefault();
                  movePane(item.paneId, pane.id, edgeFromEvent(e, row));
                }
                endDrag();
              }}
              class={`pane-row draggable-row group/pane flex items-center pr-1 gap-0.5 rounded-lg transition-colors ${dropClass(pane.id)} ${
                isActive() ? "sidebar-item-active" : "hover:bg-[var(--color-bg-3)]"
              }`}
            >
              <button
                type="button"
                draggable={true}
                onClick={() => focus(pane.id)}
                class={`flex-1 py-1 text-left text-[12px] flex items-center gap-2 min-w-0 transition-colors ${
                  isActive()
                    ? "text-[var(--color-text)]"
                    : "text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
                }`}
              >
                <span
                  class={statusDotClass(pane.status)}
                  style={{ width: "6px", height: "6px" }}
                />
                <span class="truncate">
                  {pane.index}: {paneProcessName(pane)}
                </span>
              </button>

              <div class="flex items-center opacity-0 group-hover/pane:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    restartPane(pane.id);
                  }}
                  title="Restart this terminal's last command"
                  class="size-6 grid place-items-center rounded-lg btn-ghost"
                >
                  <ArrowClockwiseIcon size={11} weight="bold" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closePane(pane.id);
                  }}
                  title="Close terminal"
                  class="size-6 grid place-items-center rounded-lg btn-ghost"
                >
                  <XIcon size={11} weight="bold" />
                </button>
              </div>

              <RunToggle
                status={pane.status}
                onStart={() => startPane(pane.id)}
                onStop={() => stopPane(pane.id)}
              />
            </li>
          );
        }}
      </For>
    </ul>
  );
}

// ── Groups: hand-picked sets of services, tiled side by side ───────────────

function GroupRows(props: {
  group: TerminalGroup;
  onEdit: (groupId: string) => void;
  onDelete: (groupId: string) => void;
}) {
  const members = () => groupServices(props.group);
  const status = () => groupStatus(props.group);
  const runningCount = () =>
    members().filter((svc) => serviceStatus(svc) === "running").length;
  const isActive = () => appsStore.selectedGroupId === props.group.id;

  let groupRow!: HTMLDivElement;

  return (
    <div class="mb-1">
      <div
        ref={groupRow}
        draggable={true}
        onDragStart={(e) => {
          startDrag(e, props.group.id);
          beginDrag({ kind: "group", groupId: props.group.id });
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          const item = dragItem();
          if (item?.kind === "group") {
            acceptDrop(e);
            hoverDrop(props.group.id, edgeFromEvent(e, groupRow));
          } else if (item?.kind === "service") {
            // Dropping a service from the app tree adds it to the group.
            acceptDrop(e);
            hoverDrop(props.group.id, "after");
          }
        }}
        onDragLeave={() => clearDrop(props.group.id)}
        onDrop={(e) => {
          const item = dragItem();
          if (item?.kind === "group") {
            e.preventDefault();
            moveGroup(item.groupId, props.group.id, edgeFromEvent(e, groupRow));
          } else if (item?.kind === "service") {
            e.preventDefault();
            addServiceToGroup(props.group.id, item.serviceId);
          }
          endDrag();
        }}
        class={`flex items-center pr-1 gap-0.5 rounded-lg transition-colors draggable-row group/grp ${dropClass(props.group.id)} ${
          isActive() ? "sidebar-item-active" : "hover:bg-[var(--color-bg-3)]"
        }`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleGroupCollapsed(props.group.id);
          }}
          title={props.group.collapsed ? "Expand" : "Collapse"}
          class="size-5 ml-1 shrink-0 grid place-items-center rounded btn-ghost"
        >
          <Show
            when={props.group.collapsed}
            fallback={<CaretDownIcon size={9} weight="bold" />}
          >
            <CaretRightIcon size={9} weight="bold" />
          </Show>
        </button>

        <button
          type="button"
          draggable={true}
          onClick={() => selectGroup(props.group.id)}
          class={`flex-1 py-1.5 text-left text-[13px] flex items-center gap-2 min-w-0 transition-colors ${
            isActive()
              ? "text-[var(--color-text)]"
              : "text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
          }`}
        >
          <span class={statusDotClass(status())} />
          <span class="truncate font-medium">{props.group.name}</span>
          <span class="pane-count shrink-0">
            {runningCount()}/{members().length}
          </span>
        </button>

        <div class="flex items-center gap-0.5 opacity-0 group-hover/grp:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              startGroup(props.group.id);
            }}
            disabled={members().length === 0}
            title="Start every service in this group"
            class="size-6 grid place-items-center rounded-lg btn-ghost"
          >
            <PlayIcon size={11} weight="fill" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              stopGroup(props.group.id);
            }}
            disabled={runningCount() === 0}
            title="Stop every service in this group"
            class="size-6 grid place-items-center rounded-lg btn-ghost"
          >
            <StopIcon size={11} weight="fill" />
          </button>

          <DropdownMenu placement="bottom-end" gutter={4}>
            <DropdownMenu.Trigger
              title="More"
              class="size-6 grid place-items-center rounded-lg btn-ghost"
            >
              <DotsThreeVerticalIcon size={13} weight="bold" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="menu-surface">
                <DropdownMenu.Item
                  onSelect={() => props.onEdit(props.group.id)}
                  class="menu-item"
                >
                  <PencilSimpleIcon
                    size={12}
                    weight="bold"
                    class="text-[var(--color-text-dim)]"
                  />
                  Edit group…
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => props.onDelete(props.group.id)}
                  class="menu-item menu-item-danger"
                >
                  <TrashIcon size={12} weight="bold" />
                  Delete group…
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
      </div>

      <Show when={!props.group.collapsed && members().length > 0}>
        <ul class="mt-0.5 mb-1">
          <For each={members()}>
            {(svc) => {
              const rowId = () => memberRowId(props.group.id, svc.id);
              let row!: HTMLLIElement;
              return (
                <li
                  ref={row}
                  draggable={true}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    startDrag(e, svc.id);
                    beginDrag({
                      kind: "member",
                      groupId: props.group.id,
                      serviceId: svc.id,
                    });
                  }}
                  onDragEnd={endDrag}
                  onDragOver={(e) => {
                    e.stopPropagation();
                    const item = dragItem();
                    if (item?.kind !== "member" || item.groupId !== props.group.id) return;
                    acceptDrop(e);
                    hoverDrop(rowId(), edgeFromEvent(e, row));
                  }}
                  onDragLeave={() => clearDrop(rowId())}
                  onDrop={(e) => {
                    e.stopPropagation();
                    const item = dragItem();
                    if (item?.kind === "member" && item.groupId === props.group.id) {
                      e.preventDefault();
                      moveGroupMember(
                        props.group.id,
                        item.serviceId,
                        svc.id,
                        edgeFromEvent(e, row),
                      );
                    }
                    endDrag();
                  }}
                  class={`pane-row draggable-row group/mem flex items-center pr-1 gap-0.5 rounded-lg transition-colors hover:bg-[var(--color-bg-3)] ${dropClass(rowId())}`}
                >
                  <button
                    type="button"
                    draggable={true}
                    onClick={() => selectService(svc.id)}
                    title="Open focused"
                    class="flex-1 py-1 text-left text-[12px] flex items-center gap-2 min-w-0 text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
                  >
                    <span
                      class={statusDotClass(serviceStatus(svc))}
                      style={{ width: "6px", height: "6px" }}
                    />
                    <span class="truncate">{svc.name}</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeServiceFromGroup(props.group.id, svc.id);
                    }}
                    title="Remove from group"
                    class="size-6 grid place-items-center rounded-lg btn-ghost opacity-0 group-hover/mem:opacity-100 transition-opacity"
                  >
                    <XIcon size={11} weight="bold" />
                  </button>

                  <RunToggle
                    status={serviceStatus(svc)}
                    onStart={() => startService(svc.id)}
                    onStop={() => stopService(svc.id)}
                  />
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </div>
  );
}

// ── Drag-to-resize handle on the sidebar's right edge ──────────────────────

function SidebarResizer() {
  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = uiStore.sidebarWidth;

    const move = (ev: PointerEvent) => setSidebarWidth(startWidth + (ev.clientX - startX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      commitSidebarWidth();
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDblClick={() => {
        setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
        commitSidebarWidth();
      }}
      class="sidebar-resizer"
    />
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const [appDialog, setAppDialog] = createSignal<AppDialogTarget>(null);
  const [serviceDialog, setServiceDialog] = createSignal<ServiceDialogTarget>(null);
  const [groupDialog, setGroupDialog] = createSignal<GroupDialogTarget>(null);

  const [deleteServiceId, setDeleteServiceId] = createSignal<string | null>(null);
  const [deleteAppId, setDeleteAppId] = createSignal<string | null>(null);
  const [deleteGroupId, setDeleteGroupId] = createSignal<string | null>(null);

  const deleteServiceCandidate = createMemo(() => {
    const id = deleteServiceId();
    return id ? findService(id) : undefined;
  });
  const deleteAppCandidate = createMemo(() => {
    const id = deleteAppId();
    return id ? findApp(id) : undefined;
  });

  // Dialogs stay mounted even when the sidebar is hidden, otherwise
  // collapsing mid-edit would silently drop the open dialog.
  const dialogs = (
    <>
      <AppDialog target={appDialog()} onClose={() => setAppDialog(null)} />
      <ServiceDialog target={serviceDialog()} onClose={() => setServiceDialog(null)} />
      <GroupDialog target={groupDialog()} onClose={() => setGroupDialog(null)} />

      <ConfirmDialog
        open={deleteGroupId() !== null}
        title="Delete group?"
        description={
          deleteGroupId()
            ? `"${findGroup(deleteGroupId()!)?.name}" will be removed. The services stay where they are — only the grouping is deleted.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const id = deleteGroupId();
          if (id) deleteGroupAction(id);
          setDeleteGroupId(null);
        }}
        onCancel={() => setDeleteGroupId(null)}
      />

      <ConfirmDialog
        open={deleteServiceId() !== null}
        title="Delete service?"
        description={
          deleteServiceCandidate()
            ? `"${deleteServiceCandidate()?.name}" will be removed. Its terminals will be killed first. This can't be undone.`
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
    </>
  );

  return (
    <>
      {dialogs}
      <Show when={!uiStore.sidebarCollapsed}>
        <aside
          style={{
            width: `${uiStore.sidebarWidth}px`,
            "min-width": `${SIDEBAR_MIN_WIDTH}px`,
          }}
          class="relative shrink-0 flex flex-col panel glass mr-2"
        >
          <div class="flex-1 overflow-y-auto overflow-x-hidden py-2.5">
            <div class="section-head">
              <span>Groups</span>
              <button
                type="button"
                onClick={() => setGroupDialog({ kind: "add" })}
                title="New group"
                class="size-6 grid place-items-center rounded-lg btn-ghost"
              >
                <PlusIcon size={12} weight="bold" />
              </button>
            </div>

            <div class="px-1.5 mb-3">
              <Show
                when={appsStore.groups.length > 0}
                fallback={
                  <button
                    type="button"
                    onClick={() => setGroupDialog({ kind: "add" })}
                    class="w-full px-2.5 py-2 text-left text-[11.5px] text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] rounded-lg hover:bg-[var(--color-bg-3)] transition-colors flex items-center gap-2"
                  >
                    <SquaresFourIcon size={13} weight="duotone" />
                    Run several services side by side
                  </button>
                }
              >
                <For each={appsStore.groups}>
                  {(group) => (
                    <GroupRows
                      group={group}
                      onEdit={(id) => setGroupDialog({ kind: "edit", groupId: id })}
                      onDelete={(id) => setDeleteGroupId(id)}
                    />
                  )}
                </For>
              </Show>
            </div>

            <div class="section-head">
              <span>Apps</span>
              <button
                type="button"
                onClick={() => setAppDialog({ kind: "add" })}
                title="New app"
                class="size-6 grid place-items-center rounded-lg btn-ghost"
              >
                <PlusIcon size={12} weight="bold" />
              </button>
            </div>

            <Show when={appsStore.loaded && appsStore.apps.length === 0}>
              <div class="px-4 py-12 text-center">
                <div class="size-11 rounded-2xl glass-raised grid place-items-center mx-auto mb-3">
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
              {(app) => {
                let appRow!: HTMLDivElement;
                return (
                  <div class="mb-1.5">
                    <div
                      ref={appRow}
                      draggable={true}
                      onDragStart={(e) => {
                        startDrag(e, app.id);
                        beginDrag({ kind: "app", appId: app.id });
                      }}
                      onDragEnd={endDrag}
                      onDragOver={(e) => {
                        const item = dragItem();
                        if (item?.kind === "app") {
                          acceptDrop(e);
                          hoverDrop(app.id, edgeFromEvent(e, appRow));
                        } else if (item?.kind === "service") {
                          // Dropping a service on a header moves it into
                          // that app, at the end.
                          acceptDrop(e);
                          hoverDrop(app.id, "after");
                        }
                      }}
                      onDragLeave={() => clearDrop(app.id)}
                      onDrop={(e) => {
                        const item = dragItem();
                        if (item?.kind === "app") {
                          e.preventDefault();
                          moveApp(item.appId, app.id, edgeFromEvent(e, appRow));
                        } else if (item?.kind === "service") {
                          e.preventDefault();
                          moveService(item.serviceId, app.id, null, "after");
                        }
                        endDrag();
                      }}
                      class={`flex items-center px-2 group/group gap-0.5 draggable-row rounded-lg ${dropClass(app.id)}`}
                    >
                      <button
                        type="button"
                        draggable={true}
                        onClick={() => toggleAppCollapsed(app.id)}
                        class="flex-1 px-1 py-1 text-left text-[10.5px] uppercase tracking-[0.09em] font-semibold text-[var(--color-text-dim)] hover:text-[var(--color-text)] flex items-center gap-1.5 min-w-0 transition-colors"
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
                          class="size-6 grid place-items-center rounded-lg btn-ghost"
                        >
                          <PlusIcon size={11} weight="bold" />
                        </button>

                        <DropdownMenu placement="bottom-end" gutter={4}>
                          <DropdownMenu.Trigger
                            title="More"
                            class="size-6 grid place-items-center rounded-lg btn-ghost"
                          >
                            <DotsThreeVerticalIcon size={13} weight="bold" />
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content class="menu-surface">
                              <DropdownMenu.Item
                                onSelect={() => setAppDialog({ kind: "edit", appId: app.id })}
                                class="menu-item"
                              >
                                <PencilSimpleIcon
                                  size={12}
                                  weight="bold"
                                  class="text-[var(--color-text-dim)]"
                                />
                                Rename…
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                onSelect={() => setDeleteAppId(app.id)}
                                class="menu-item menu-item-danger"
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
                            class="mx-2 mt-1 w-[calc(100%-1rem)] px-3 py-1.5 text-left text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] italic rounded-lg hover:bg-[var(--color-bg-3)] transition-colors"
                          >
                            no services — click to add
                          </button>
                        }
                      >
                        <ul class="px-1.5 mt-0.5">
                          <For each={app.services}>
                            {(svc) => {
                              const isActive = () => appsStore.selectedServiceId === svc.id;
                              const status = () => serviceStatus(svc);
                              const isSplit = () => svc.panes.length > 1;
                              let svcRow!: HTMLDivElement;

                              return (
                                <li>
                                  <div
                                    ref={svcRow}
                                    draggable={true}
                                    onDragStart={(e) => {
                                      e.stopPropagation();
                                      startDrag(e, svc.id);
                                      beginDrag({ kind: "service", serviceId: svc.id });
                                    }}
                                    onDragEnd={endDrag}
                                    onDragOver={(e) => {
                                      e.stopPropagation();
                                      if (dragItem()?.kind !== "service") return;
                                      acceptDrop(e);
                                      hoverDrop(svc.id, edgeFromEvent(e, svcRow));
                                    }}
                                    onDragLeave={() => clearDrop(svc.id)}
                                    onDrop={(e) => {
                                      e.stopPropagation();
                                      const item = dragItem();
                                      if (item?.kind === "service") {
                                        e.preventDefault();
                                        moveService(
                                          item.serviceId,
                                          app.id,
                                          svc.id,
                                          edgeFromEvent(e, svcRow),
                                        );
                                      }
                                      endDrag();
                                    }}
                                    class={`flex items-center pr-1 group/item gap-0.5 rounded-lg transition-colors draggable-row ${dropClass(svc.id)} ${
                                      isActive() && !isSplit()
                                        ? "sidebar-item-active"
                                        : "hover:bg-[var(--color-bg-3)]"
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      draggable={true}
                                      onClick={() => selectService(svc.id)}
                                      class={`flex-1 pl-2.5 py-1.5 text-left text-[13px] flex items-center gap-2.5 min-w-0 transition-colors ${
                                        isActive()
                                          ? "text-[var(--color-text)]"
                                          : "text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
                                      }`}
                                    >
                                      <span class={statusDotClass(status())} />
                                      <span class="truncate font-medium">{svc.name}</span>
                                      <Show when={isSplit()}>
                                        <span class="pane-count shrink-0">
                                          {svc.panes.length}
                                        </span>
                                      </Show>
                                    </button>

                                    <div class="flex items-center opacity-0 group-hover/item:opacity-100 transition-opacity">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          selectService(svc.id);
                                          addPane(svc.id);
                                        }}
                                        title="Split terminal"
                                        class="size-6 grid place-items-center rounded-lg btn-ghost"
                                      >
                                        <ColumnsPlusRightIcon size={12} weight="bold" />
                                      </button>

                                      <DropdownMenu placement="bottom-end" gutter={4}>
                                        <DropdownMenu.Trigger
                                          class="size-6 grid place-items-center rounded-lg btn-ghost"
                                          title="More"
                                        >
                                          <DotsThreeVerticalIcon size={13} weight="bold" />
                                        </DropdownMenu.Trigger>
                                        <DropdownMenu.Portal>
                                          <DropdownMenu.Content class="menu-surface">
                                            <DropdownMenu.Item
                                              onSelect={() =>
                                                setServiceDialog({
                                                  kind: "edit",
                                                  serviceId: svc.id,
                                                })
                                              }
                                              class="menu-item"
                                            >
                                              <PencilSimpleIcon
                                                size={12}
                                                weight="bold"
                                                class="text-[var(--color-text-dim)]"
                                              />
                                              Edit…
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item
                                              onSelect={() => {
                                                selectService(svc.id);
                                                addPane(svc.id);
                                              }}
                                              class="menu-item"
                                            >
                                              <ColumnsPlusRightIcon
                                                size={12}
                                                weight="bold"
                                                class="text-[var(--color-text-dim)]"
                                              />
                                              Split terminal
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item
                                              onSelect={() => setDeleteServiceId(svc.id)}
                                              class="menu-item menu-item-danger"
                                            >
                                              <TrashIcon size={12} weight="bold" />
                                              Delete
                                            </DropdownMenu.Item>
                                          </DropdownMenu.Content>
                                        </DropdownMenu.Portal>
                                      </DropdownMenu>
                                    </div>

                                    <RunToggle
                                      status={status()}
                                      size={12}
                                      onStart={() => startService(svc.id)}
                                      onStop={() => stopService(svc.id)}
                                    />
                                  </div>

                                  <Show when={isSplit()}>
                                    <PaneRows service={svc} />
                                  </Show>
                                </li>
                              );
                            }}
                          </For>
                        </ul>
                      </Show>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>

          <SidebarResizer />
        </aside>
      </Show>
    </>
  );
}
