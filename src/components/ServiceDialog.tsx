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

/**
 * The command is one free-text line (`npm run dev`, `docker compose up -d`).
 * It's split into command + args on save so the runner can quote each token,
 * and joined back for editing — the user never deals with two fields.
 */
function splitCommandLine(input: string): { command: string; args: string[] } {
  const tokens = input.trim().match(/"([^"]*)"|\S+/g) ?? [];
  const unquoted = tokens.map((t) =>
    t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t,
  );
  return { command: unquoted[0] ?? "", args: unquoted.slice(1) };
}

function joinCommandLine(command: string, args: string[]): string {
  return [command, ...args].map((t) => (t.includes(" ") ? `"${t}"` : t)).join(" ");
}

export function ServiceDialog(props: ServiceDialogProps) {
  const [name, setName] = createSignal("");
  const [commandLine, setCommandLine] = createSignal("");
  const [cwd, setCwd] = createSignal("");
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
        setCommandLine(joinCommandLine(svc.command, svc.args));
        setCwd(svc.cwd);
        setError(null);
      }
    } else {
      setName("");
      setCommandLine("");
      setCwd("");
      setError(null);
    }
  });

  function close() {
    props.onClose();
  }

  async function pickCwd() {
    try {
      const picked = await openDialog({ multiple: false, directory: true });
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
    const trimmedCwd = cwd().trim();
    const { command, args } = splitCommandLine(commandLine());

    if (!trimmedName) return setError("Name is required");
    if (!command) return setError("Command is required");
    if (!trimmedCwd) return setError("Working directory is required");

    const draft: ServiceDraft = { name: trimmedName, command, args, cwd: trimmedCwd };

    if (target.kind === "add") addService(target.appId, draft);
    else updateService(target.serviceId, draft);

    close();
  }

  return (
    <Dialog open={open()} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
        <div class="fixed inset-0 z-50 grid place-items-center pointer-events-none">
          <Dialog.Content class="pointer-events-auto w-[520px] surface p-5 shadow-2xl">
            <Dialog.Title class="text-base font-semibold mb-1">
              {isEdit() ? "Edit Service" : "Add Service"}
            </Dialog.Title>
            <Dialog.Description class="text-xs text-[var(--color-text-dim)] mb-4">
              {isEdit()
                ? "Changes apply the next time you start it."
                : "Define how this service starts. The command runs with a real PTY."}
            </Dialog.Description>

            <form onSubmit={submit} class="flex flex-col gap-4">
              <Field label="Name">
                <input
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  placeholder="api"
                  autofocus
                  class={inputClass}
                />
              </Field>

              <Field label="Command">
                <input
                  type="text"
                  value={commandLine()}
                  onInput={(e) => setCommandLine(e.currentTarget.value)}
                  placeholder="npm run dev"
                  spellcheck={false}
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
                    spellcheck={false}
                    class={`${inputClass} flex-1 font-mono`}
                  />
                  <button type="button" onClick={pickCwd} class={browseClass}>
                    Browse…
                  </button>
                </div>
              </Field>

              <Show when={error()}>
                {(msg) => <p class="text-xs text-[var(--color-danger)]">{msg()}</p>}
              </Show>

              <div class="flex justify-end gap-2 mt-1">
                <button
                  type="button"
                  onClick={close}
                  class="btn-secondary px-3.5 h-8 text-[13px] rounded-xl"
                >
                  Cancel
                </button>
                <button type="submit" class="btn-primary px-3.5 h-8 text-[13px] rounded-xl">
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
  "w-full px-3 py-2 rounded-xl bg-[var(--color-bg-3)] border border-[var(--color-border-strong)] text-[13px] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-bg)] transition-colors";

const browseClass =
  "px-3 h-9 text-[13px] rounded-xl bg-[var(--color-bg-3)] border border-[var(--color-border-strong)] hover:bg-[var(--color-bg-4)] hover:border-[var(--color-text-faint)] shrink-0 transition-colors";

function Field(props: { label: string; children: any }) {
  return (
    <label class="block">
      <span class="block text-xs text-[var(--color-text-dim)] mb-1.5">{props.label}</span>
      {props.children}
    </label>
  );
}
