import type { DayGeometry } from "./grid-geometry";

/**
 * Shared shapes of the grid gestures (move / resize / drag-to-create) —
 * kept apart from the interact.js wiring so grid-interactions stays within
 * the file-size budget (docs/2 §9.3) and components can import the render
 * types without touching interact.js.
 */

export interface GridInteractionOptions {
  geometryFor(dayIso: string): DayGeometry | undefined;
  zone(): string;
  onMove(occurrenceId: string, startsAtWall: string, durationMin: number): void;
  onResize(occurrenceId: string, durationMin: number): void;
  onCreate(dayIso: string, time: string, durationMin: number): void;
}

/** The snapped-time chip riding next to the pointer. */
export interface DragChip {
  x: number;
  y: number;
  label: string;
}

/** The ghost shown while dragging out a new slot on empty column space. */
export interface CreatePreview {
  dayIso: string;
  topPx: number;
  heightPx: number;
  label: string;
}

/** interact.js listener payload — typed structurally to stay lib-version proof. */
export interface GestureEvent {
  target: HTMLElement;
  clientX: number;
  clientY: number;
}

export interface CardDrag {
  el: HTMLElement;
  occId: string;
  occStartMs: number;
  segStartMs: number;
  durationMin: number;
  grabOffsetY: number;
  startClientX: number;
  startClientY: number;
  newStartMs: number;
  moved: boolean;
  cancelled: boolean;
}

export interface CardResize {
  el: HTMLElement;
  occId: string;
  occStartMs: number;
  segStartMs: number;
  baseDurationMin: number;
  geo: DayGeometry;
  colTop: () => number;
  newDurationMin: number;
  moved: boolean;
  cancelled: boolean;
}

export interface CreateDrag {
  dayIso: string;
  geo: DayGeometry;
  colTop: () => number;
  anchorMs: number;
  startMs: number;
  endMs: number;
  cancelled: boolean;
}
