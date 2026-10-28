import { Dialog } from "@kobalte/core/dialog";
import { CheckIcon } from "@squidlab/phosphor-solid/check";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { addGroup, appsStore, findGroup, updateGroup } from "../stores/apps.store";

export type GroupDialogTarget =
  | { kind: "add" }
  | { kind: "edit"; groupId: string }
  | null;

interface GroupDialogProps {
  target: GroupDialogTarget;
  onClose: () => void;
}

export function GroupDialog(props: GroupDialogProps) {
  const [name, setName] = createSignal("");
  const [picked, setPicked] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string | null>(null);

  const open = createMemo(() => props.target !== null);
  const isEdit = createMemo(() => props.target?.kind === "edit");

  createEffect(() => {
    const t = props.target;
    if (!t) return;
    if (t.kind === "edit") {
      const group = findGroup(t.groupId);
      if (group) {
        setName(group.name);
        setPicked([...group.serviceIds]);
      }
    } else {
      setName("");
      setPicked([]);
    }
    setError(null);
  });

  // Selection order is the tile order, so appending rather than rebuilding
  // the list keeps the user's arrangement intact.
  function toggle(serviceId: string) {
    setPicked((current) =>
      current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : [...current, serviceId],
    );
  }

  function submit(e: Event) {
    e.preventDefault();
    const trimmed = name().trim();
    if (!trimmed) return setError("Name is required");
    if (picked().length === 0) return setError("Pick at least one service");

    const t = props.target;
    if (!t) return;
    if (t.kind === "add") addGroup(trimmed, picked());
    else updateGroup(t.groupId, trimmed, picked());
    props.onClose();
  }

  const hasServices = createMemo(() =>
    appsStore.apps.some((app) => app.services.length > 0),
  );

  return (
    <Dialog open={open()} onOpenChange={(o) => !o && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/65" />
        <div class="fixed inset-0 z-50 grid place-items-center pointer-events-none">
          <Dialog.Content class="pointer-events-auto w-[520px] max-h-[85vh] flex flex-col surface p-5 shadow-2xl">
            <Dialog.Title class="text-base font-semibold mb-1">
              {isEdit() ? "Edit Group" : "New Group"}
            </Dialog.Title>
            <Dialog.Description class="text-xs text-[var(--color-text-dim)] mb-4">
              Pick the services you want to run and watch side by side.
            </Dialog.Description>

            <form onSubmit={submit} class="flex flex-col gap-4 min-h-0 flex-1">
              <label class="block shrink-0">
                <span class="block text-xs text-[var(--color-text-dim)] mb-1.5">Name</span>
                <input
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  placeholder="Local dev"
                  autofocus
                  class={inputClass}
                />
              </label>

              <div class="flex flex-col min-h-0 flex-1">
                <span class="block text-xs text-[var(--color-text-dim)] mb-1.5 shrink-0">
                  Services{" "}
                  <Show when={picked().length > 0}>
                    <span class="text-[var(--color-text-faint)]">
                      · {picked().length} selected
                    </span>
                  </Show>
                </span>

                <Show
                  when={hasServices()}
                  fallback={
                    <p class="text-xs text-[var(--color-text-faint)] italic py-4">
                      No services yet — add one to an app first.
                    </p>
                  }
                >
                  <div class="picker-list">
                    <For each={appsStore.apps}>
                      {(app) => (
                        <Show when={app.services.length > 0}>
                          <div class="mb-2 last:mb-0">
                            <p class="px-1 pb-1 text-[10px] uppercase tracking-[0.09em] font-semibold text-[var(--color-text-faint)]">
                              {app.name}
                            </p>
                            <For each={app.services}>
                              {(svc) => {
                                const on = () => picked().includes(svc.id);
                                return (
                                  <button
                                    type="button"
                                    onClick={() => toggle(svc.id)}
                                    class="picker-row"
                                    data-on={on()}
                                  >
                                    <span class="picker-box">
                                      <Show when={on()}>
                                        <CheckIcon size={10} weight="bold" />
                                      </Show>
                                    </span>
                                    <span class="text-[13px] truncate">{svc.name}</span>
                                    <span class="ml-auto text-[10.5px] font-mono text-[var(--color-text-faint)] truncate max-w-[45%]">
                                      {svc.command} {svc.args.join(" ")}
                                    </span>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </Show>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <Show when={error()}>
                {(msg) => <p class="text-xs text-[var(--color-danger)] shrink-0">{msg()}</p>}
              </Show>

              <div class="flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={props.onClose}
                  class="btn-secondary px-3.5 h-8 text-[13px] rounded-xl"
                >
                  Cancel
                </button>
                <button type="submit" class="btn-primary px-3.5 h-8 text-[13px] rounded-xl">
                  {isEdit() ? "Save" : "Create"}
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
