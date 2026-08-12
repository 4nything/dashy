import { Dialog } from "@kobalte/core/dialog";
import { createEffect, createMemo, createSignal } from "solid-js";
import { addApp, findApp, renameApp } from "../stores/apps.store";

export type AppDialogTarget =
  | { kind: "add" }
  | { kind: "edit"; appId: string }
  | null;

interface AppDialogProps {
  target: AppDialogTarget;
  onClose: () => void;
}

export function AppDialog(props: AppDialogProps) {
  const [name, setName] = createSignal("");

  const open = createMemo(() => props.target !== null);
  const isEdit = createMemo(() => props.target?.kind === "edit");

  createEffect(() => {
    const t = props.target;
    if (!t) return;
    if (t.kind === "edit") {
      const app = findApp(t.appId);
      if (app) setName(app.name);
    } else {
      setName("");
    }
  });

  function close() {
    setName("");
    props.onClose();
  }

  function submit(e: Event) {
    e.preventDefault();
    const trimmed = name().trim();
    if (!trimmed) return;
    const t = props.target;
    if (!t) return;
    if (t.kind === "add") addApp(trimmed);
    else renameApp(t.appId, trimmed);
    close();
  }

  return (
    <Dialog open={open()} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
        <div class="fixed inset-0 z-50 grid place-items-center pointer-events-none">
          <Dialog.Content class="pointer-events-auto w-[420px] surface p-5 shadow-2xl">
            <Dialog.Title class="text-base font-semibold mb-1">
              {isEdit() ? "Rename App" : "Add App"}
            </Dialog.Title>
            <Dialog.Description class="text-xs text-[var(--color-text-dim)] mb-4">
              {isEdit()
                ? "Change the display name of this app group."
                : "Group services together (e.g. all of Safeguard's processes)."}
            </Dialog.Description>
            <form onSubmit={submit}>
              <label class="block text-xs text-[var(--color-text-dim)] mb-1.5">Name</label>
              <input
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="e.g. Safeguard"
                autofocus
                class="w-full px-3 py-2 rounded-xl bg-[var(--color-bg-3)] border border-[var(--color-border-strong)] text-[13px] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-bg)] transition-colors"
              />
              <div class="flex justify-end gap-2 mt-5">
                <button
                  type="button"
                  onClick={close}
                  class="btn-secondary px-3.5 h-8 text-[13px] rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name().trim()}
                  class="btn-primary px-3.5 h-8 text-[13px] rounded-xl"
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
