import { createStore, produce } from "solid-js/store";
import type {
  AppGroup,
  SavedCommand,
  Service,
  ServiceStatus,
  TerminalGroup,
  TerminalPane,
} from "../types";
import {
  configLoad,
  configSave,
  type PersistedApp,
  type PersistedConfig,
  type PersistedGroup,
  type PersistedService,
} from "../services/config";

interface AppsState {
  apps: AppGroup[];
  groups: TerminalGroup[];
  /** Exactly one of these is set — selecting either clears the other. */
  selectedServiceId: string | null;
  selectedGroupId: string | null;
  loaded: boolean;
}

const [state, setState] = createStore<AppsState>({
  apps: [],
  groups: [],
  selectedServiceId: null,
  selectedGroupId: null,
  loaded: false,
});

export const appsStore = state;

// ── Persistence ────────────────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 300;
let saveTimer: number | undefined;

function hydrateService(s: PersistedService): Service {
  return {
    id: s.id,
    name: s.name,
    command: s.command,
    args: s.args ?? [],
    cwd: s.cwd,
    env: s.env ?? {},
    savedCommands: s.savedCommands ?? [],
    panes: [],
    activePaneId: null,
  };
}

function hydrateApp(a: PersistedApp): AppGroup {
  return {
    id: a.id,
    name: a.name,
    collapsed: a.collapsed ?? false,
    services: (a.services ?? []).map(hydrateService),
  };
}

function stripService(s: Service): PersistedService {
  return {
    id: s.id,
    name: s.name,
    command: s.command,
    args: s.args,
    cwd: s.cwd,
    env: s.env,
    savedCommands: s.savedCommands.map((c) => ({ ...c })),
  };
}

function stripApp(a: AppGroup): PersistedApp {
  return {
    id: a.id,
    name: a.name,
    collapsed: a.collapsed ?? false,
    services: a.services.map(stripService),
  };
}

function hydrateGroup(g: PersistedGroup): TerminalGroup {
  return {
    id: g.id,
    name: g.name,
    serviceIds: g.serviceIds ?? [],
    collapsed: g.collapsed ?? false,
  };
}

function stripGroup(g: TerminalGroup): PersistedGroup {
  return {
    id: g.id,
    name: g.name,
    serviceIds: [...g.serviceIds],
    collapsed: g.collapsed ?? false,
  };
}

function snapshot(): PersistedConfig {
  return {
    apps: state.apps.map(stripApp),
    groups: state.groups.map(stripGroup),
  };
}

function scheduleSave() {
  if (!state.loaded) return; // never save before initial load completes
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    configSave(snapshot()).catch((e) => console.error("config save failed:", e));
  }, SAVE_DEBOUNCE_MS);
}

// Kick off the load immediately on module import. The store stays in
// `loaded: false` until this resolves; mutations done before that point
// are not persisted (they shouldn't happen, but the guard is defensive).
configLoad()
  .then((cfg) => {
    setState(
      produce((s) => {
        s.apps = (cfg.apps ?? []).map(hydrateApp);
        s.groups = (cfg.groups ?? []).map(hydrateGroup);
        s.loaded = true;
      }),
    );
  })
  .catch((e) => {
    console.error("config load failed, starting empty:", e);
    setState("loaded", true);
  });

// ── Lookups ────────────────────────────────────────────────────────────────

export function selectService(id: string | null) {
  setState(
    produce((s) => {
      s.selectedServiceId = id;
      if (id) s.selectedGroupId = null;
    }),
  );
}

export function selectGroup(id: string | null) {
  setState(
    produce((s) => {
      s.selectedGroupId = id;
      if (id) s.selectedServiceId = null;
    }),
  );
}

export function findService(id: string): Service | undefined {
  for (const app of state.apps) {
    const svc = app.services.find((s) => s.id === id);
    if (svc) return svc;
  }
  return undefined;
}

export function findApp(id: string) {
  return state.apps.find((a) => a.id === id);
}

export function findPane(
  paneId: string,
): { service: Service; pane: TerminalPane } | undefined {
  for (const app of state.apps) {
    for (const service of app.services) {
      const pane = service.panes.find((p) => p.id === paneId);
      if (pane) return { service, pane };
    }
  }
  return undefined;
}

/**
 * A service has no status of its own — it's whatever its panes are doing.
 * Busy wins over idle so the sidebar dot stays green while anything in the
 * group is still alive.
 */
export function serviceStatus(svc: Service): ServiceStatus {
  const has = (s: ServiceStatus) => svc.panes.some((p) => p.status === s);
  if (has("running")) return "running";
  if (has("starting")) return "starting";
  if (has("stopping")) return "stopping";
  if (has("crashed")) return "crashed";
  return "stopped";
}

export function serviceStatusById(serviceId: string): ServiceStatus {
  const svc = findService(serviceId);
  return svc ? serviceStatus(svc) : "stopped";
}

// ── Mutation helpers ───────────────────────────────────────────────────────

function mutateService(serviceId: string, mutator: (svc: Service) => void) {
  setState(
    produce((s) => {
      for (const app of s.apps) {
        const svc = app.services.find((x) => x.id === serviceId);
        if (svc) {
          mutator(svc);
          return;
        }
      }
    }),
  );
}

function mutatePane(paneId: string, mutator: (pane: TerminalPane, svc: Service) => void) {
  setState(
    produce((s) => {
      for (const app of s.apps) {
        for (const svc of app.services) {
          const pane = svc.panes.find((p) => p.id === paneId);
          if (pane) {
            mutator(pane, svc);
            return;
          }
        }
      }
    }),
  );
}

// ── Panes ──────────────────────────────────────────────────────────────────

function makePane(index: number): TerminalPane {
  return {
    id: crypto.randomUUID(),
    index,
    status: "stopped",
    ptyId: null,
    lastCommand: null,
    flex: 1,
  };
}

/**
 * Return the id of the pane the service's actions should target, creating
 * the first pane if the service has never been opened. Safe to call from an
 * effect — it's a no-op once a pane exists.
 */
export function ensureActivePane(serviceId: string): string | null {
  const svc = findService(serviceId);
  if (!svc) return null;
  if (svc.panes.length > 0) {
    const active = svc.activePaneId;
    if (active && svc.panes.some((p) => p.id === active)) return active;
    const first = svc.panes[0].id;
    mutateService(serviceId, (s) => {
      s.activePaneId = first;
    });
    return first;
  }
  const pane = makePane(1);
  mutateService(serviceId, (s) => {
    s.panes.push(pane);
    s.activePaneId = pane.id;
  });
  return pane.id;
}

/** Split: add a sibling pane next to the existing ones and focus it. */
export function addPane(serviceId: string): string | null {
  const svc = findService(serviceId);
  if (!svc) return null;
  const nextIndex = svc.panes.reduce((max, p) => Math.max(max, p.index), 0) + 1;
  const pane = makePane(nextIndex);
  mutateService(serviceId, (s) => {
    s.panes.push(pane);
    s.activePaneId = pane.id;
  });
  return pane.id;
}

export function removePane(paneId: string) {
  setState(
    produce((s) => {
      for (const app of s.apps) {
        for (const svc of app.services) {
          const idx = svc.panes.findIndex((p) => p.id === paneId);
          if (idx === -1) continue;
          svc.panes.splice(idx, 1);
          // Renumber so the labels stay 1..n, the way VS Code does it.
          svc.panes.forEach((p, i) => {
            p.index = i + 1;
          });
          if (svc.activePaneId === paneId) {
            const fallback = svc.panes[Math.min(idx, svc.panes.length - 1)];
            svc.activePaneId = fallback?.id ?? null;
          }
          return;
        }
      }
    }),
  );
}

export function setActivePane(paneId: string) {
  mutatePane(paneId, (_pane, svc) => {
    svc.activePaneId = paneId;
  });
}

export function setPaneStatus(paneId: string, status: ServiceStatus) {
  mutatePane(paneId, (p) => {
    p.status = status;
  });
}

export function setPanePtyId(paneId: string, ptyId: string | null) {
  mutatePane(paneId, (p) => {
    p.ptyId = ptyId;
  });
}

export function setPaneLastCommand(paneId: string, command: string | null) {
  mutatePane(paneId, (p) => {
    p.lastCommand = command;
  });
}

/** Divider drag — write back the whole row of weights in one pass. */
export function setPaneFlexes(serviceId: string, flexes: number[]) {
  mutateService(serviceId, (svc) => {
    svc.panes.forEach((pane, i) => {
      if (flexes[i] !== undefined) pane.flex = flexes[i];
    });
  });
}

// ── Apps & services ────────────────────────────────────────────────────────

export function addApp(name: string): string {
  const id = crypto.randomUUID();
  setState(
    produce((s) => {
      s.apps.push({ id, name, services: [] });
    }),
  );
  scheduleSave();
  return id;
}

export function renameApp(appId: string, name: string) {
  setState(
    produce((s) => {
      const app = s.apps.find((a) => a.id === appId);
      if (app) app.name = name;
    }),
  );
  scheduleSave();
}

export function deleteApp(appId: string) {
  setState(
    produce((s) => {
      const idx = s.apps.findIndex((a) => a.id === appId);
      if (idx === -1) return;
      const [removed] = s.apps.splice(idx, 1);
      if (!removed) return;
      if (removed.services.some((sv) => sv.id === s.selectedServiceId)) {
        s.selectedServiceId = null;
      }
      dropServiceFromGroups(s, new Set(removed.services.map((sv) => sv.id)));
    }),
  );
  scheduleSave();
}

// `env` is still on the model (and still persisted) but no longer edited in
// the UI — projects here carry a .env file instead. Editing a service leaves
// whatever was already stored untouched.
export type ServiceDraft = Pick<
  Service,
  "name" | "command" | "args" | "cwd" | "savedCommands"
>;

/** Ids are minted here so the dialog can work with plain label/command pairs. */
export function makeSavedCommand(label: string, command: string): SavedCommand {
  return { id: crypto.randomUUID(), label, command };
}

export function addService(appId: string, draft: ServiceDraft): string {
  const id = crypto.randomUUID();
  setState(
    produce((s) => {
      const app = s.apps.find((a) => a.id === appId);
      if (!app) return;
      app.services.push({ ...draft, id, env: {}, panes: [], activePaneId: null });
      app.collapsed = false;
    }),
  );
  scheduleSave();
  return id;
}

export function updateService(serviceId: string, draft: ServiceDraft) {
  mutateService(serviceId, (svc) => {
    svc.name = draft.name;
    svc.command = draft.command;
    svc.args = draft.args;
    svc.cwd = draft.cwd;
    svc.savedCommands = draft.savedCommands;
  });
  scheduleSave();
}

// ── Groups ─────────────────────────────────────────────────────────────────

export function findGroup(id: string): TerminalGroup | undefined {
  return state.groups.find((g) => g.id === id);
}

/**
 * Members resolved to live services, in the group's own order. Ids that no
 * longer resolve are dropped so a deleted service can't break the view.
 */
export function groupServices(group: TerminalGroup): Service[] {
  const out: Service[] = [];
  for (const id of group.serviceIds) {
    const svc = findService(id);
    if (svc) out.push(svc);
  }
  return out;
}

export function groupStatus(group: TerminalGroup): ServiceStatus {
  const members = groupServices(group);
  const has = (s: ServiceStatus) => members.some((svc) => serviceStatus(svc) === s);
  if (has("running")) return "running";
  if (has("starting")) return "starting";
  if (has("stopping")) return "stopping";
  if (has("crashed")) return "crashed";
  return "stopped";
}

function mutateGroup(groupId: string, mutator: (group: TerminalGroup) => void) {
  setState(
    produce((s) => {
      const group = s.groups.find((g) => g.id === groupId);
      if (group) mutator(group);
    }),
  );
}

export function addGroup(name: string, serviceIds: string[] = []): string {
  const id = crypto.randomUUID();
  setState(
    produce((s) => {
      s.groups.push({ id, name, serviceIds: [...serviceIds], collapsed: false });
    }),
  );
  scheduleSave();
  return id;
}

export function updateGroup(groupId: string, name: string, serviceIds: string[]) {
  mutateGroup(groupId, (g) => {
    g.name = name;
    g.serviceIds = [...serviceIds];
  });
  scheduleSave();
}

export function deleteGroup(groupId: string) {
  setState(
    produce((s) => {
      const idx = s.groups.findIndex((g) => g.id === groupId);
      if (idx === -1) return;
      s.groups.splice(idx, 1);
      if (s.selectedGroupId === groupId) s.selectedGroupId = null;
    }),
  );
  scheduleSave();
}

export function toggleGroupCollapsed(groupId: string) {
  mutateGroup(groupId, (g) => {
    g.collapsed = !g.collapsed;
  });
  scheduleSave();
}

export function addServiceToGroup(groupId: string, serviceId: string) {
  mutateGroup(groupId, (g) => {
    if (!g.serviceIds.includes(serviceId)) g.serviceIds.push(serviceId);
  });
  scheduleSave();
}

export function removeServiceFromGroup(groupId: string, serviceId: string) {
  mutateGroup(groupId, (g) => {
    const idx = g.serviceIds.indexOf(serviceId);
    if (idx !== -1) g.serviceIds.splice(idx, 1);
  });
  scheduleSave();
}

export function moveGroup(groupId: string, targetGroupId: string, edge: DropEdge) {
  if (groupId === targetGroupId) return;
  setState(
    produce((s) => {
      const from = s.groups.findIndex((g) => g.id === groupId);
      if (from === -1) return;
      const [moved] = s.groups.splice(from, 1);
      const target = s.groups.findIndex((g) => g.id === targetGroupId);
      if (target === -1) {
        s.groups.splice(from, 0, moved);
        return;
      }
      s.groups.splice(edge === "before" ? target : target + 1, 0, moved);
    }),
  );
  scheduleSave();
}

/** Reorder a member inside its group — this is the tile order too. */
export function moveGroupMember(
  groupId: string,
  serviceId: string,
  targetServiceId: string,
  edge: DropEdge,
) {
  if (serviceId === targetServiceId) return;
  mutateGroup(groupId, (g) => {
    const from = g.serviceIds.indexOf(serviceId);
    if (from === -1) return;
    g.serviceIds.splice(from, 1);
    const ti = g.serviceIds.indexOf(targetServiceId);
    if (ti === -1) g.serviceIds.splice(from, 0, serviceId);
    else g.serviceIds.splice(edge === "before" ? ti : ti + 1, 0, serviceId);
  });
  scheduleSave();
}

function dropServiceFromGroups(s: AppsState, serviceIds: Set<string>) {
  for (const group of s.groups) {
    group.serviceIds = group.serviceIds.filter((id) => !serviceIds.has(id));
  }
}

// ── Reordering (drag & drop) ───────────────────────────────────────────────

export type DropEdge = "before" | "after";

export function moveApp(appId: string, targetAppId: string, edge: DropEdge) {
  if (appId === targetAppId) return;
  setState(
    produce((s) => {
      const from = s.apps.findIndex((a) => a.id === appId);
      if (from === -1) return;
      const [moved] = s.apps.splice(from, 1);
      // Recompute after the removal — the target may have shifted left.
      const target = s.apps.findIndex((a) => a.id === targetAppId);
      if (target === -1) {
        s.apps.splice(from, 0, moved);
        return;
      }
      s.apps.splice(edge === "before" ? target : target + 1, 0, moved);
    }),
  );
  scheduleSave();
}

/** Reorder within an app, or move to a different one. */
export function moveService(
  serviceId: string,
  targetAppId: string,
  targetServiceId: string | null,
  edge: DropEdge,
) {
  if (serviceId === targetServiceId) return;
  setState(
    produce((s) => {
      let moved: Service | undefined;
      for (const app of s.apps) {
        const idx = app.services.findIndex((x) => x.id === serviceId);
        if (idx !== -1) {
          [moved] = app.services.splice(idx, 1);
          break;
        }
      }
      if (!moved) return;

      const target = s.apps.find((a) => a.id === targetAppId);
      if (!target) return;
      target.collapsed = false;

      if (!targetServiceId) {
        target.services.push(moved);
        return;
      }
      const ti = target.services.findIndex((x) => x.id === targetServiceId);
      if (ti === -1) target.services.push(moved);
      else target.services.splice(edge === "before" ? ti : ti + 1, 0, moved);
    }),
  );
  scheduleSave();
}

/** Reorder split terminals inside their own service. */
export function movePane(paneId: string, targetPaneId: string, edge: DropEdge) {
  if (paneId === targetPaneId) return;
  setState(
    produce((s) => {
      for (const app of s.apps) {
        for (const svc of app.services) {
          const from = svc.panes.findIndex((p) => p.id === paneId);
          if (from === -1) continue;
          if (!svc.panes.some((p) => p.id === targetPaneId)) return;

          const [moved] = svc.panes.splice(from, 1);
          const ti = svc.panes.findIndex((p) => p.id === targetPaneId);
          svc.panes.splice(edge === "before" ? ti : ti + 1, 0, moved);
          svc.panes.forEach((p, i) => {
            p.index = i + 1;
          });
          return;
        }
      }
    }),
  );
}

export function deleteService(serviceId: string) {
  setState(
    produce((s) => {
      for (const app of s.apps) {
        const idx = app.services.findIndex((x) => x.id === serviceId);
        if (idx !== -1) {
          app.services.splice(idx, 1);
          if (s.selectedServiceId === serviceId) s.selectedServiceId = null;
          dropServiceFromGroups(s, new Set([serviceId]));
          return;
        }
      }
    }),
  );
  scheduleSave();
}

export function toggleAppCollapsed(appId: string) {
  setState(
    produce((s) => {
      const app = s.apps.find((a) => a.id === appId);
      if (app) app.collapsed = !app.collapsed;
    }),
  );
  scheduleSave();
}
