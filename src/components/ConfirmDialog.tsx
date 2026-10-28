import { AlertDialog } from "@kobalte/core/alert-dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <AlertDialog open={props.open} onOpenChange={(o) => !o && props.onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay class="fixed inset-0 z-40 bg-black/65" />
        <div class="fixed inset-0 z-50 grid place-items-center pointer-events-none">
          <AlertDialog.Content class="pointer-events-auto w-[420px] surface p-5 shadow-2xl">
            <AlertDialog.Title class="text-base font-semibold mb-1">
              {props.title}
            </AlertDialog.Title>
            <AlertDialog.Description class="text-sm text-[var(--color-text-dim)] mb-5">
              {props.description}
            </AlertDialog.Description>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                onClick={props.onCancel}
                class="btn-secondary px-3.5 h-8 text-[13px] rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={props.onConfirm}
                class={
                  props.destructive
                    ? "px-3.5 h-8 text-[13px] rounded-xl bg-[var(--color-danger)] text-white hover:bg-[#dc2626] active:scale-[0.97] transition"
                    : "btn-primary px-3.5 h-8 text-[13px] rounded-xl"
                }
              >
                {props.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog>
  );
}
