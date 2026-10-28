import { Popover } from "@kobalte/core/popover";
import { MinusIcon } from "@squidlab/phosphor-solid/minus";
import { PlusIcon } from "@squidlab/phosphor-solid/plus";
import { TextAaIcon } from "@squidlab/phosphor-solid/text-aa";
import { For } from "solid-js";
import {
  TERM_FONTS,
  TERM_FONT_SIZE_MAX,
  TERM_FONT_SIZE_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  nudgeTerminalFontSize,
  nudgeZoom,
  resetZoom,
  setTerminalFontCustom,
  setTerminalFontIndex,
  uiStore,
} from "../stores/ui.store";

/**
 * Text size and terminal font, in the title bar. Two separate sizes on
 * purpose: the zoom scales the whole app (chrome included), and the terminal
 * keeps its own size on top of that so logs can sit denser than the UI.
 */
export function AppearanceMenu() {
  return (
    <Popover placement="bottom-end" gutter={4}>
      <Popover.Trigger
        title="Text size & terminal font"
        class="size-7 grid place-items-center rounded-md btn-ghost"
      >
        <TextAaIcon size={15} weight="bold" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="menu-surface w-[244px] p-3 flex flex-col gap-3">
          <Stepper
            label="Text size"
            value={`${Math.round(uiStore.zoom * 100)}%`}
            hint="Ctrl + / Ctrl −"
            onDec={() => nudgeZoom(-1)}
            onInc={() => nudgeZoom(1)}
            decDisabled={uiStore.zoom <= ZOOM_MIN}
            incDisabled={uiStore.zoom >= ZOOM_MAX}
            onReset={uiStore.zoom === 1 ? undefined : resetZoom}
          />

          <Stepper
            label="Terminal size"
            value={`${uiStore.termFontSize}px`}
            onDec={() => nudgeTerminalFontSize(-1)}
            onInc={() => nudgeTerminalFontSize(1)}
            decDisabled={uiStore.termFontSize <= TERM_FONT_SIZE_MIN}
            incDisabled={uiStore.termFontSize >= TERM_FONT_SIZE_MAX}
          />

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] text-[var(--color-text-dim)]">
              Terminal font
            </span>
            <For each={TERM_FONTS}>
              {(font, i) => (
                <button
                  type="button"
                  onClick={() => setTerminalFontIndex(i())}
                  data-on={!uiStore.termFontCustom.trim() && uiStore.termFontIndex === i()}
                  class="font-row"
                  style={{ "font-family": `${font.stack}, monospace` }}
                >
                  {font.label}
                </button>
              )}
            </For>
            <input
              type="text"
              value={uiStore.termFontCustom}
              onInput={(e) => setTerminalFontCustom(e.currentTarget.value)}
              placeholder="Any installed font…"
              spellcheck={false}
              class="w-full px-2 h-7 rounded-md bg-[var(--color-bg-3)] text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <p class="text-[10px] text-[var(--color-text-faint)] leading-snug">
              Monospaced only — a proportional font makes every column in the
              output wander.
            </p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

interface StepperProps {
  label: string;
  value: string;
  hint?: string;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
  onReset?: () => void;
}

function Stepper(props: StepperProps) {
  return (
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[11px] text-[var(--color-text-dim)] truncate">
          {props.label}
        </div>
        {props.hint && (
          <div class="text-[10px] text-[var(--color-text-faint)]">{props.hint}</div>
        )}
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={props.onDec}
          disabled={props.decDisabled}
          class="size-6 grid place-items-center rounded-md btn-ghost"
        >
          <MinusIcon size={11} weight="bold" />
        </button>
        <button
          type="button"
          onClick={() => props.onReset?.()}
          disabled={!props.onReset}
          title={props.onReset ? "Reset" : undefined}
          class="min-w-[44px] h-6 px-1 grid place-items-center rounded-md text-[11px] font-mono tabular-nums btn-ghost disabled:opacity-100 disabled:cursor-default"
        >
          {props.value}
        </button>
        <button
          type="button"
          onClick={props.onInc}
          disabled={props.incDisabled}
          class="size-6 grid place-items-center rounded-md btn-ghost"
        >
          <PlusIcon size={11} weight="bold" />
        </button>
      </div>
    </div>
  );
}
