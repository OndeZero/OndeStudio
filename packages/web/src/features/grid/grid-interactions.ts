import interact from "interactjs";
import { type Ref, ref } from "vue";
import { formatHm, utcToWall } from "../../lib/station-time";
import { instantToY, snapInstant, yToInstant } from "./grid-geometry";
import type {
  CardDrag,
  CardResize,
  CreateDrag,
  CreatePreview,
  DragChip,
  GestureEvent,
  GridInteractionOptions,
} from "./grid-gesture-types";

/**
 * All interact.js wiring for the week grid lives here so the components
 * stay declarative (docs/2 §8.3). Three gestures on selector interactables:
 * card move (whole card), card resize (bottom edge), drag-to-create (empty
 * column space). Feel decisions: the move ghost follows the pointer freely
 * while the chip shows the snapped 15-min result; resize steps visibly.
 */

const MINUTE_MS = 60_000;
const MIN_DURATION_MIN = 15;
/** Mirror of PatchOccurrenceInputSchema's cap — the gesture must not promise what the API rejects. */
const MAX_DURATION_MIN = 1440;

export interface GridInteractions {
  dragChip: Ref<DragChip | null>;
  createPreview: Ref<CreatePreview | null>;
  attach(root: HTMLElement): void;
  detach(): void;
}

export function useGridInteractions(options: GridInteractionOptions): GridInteractions {
  const dragChip = ref<DragChip | null>(null);
  const createPreview = ref<CreatePreview | null>(null);

  let rootEl: HTMLElement | null = null;
  let interactables: { unset(): void }[] = [];
  let cardDrag: CardDrag | null = null;
  let cardResize: CardResize | null = null;
  let createDrag: CreateDrag | null = null;

  const num = (el: HTMLElement, key: string): number => Number(el.dataset[key] ?? Number.NaN);

  /** Day column under (or nearest to) the pointer — this is what makes cross-day drags work. */
  function columnAt(clientX: number): { dayIso: string; rect: DOMRect } | null {
    if (!rootEl) return null;
    let best: { dayIso: string; rect: DOMRect } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const el of rootEl.querySelectorAll<HTMLElement>("[data-day-col]")) {
      const rect = el.getBoundingClientRect();
      const dayIso = el.dataset.day;
      if (!dayIso) continue;
      if (clientX >= rect.left && clientX < rect.right) return { dayIso, rect };
      const distance = Math.abs(clientX - (rect.left + rect.right) / 2);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { dayIso, rect };
      }
    }
    return best;
  }

  function onDragStart(event: GestureEvent): void {
    const el = event.target;
    cardDrag = {
      el,
      occId: el.dataset.occId ?? "",
      occStartMs: num(el, "occStartMs"),
      segStartMs: num(el, "segStartMs"),
      durationMin: num(el, "durationMin"),
      grabOffsetY: event.clientY - el.getBoundingClientRect().top,
      startClientX: event.clientX,
      startClientY: event.clientY,
      newStartMs: num(el, "occStartMs"),
      moved: false,
      cancelled: false,
    };
    el.classList.add("dragging");
  }

  function onDragMove(event: GestureEvent): void {
    const drag = cardDrag;
    if (!drag || drag.cancelled) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    // Free-follow ghost; the chip carries the snapped truth.
    drag.el.style.transform = `translate(${dx}px, ${dy}px)`;

    const column = columnAt(event.clientX);
    const geo = column ? options.geometryFor(column.dayIso) : undefined;
    if (!column || !geo) return;
    // Position → instant → wall time: DST-correct by construction. Dragging
    // a continuation segment moves the whole occurrence by the same delta.
    const rawSegStart = yToInstant(geo, event.clientY - drag.grabOffsetY - column.rect.top);
    const snapped = snapInstant(geo, rawSegStart);
    drag.newStartMs = drag.occStartMs + (snapped - drag.segStartMs);
    dragChip.value = {
      x: event.clientX + 14,
      y: event.clientY - 12,
      label: formatHm(new Date(drag.newStartMs), options.zone()),
    };
  }

  function onDragEnd(): void {
    const drag = cardDrag;
    cardDrag = null;
    dragChip.value = null;
    if (!drag) return;
    drag.el.classList.remove("dragging");
    drag.el.style.transform = "";
    if (drag.cancelled || !drag.moved) return;
    suppressNextClick();
    if (drag.newStartMs === drag.occStartMs) return;
    options.onMove(
      drag.occId,
      utcToWall(new Date(drag.newStartMs), options.zone()),
      drag.durationMin,
    );
  }

  function onResizeStart(event: GestureEvent): void {
    const el = event.target;
    const columnEl = el.closest<HTMLElement>("[data-day-col]");
    const geo = columnEl?.dataset.day ? options.geometryFor(columnEl.dataset.day) : undefined;
    if (!columnEl || !geo) return;
    cardResize = {
      el,
      occId: el.dataset.occId ?? "",
      occStartMs: num(el, "occStartMs"),
      segStartMs: num(el, "segStartMs"),
      baseDurationMin: num(el, "durationMin"),
      geo,
      colTop: () => columnEl.getBoundingClientRect().top,
      newDurationMin: num(el, "durationMin"),
      moved: false,
      cancelled: false,
    };
    el.classList.add("resizing");
  }

  function onResizeMove(event: GestureEvent): void {
    const resize = cardResize;
    if (!resize || resize.cancelled) return;
    resize.moved = true;
    const { geo } = resize;
    // The end edge follows the pointer, floored at 15 and capped at 1440
    // booked minutes (a midnight-spanning tail could otherwise exceed the cap).
    const minEnd = resize.occStartMs + MIN_DURATION_MIN * MINUTE_MS;
    const maxEnd = resize.occStartMs + MAX_DURATION_MIN * MINUTE_MS;
    const snappedEnd = Math.min(
      Math.max(snapInstant(geo, yToInstant(geo, event.clientY - resize.colTop())), minEnd),
      maxEnd,
    );
    resize.newDurationMin = Math.round((snappedEnd - resize.occStartMs) / MINUTE_MS);
    // Stepped live height = tactile 15-min snap feedback.
    const heightPx = Math.max(instantToY(geo, snappedEnd) - instantToY(geo, resize.segStartMs), 4);
    resize.el.style.height = `${heightPx}px`;
    dragChip.value = {
      x: event.clientX + 14,
      y: event.clientY - 12,
      label: `→ ${formatHm(new Date(snappedEnd), options.zone())} · ${resize.newDurationMin} min`,
    };
  }

  function onResizeEnd(): void {
    const resize = cardResize;
    cardResize = null;
    dragChip.value = null;
    if (!resize) return;
    resize.el.classList.remove("resizing");
    resize.el.style.height = "";
    if (resize.cancelled || !resize.moved) return;
    suppressNextClick();
    if (resize.newDurationMin !== resize.baseDurationMin) {
      options.onResize(resize.occId, resize.newDurationMin);
    }
  }

  function onCreateStart(event: GestureEvent): void {
    const columnEl = event.target.closest<HTMLElement>("[data-day-col]") ?? event.target;
    const dayIso = columnEl.dataset.day;
    const geo = dayIso ? options.geometryFor(dayIso) : undefined;
    if (!dayIso || !geo) return;
    const colTop = () => columnEl.getBoundingClientRect().top;
    const anchorMs = snapInstant(geo, yToInstant(geo, event.clientY - colTop()));
    createDrag = {
      dayIso,
      geo,
      colTop,
      anchorMs,
      startMs: anchorMs,
      endMs: anchorMs,
      cancelled: false,
    };
  }

  function onCreateMove(event: GestureEvent): void {
    const create = createDrag;
    if (!create || create.cancelled) return;
    const cursor = snapInstant(create.geo, yToInstant(create.geo, event.clientY - create.colTop()));
    create.startMs = Math.min(create.anchorMs, cursor);
    create.endMs = Math.max(create.anchorMs, cursor);
    const zone = options.zone();
    createPreview.value = {
      dayIso: create.dayIso,
      topPx: instantToY(create.geo, create.startMs),
      heightPx: Math.max(
        instantToY(create.geo, create.endMs) - instantToY(create.geo, create.startMs),
        2,
      ),
      label: `${formatHm(new Date(create.startMs), zone)} – ${formatHm(new Date(create.endMs), zone)}`,
    };
  }

  function onCreateEnd(): void {
    const create = createDrag;
    createDrag = null;
    createPreview.value = null;
    if (!create || create.cancelled) return;
    const durationMin = Math.round((create.endMs - create.startMs) / MINUTE_MS);
    if (durationMin < MIN_DURATION_MIN) return;
    suppressNextClick();
    options.onCreate(
      create.dayIso,
      formatHm(new Date(create.startMs), options.zone()),
      durationMin,
    );
  }

  /** ESC abandons the gesture in place; move events keep arriving but are ignored. */
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    if (cardDrag) {
      cardDrag.cancelled = true;
      cardDrag.el.style.transform = "";
      cardDrag.el.classList.remove("dragging");
    }
    if (cardResize) {
      cardResize.cancelled = true;
      cardResize.el.style.height = "";
      cardResize.el.classList.remove("resizing");
    }
    if (createDrag) createDrag.cancelled = true;
    dragChip.value = null;
    createPreview.value = null;
  }

  function attach(root: HTMLElement): void {
    rootEl = root;
    // On coarse pointers a 300ms hold separates dragging from scrolling; a
    // mouse gets zero delay so desktop drags never feel laggy.
    const hold = window.matchMedia("(pointer: coarse)").matches ? 300 : 0;
    const autoScroll = { container: root };
    interactables = [
      // Locked cards (aired/declined/cancelled) are history — not draggable.
      interact(".grid-card:not(.grid-card--locked)", { context: root })
        .draggable({
          hold,
          autoScroll,
          // The bottom strip belongs to resize alone; never start a move there.
          ignoreFrom: ".card-resize",
          listeners: { start: onDragStart, move: onDragMove, end: onDragEnd },
        })
        .resizable({
          edges: { bottom: ".card-resize" },
          listeners: { start: onResizeStart, move: onResizeMove, end: onResizeEnd },
        }),
      // Mirror cards are reality, not empty space: no create-drag from them.
      interact("[data-day-col]", { context: root }).draggable({
        hold,
        autoScroll,
        ignoreFrom: ".grid-card, .mirror-card",
        listeners: { start: onCreateStart, move: onCreateMove, end: onCreateEnd },
      }),
    ];
    window.addEventListener("keydown", onKeydown);
  }

  function detach(): void {
    for (const interactable of interactables) interactable.unset();
    interactables = [];
    window.removeEventListener("keydown", onKeydown);
    rootEl = null;
  }

  return { dragChip, createPreview, attach, detach };
}

/**
 * A real drag ends with a click on the same element; swallow exactly that
 * one so quick-edit does not open on every drop. The trap self-disarms in
 * case the pointer was released where no click follows.
 */
function suppressNextClick(): void {
  const swallow = (event: Event): void => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 150);
}
