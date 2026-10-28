import { Dialog } from "@kobalte/core/dialog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { PlusIcon } from "@squidlab/phosphor-solid/plus";
import { TrashIcon } from "@squidlab/phosphor-solid/trash";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import {
  addService,
  findService,
  makeSavedCommand,
  updateService,
  type ServiceDraft,
} from "../stores/apps.store";
import type { SavedCommand } from "../types";

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
  const [commands, setCommands] = createSignal<SavedCommand[]>([]);
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
        setCommands(svc.savedCommands.map((c) => ({ ...c })));
        setError(null);
      }
    } else {
      setName("");
      setCommandLine("");
      setCwd("");
      setCommands([]);
      setError(null);
    }
  });

  function close() {
    props.onClose();
  }

  function addCommand() {
    setCommands((cs) => [...cs, makeSavedCommand("", "")]);
  }

  function patchCommand(id: string, patch: Partial<SavedCommand>) {
    setCommands((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeCommand(id: string) {
    setCommands((cs) => cs.filter((c) => c.id !== id));
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

    // Rows left blank are just discarded — no reason to make the user clean
    // up after an accidental "+".
    const savedCommands = commands()
      .map((c) => ({ ...c, label: c.label.trim(), command: c.command.trim() }))
      .filter((c) => c.command);

    const draft: ServiceDraft = {
      name: trimmedName,
      command,
      args,
      cwd: trimmedCwd,
      savedCommands,
    };

    if (target.kind === "add") addService(target.appId, draft);
    else updateService(target.serviceId, draft);

    close();
  }

  return (
    <Dialog open={open()} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/65" />
        <div class="fixed inset-0 z-50 grid place-items-center pointer-events-none">
          <Dialog.Content class="pointer-events-auto w-[560px] max-h-[88vh] overflow-y-auto surface p-5 shadow-2xl">
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

              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-xs text-[var(--color-text-dim)]">
                    Saved commands
                  </span>
                  <button
                    type="button"
                    onClick={addCommand}
                    class="btn-ghost h-6 px-2 rounded-md text-[11px] flex items-center gap-1"
                  >
                    <PlusIcon size={10} weight="bold" />
                    Add
                  </button>
                </div>
                <Show
                  when={commands().length > 0}
                  fallback={
                    <p class="text-[11px] text-[var(--color-text-faint)]">
                      Extra command lines for this service — migrations, a build
                      with a specific flag. They show up as buttons above the
                      terminal.
                    </p>
                  }
                >
                  <div class="flex flex-col gap-1.5">
                    <For each={commands()}>
                      {(cmd) => (
                        <div class="flex gap-1.5">
                          <input
                            type="text"
                            value={cmd.label}
                            onInput={(e) =>
                              patchCommand(cmd.id, { label: e.currentTarget.value })
                            }
                            placeholder="migrate"
                            class={`${inputClass} w-[32%]`}
                          />
                          <input
                            type="text"
                            value={cmd.command}
                            onInput={(e) =>
                              patchCommand(cmd.id, { command: e.currentTarget.value })
                            }
                            placeholder="npm run migrate -- --env=dev"
                            spellcheck={false}
                            class={`${inputClass} flex-1 font-mono`}
                          />
                          <button
                            type="button"
                            onClick={() => removeCommand(cmd.id)}
                            title="Remove"
                            class="btn-ghost size-9 grid place-items-center rounded-md shrink-0"
                          >
                            <TrashIcon size={13} weight="bold" />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

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
  "w-full px-3 py-2 rounded-xl bg-[var(--color-bg-3)] text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] transition-colors";

const browseClass =
  "px-3 h-9 text-[13px] rounded-xl bg-[var(--color-bg-3)] hover:bg-[var(--color-bg-4)] shrink-0 transition-colors";

function Field(props: { label: string; children: any }) {
  return (
    <label class="block">
      <span class="block text-xs text-[var(--color-text-dim)] mb-1.5">{props.label}</span>
      {props.children}
    </label>
  );
}
