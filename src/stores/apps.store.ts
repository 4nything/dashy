import { createStore, produce } from "solid-js/store";
import type { AppGroup, Service, ServiceStatus } from "../types";
import {
  configLoad,
  configSave,
  type PersistedApp,
  type PersistedConfig,
  type PersistedService,
} from "../services/config";

interface AppsState {
  apps: AppGroup[];
  selectedServiceId: string | null;
  loaded: boolean;
}

const [state, setState] = createStore<AppsState>({
  apps: [],
  selectedServiceId: null,
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
    status: "stopped",
    ptyId: null,
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

function snapshot(): PersistedConfig {
  return { apps: state.apps.map(stripApp) };
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
        s.loaded = true;
      }),
    );
  })
  .catch((e) => {
    console.error("config load failed, starting empty:", e);
    setState("loaded", true);
  });

// ── Mutations ──────────────────────────────────────────────────────────────

export function selectService(id: string | null) {
  setState("selectedServiceId", id);
}

export function findService(id: string): Service | undefined {
  for (const app of state.apps) {
    const svc = app.services.find((s) => s.id === id);
    if (svc) return svc;
  }
  return undefined;
}

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

export function setServiceStatus(serviceId: string, status: ServiceStatus) {
  // Runtime-only — not persisted.
  mutateService(serviceId, (s) => {
    s.status = status;
  });
}

export function setServicePtyId(serviceId: string, ptyId: string | null) {
  // Runtime-only — not persisted.
  mutateService(serviceId, (s) => {
    s.ptyId = ptyId;
  });
}

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

export function findApp(id: string) {
  return state.apps.find((a) => a.id === id);
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
      if (removed && removed.services.some((sv) => sv.id === s.selectedServiceId)) {
        s.selectedServiceId = null;
      }
    }),
  );
  scheduleSave();
}

export type ServiceDraft = Pick<Service, "name" | "command" | "args" | "cwd" | "env">;

export function addService(appId: string, draft: ServiceDraft): string {
  const id = crypto.randomUUID();
  setState(
    produce((s) => {
      const app = s.apps.find((a) => a.id === appId);
      if (!app) return;
      app.services.push({
        ...draft,
        id,
        status: "stopped",
        ptyId: null,
      });
      app.collapsed = false;
    }),
  );
  scheduleSave();
  return id;
}

export function updateService(serviceId: string, draft: ServiceDraft) {
  setState(
    produce((s) => {
      for (const app of s.apps) {
        const svc = app.services.find((x) => x.id === serviceId);
        if (svc) {
          svc.name = draft.name;
          svc.command = draft.command;
          svc.args = draft.args;
          svc.cwd = draft.cwd;
          svc.env = draft.env;
          return;
        }
      }
    }),
  );
  scheduleSave();
}

export function deleteService(serviceId: string) {
  setState(
    produce((s) => {
      for (const app of s.apps) {
        const idx = app.services.findIndex((x) => x.id === serviceId);
        if (idx !== -1) {
          app.services.splice(idx, 1);
          if (s.selectedServiceId === serviceId) s.selectedServiceId = null;
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
