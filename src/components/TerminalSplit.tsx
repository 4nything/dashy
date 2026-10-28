import { CircleNotchIcon } from "@squidlab/phosphor-solid/circle-notch";
import { PlayIcon } from "@squidlab/phosphor-solid/play";
import { StopIcon } from "@squidlab/phosphor-solid/stop";
import { XIcon } from "@squidlab/phosphor-solid/x";
import { For, Show } from "solid-js";
import { setActivePane, setPaneFlexes } from "../stores/apps.store";
import { closePane, startPane, stopPane } from "../services/service-runner";
import { focusPane } from "../services/terminal-manager";
import type { Service, TerminalPane } from "../types";
import { statusDotClass } from "./status";
import { TerminalPaneView } from "./Terminal";

/** Smallest share of the row a pane can be squeezed to. */
const MIN_SHARE = 0.12;

function paneProcessName(pane: TerminalPane): string {
  const cmd = pane.lastCommand?.trim();
  if (!cmd) return "cmd";
  return cmd.split(/\s+/)[0] ?? "cmd";
}

function SplitDivider(props: { onDrag: (deltaPx: number) => void }) {
  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    let lastX = e.clientX;
    const move = (ev: PointerEvent) => {
      props.onDrag(ev.clientX - lastX);
      lastX = ev.clientX;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
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
      onPointerDown={onPointerDown}
      class="split-divider"
    >
      <span class="split-divider-line" />
    </div>
  );
}

function PaneHeader(props: {
  pane: TerminalPane;
  active: boolean;
  canClose: boolean;
}) {
  const busy = () =>
    props.pane.status === "starting" || props.pane.status === "stopping";
  const running = () => props.pane.status === "running";

  return (
    <div class="flex items-center gap-2 px-3 h-8 shrink-0">
      <span class={statusDotClass(props.pane.status)} style={{ width: "6px", height: "6px" }} />
      <span
        class={`text-[11px] font-medium tracking-tight truncate ${
          props.active ? "text-[var(--color-text)]" : "text-[var(--color-text-dim)]"
        }`}
      >
        {props.pane.index}: {paneProcessName(props.pane)}
      </span>
      <Show when={props.pane.lastCommand}>
        {(cmd) => (
          <span class="text-[10.5px] font-mono text-[var(--color-text-faint)] truncate min-w-0">
            {cmd()}
          </span>
        )}
      </Show>

      <div class="ml-auto flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (running()) stopPane(props.pane.id);
            else if (!busy()) startPane(props.pane.id);
          }}
          disabled={busy()}
          title={running() ? "Stop this terminal" : "Run the service command here"}
          class="size-6 grid place-items-center rounded-lg btn-ghost"
        >
          <Show
            when={busy()}
            fallback={
              running() ? (
                <StopIcon size={10} weight="fill" />
              ) : (
                <PlayIcon size={10} weight="fill" />
              )
            }
          >
            <CircleNotchIcon size={10} weight="bold" class="animate-spin" />
          </Show>
        </button>
        <Show when={props.canClose}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              closePane(props.pane.id);
            }}
            title="Close terminal"
            class="size-6 grid place-items-center rounded-lg btn-ghost"
          >
            <XIcon size={11} weight="bold" />
          </button>
        </Show>
      </div>
    </div>
  );
}

/**
 * A service's terminals laid out side by side, VS Code style. Dividers
 * redistribute flex weight between neighbours; clicking a pane makes it the
 * target of the header's Start / Stop / Restart buttons.
 */
export function TerminalSplit(props: { service: Service }) {
  let container!: HTMLDivElement;

  const panes = () => props.service.panes;
  const isSplit = () => panes().length > 1;

  function dragDivider(index: number, deltaPx: number) {
    const list = props.service.panes;
    const width = container.getBoundingClientRect().width;
    if (width <= 0 || index < 1 || index >= list.length) return;

    const flexes = list.map((p) => p.flex);
    const total = flexes.reduce((sum, f) => sum + f, 0);
    const min = total * MIN_SHARE;
    const left = flexes[index - 1];
    const right = flexes[index];

    // px → flex, then clamp so neither neighbour collapses.
    const raw = (deltaPx * total) / width;
    const delta = Math.max(min - left, Math.min(right - min, raw));

    flexes[index - 1] = left + delta;
    flexes[index] = right - delta;
    setPaneFlexes(props.service.id, flexes);
  }

  function activate(paneId: string) {
    setActivePane(paneId);
    focusPane(paneId);
  }

  return (
    <div ref={container} class="h-full w-full flex items-stretch">
      <For each={panes()}>
        {(pane, i) => (
          <>
            <Show when={i() > 0}>
              <SplitDivider onDrag={(d) => dragDivider(i(), d)} />
            </Show>
            <div
              onPointerDown={() => activate(pane.id)}
              onFocusIn={() => activate(pane.id)}
              style={{ flex: `${pane.flex} 1 0%` }}
              class={`min-w-0 flex flex-col terminal-frame ${
                isSplit() && props.service.activePaneId === pane.id
                  ? "terminal-frame-active"
                  : ""
              }`}
            >
              <Show when={isSplit()}>
                <PaneHeader
                  pane={pane}
                  active={props.service.activePaneId === pane.id}
                  canClose
                />
              </Show>
              <div class="flex-1 min-h-0">
                <TerminalPaneView paneId={pane.id} />
              </div>
            </div>
          </>
        )}
      </For>
    </div>
  );
}
