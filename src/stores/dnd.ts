import { createSignal } from "solid-js";
import type { DropEdge } from "./apps.store";

// Shared state for sidebar drag & drop. Kept out of the components so the
// dragged row and the row being hovered — which are siblings at best — can
// see each other without prop drilling.

export type DragItem =
  | { kind: "app"; appId: string }
  | { kind: "service"; serviceId: string }
  | { kind: "pane"; paneId: string }
  | { kind: "group"; groupId: string }
  /** A service *inside* a group — reordering here only changes tile order. */
  | { kind: "member"; groupId: string; serviceId: string };

export interface DropIndicator {
  /** id of the row being hovered (app / service / pane). */
  id: string;
  edge: DropEdge;
}

const [dragItem, setDragItem] = createSignal<DragItem | null>(null);
const [dropIndicator, setDropIndicator] = createSignal<DropIndicator | null>(null);

export { dragItem, dropIndicator };

export function beginDrag(item: DragItem) {
  setDragItem(item);
}

export function endDrag() {
  setDragItem(null);
  setDropIndicator(null);
}

export function hoverDrop(id: string, edge: DropEdge) {
  const current = dropIndicator();
  if (current?.id === id && current.edge === edge) return;
  setDropIndicator({ id, edge });
}

export function clearDrop(id?: string) {
  if (id && dropIndicator()?.id !== id) return;
  setDropIndicator(null);
}

/** Top half of the row means "insert before", bottom half "insert after". */
export function edgeFromEvent(e: DragEvent, el: HTMLElement): DropEdge {
  const rect = el.getBoundingClientRect();
  return e.clientY - rect.top < rect.height / 2 ? "before" : "after";
}

/**
 * The same service appears both in the app tree and inside groups, so member
 * rows need their own key or every copy would light up at once.
 */
export function memberRowId(groupId: string, serviceId: string): string {
  return `${groupId}:${serviceId}`;
}

export function dropClass(id: string): string {
  const ind = dropIndicator();
  if (ind?.id !== id) return "";
  return ind.edge === "before" ? "drop-before" : "drop-after";
}
