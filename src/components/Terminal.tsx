import { ArrowLineDownIcon } from "@squidlab/phosphor-solid/arrow-line-down";
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
  attachToHost,
  ensureShell,
  getServiceTerminal,
  parkVisible,
  refitVisible,
} from "../services/terminal-manager";
import {
  findService,
  setServicePtyId,
  setServiceStatus,
} from "../stores/apps.store";

interface TerminalProps {
  serviceId: string;
}

export function TerminalView(props: TerminalProps) {
  let host!: HTMLDivElement;
  let resizeObserver: ResizeObserver | undefined;
  // True when the visible terminal's viewport is at the latest line. Drives
  // the floating "jump to bottom" button: hidden at bottom, shown when the
  // user has scrolled up into the scrollback.
  const [atBottom, setAtBottom] = createSignal(true);

  onMount(() => {
    resizeObserver = new ResizeObserver(() => refitVisible());
    resizeObserver.observe(host);
  });

  // Whenever the selected service changes: attach its xterm to the host,
  // ensure a shell is up, and re-wire the scroll listener so the floating
  // button reflects this terminal's state (not the previous one's).
  createEffect(() => {
    const id = props.serviceId;
    attachToHost(id, host);

    const svc = findService(id);
    if (!svc) return;

    ensureShell(id, svc.cwd, svc.env, (code) => {
      setServicePtyId(id, null);
      setServiceStatus(id, code === 0 ? "stopped" : "crashed");
    })
      .then((ptyId) => setServicePtyId(id, ptyId))
      .catch((e) => console.error("ensureShell failed:", e));

    const entry = getServiceTerminal(id);
    const checkBottom = () => {
      const buf = entry.term.buffer.active;
      setAtBottom(buf.viewportY >= buf.baseY);
    };
    checkBottom();
    const offScroll = entry.term.onScroll(checkBottom);

    onCleanup(() => offScroll.dispose());
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    parkVisible();
  });

  function scrollToBottom() {
    const entry = getServiceTerminal(props.serviceId);
    entry.term.scrollToBottom();
    setAtBottom(true);
  }

  return (
    <div class="relative h-full w-full">
      <div ref={host} class="h-full w-full overflow-hidden p-2" />
      <Show when={!atBottom()}>
        <button
          type="button"
          onClick={scrollToBottom}
          title="Jump to bottom"
          class="absolute bottom-3 right-4 z-10 h-8 px-3 rounded-full bg-[var(--color-bg-3)]/90 backdrop-blur border border-[var(--color-border-strong)] hover:bg-[var(--color-bg-4)] hover:border-[var(--color-text-faint)] flex items-center gap-1.5 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text)] shadow-xl transition-colors"
        >
          <ArrowLineDownIcon size={12} weight="bold" />
          Latest
        </button>
      </Show>
    </div>
  );
}
