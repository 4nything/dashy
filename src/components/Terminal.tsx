import { ArrowLineDownIcon } from "@squidlab/phosphor-solid/arrow-line-down";
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
  attachPane,
  detachPane,
  getPaneTerminal,
  isAtBottom,
  refitPane,
} from "../services/terminal-manager";
import { ensurePaneShell } from "../services/service-runner";

interface TerminalPaneViewProps {
  paneId: string;
}

export function TerminalPaneView(props: TerminalPaneViewProps) {
  let host!: HTMLDivElement;
  let resizeObserver: ResizeObserver | undefined;
  // True when this pane's viewport is at the latest line. Drives the
  // floating "jump to bottom" button: hidden at bottom, shown when the user
  // has scrolled up into the scrollback.
  const [atBottom, setAtBottom] = createSignal(true);

  onMount(() => {
    resizeObserver = new ResizeObserver(() => refitPane(props.paneId));
    resizeObserver.observe(host);
  });

  createEffect(() => {
    const id = props.paneId;
    attachPane(id, host);

    ensurePaneShell(id).catch((e) => console.error("ensurePaneShell failed:", e));

    const entry = getPaneTerminal(id);
    const checkBottom = () => setAtBottom(isAtBottom(id));
    checkBottom();
    // attachPane restores the scroll position on the next frame; re-read it
    // afterwards so the button doesn't flash on a stale reading.
    requestAnimationFrame(checkBottom);
    const offScroll = entry.term.onScroll(checkBottom);

    onCleanup(() => {
      offScroll.dispose();
      detachPane(id, host);
    });
  });

  onCleanup(() => resizeObserver?.disconnect());

  function scrollToBottom() {
    getPaneTerminal(props.paneId).term.scrollToBottom();
    setAtBottom(true);
  }

  return (
    <div class="relative h-full w-full">
      <div ref={host} class="terminal-host" />
      <Show when={!atBottom()}>
        <button
          type="button"
          onClick={scrollToBottom}
          title="Jump to bottom"
          class="jump-latest"
        >
          <ArrowLineDownIcon size={12} weight="bold" />
          Latest
        </button>
      </Show>
    </div>
  );
}
