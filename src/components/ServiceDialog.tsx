import { Dialog } from "@kobalte/core/dialog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Show, createEffect, createMemo, createSignal } from "solid-js";
import {
  addService,
  findService,
  updateService,
  type ServiceDraft,
} from "../stores/apps.store";

export type ServiceDialogTarget =
  | { kind: "add"; appId: string }
  | { kind: "edit"; serviceId: string }
  | null;

interface ServiceDialogProps {
  target: ServiceDialogTarget;
  onClose: () => void;
}

function parseArgs(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const tokens = trimmed.match(/"([^"]*)"|\S+/g) ?? [];
  return tokens.map((t) => (t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t));
}

function stringifyArgs(args: string[]): string {
  return args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
}

function parseEnv(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function stringifyEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function ServiceDialog(props: ServiceDialogProps) {
  const [name, setName] = createSignal("");
  const [command, setCommand] = createSignal("");
  const [args, setArgs] = createSignal("");
  const [cwd, setCwd] = createSignal("");
  const [env, setEnv] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  const open = createMemo(() => props.target !== null);
  const isEdit = createMemo(() => props.target?.kind === "edit");

  // Pre-fill the form when entering edit mode (or reset on add).
  createEffect(() => {
    const t = props.target;
    if (!t) return;
    if (t.kind === "edit") {
      const svc = findService(t.serviceId);
      if (svc) {
        setName(svc.name);
        setCommand(svc.command);
        setArgs(stringifyArgs(svc.args));
        setCwd(svc.cwd);
        setEnv(stringifyEnv(svc.env));
        setError(null);
      }
    } else {
      setName("");
      setCommand("");
      setArgs("");
      setCwd("");
      setEnv("");
      setError(null);
    }
  });

  function close() {
    props.onClose();
  }

  async function pickExecutable() {
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          { name: "Executable", extensions: ["exe", "bat", "cmd", "ps1"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (typeof picked === "string") setCommand(picked);
    } catch (e) {
      console.error("pick executable failed:", e);
    }
  }

  async function pickCwd() {
    try {
      const picked = await openDialog({
        multiple: false,
        directory: true,
      });
      if (typeof picked === "string") setCwd(picked);
    } catch (e) {
      console.error("pick cwd failed:", e);
    }
  }

  function submit(e: Event) {
    e.preventDefault();
    setError(null);

    const target = props.target;
    if (!target) return;

    const trimmedName = name().trim();
    const trimmedCommand = command().trim();
    const trimmedCwd = cwd().trim();

    if (!trimmedName) return setError("Name is required");
    if (!trimmedCommand) return setError("Command is required");
    if (!trimmedCwd) return setError("Working directory is required");

    const draft: ServiceDraft = {
      name: trimmedName,
      command: trimmedCommand,
      args: parseArgs(args()),
      cwd: trimmedCwd,
      env: parseEnv(env()),
    };

    if (target.kind === "add") {
      addService(target.appId, draft);
    } else {
      updateService(target.serviceId, draft);
    }

    close();
  }

  return (
    <Dialog open={open()} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/50" />
        <div class="fixed inset-0 z-50 grid place-items-center pointer-events-none">
          <Dialog.Content class="pointer-events-auto w-[520px] max-h-[90vh] overflow-y-auto surface p-5 shadow-2xl">
            <Dialog.Title class="text-base font-semibold mb-1">
              {isEdit() ? "Edit Service" : "Add Service"}
            </Dialog.Title>
            <Dialog.Description class="text-xs text-[var(--color-text-dim)] mb-4">
              {isEdit()
                ? "Changes apply on the next start. Stop the service first if it's running."
                : "Define how this service starts. The command runs with a real PTY."}
            </Dialog.Description>

            <form onSubmit={submit} class="flex flex-col gap-4">
              <Field label="Name" hint="e.g. api">
                <input
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  autofocus
                  class={inputClass}
                />
              </Field>

              <Field
                label="Command"
                hint="Executable. Type a name in PATH (npm, node, cmd) or browse for an .exe."
              >
                <div class="flex gap-2">
                  <input
                    type="text"
                    value={command()}
                    onInput={(e) => setCommand(e.currentTarget.value)}
                    placeholder="npm  or  C:\path\to\app.exe"
                    class={`${inputClass} flex-1`}
                  />
                  <button type="button" onClick={pickExecutable} class={browseClass}>
                    Browse…
                  </button>
                </div>
              </Field>

              <Field
                label="Arguments"
                hint='Space-separated. Use quotes for spaces: --msg "hello world"'
              >
                <input
                  type="text"
                  value={args()}
                  onInput={(e) => setArgs(e.currentTarget.value)}
                  placeholder="run dev"
                  class={`${inputClass} font-mono`}
                />
              </Field>

              <Field label="Working directory">
                <div class="flex gap-2">
                  <input
                    type="text"
                    value={cwd()}
                    onInput={(e) => setCwd(e.currentTarget.value)}
                    placeholder="C:\path\to\project"
                    class={`${inputClass} flex-1`}
                  />
                  <button type="button" onClick={pickCwd} class={browseClass}>
                    Browse…
                  </button>
                </div>
              </Field>

              <Field label="Environment variables" hint="One per line: KEY=value">
                <textarea
                  value={env()}
                  onInput={(e) => setEnv(e.currentTarget.value)}
                  rows={3}
                  placeholder={"NODE_ENV=development\nPORT=3000"}
                  class={`${inputClass} font-mono resize-y`}
                />
              </Field>

              <Show when={error()}>
                {(msg) => <p class="text-xs text-[var(--color-danger)]">{msg()}</p>}
              </Show>

              <div class="flex justify-end gap-2 mt-1">
                <button
                  type="button"
                  onClick={close}
                  class="btn-secondary px-3.5 h-8 text-[13px] rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="btn-primary px-3.5 h-8 text-[13px] rounded-md"
                >
                  {isEdit() ? "Save" : "Add"}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}

const inputClass =
  "w-full px-3 py-2 rounded-md bg-[var(--color-bg-3)] border border-[var(--color-border-strong)] text-[13px] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-bg)] transition-colors";

const browseClass =
  "px-3 h-9 text-[13px] rounded-md bg-[var(--color-bg-3)] border border-[var(--color-border-strong)] hover:bg-[var(--color-bg-4)] hover:border-[var(--color-text-faint)] shrink-0 transition-colors";

function Field(props: { label: string; hint?: string; children: any }) {
  return (
    <label class="block">
      <span class="block text-xs text-[var(--color-text-dim)] mb-1.5">{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        {(h) => <span class="block text-[10px] text-[var(--color-text-dim)] mt-1">{h()}</span>}
      </Show>
    </label>
  );
}
