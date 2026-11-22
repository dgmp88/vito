import { createSignal } from "solid-js";

const KEY = "vito.splitPct";
export const DEFAULT_SPLIT = 42;
const MIN = 20;
const MAX = 75;
const STEP = 2;

const clamp = (pct: number) => Math.min(MAX, Math.max(MIN, pct));

// Only rendered after sign-in on the client, so localStorage is available,
// but it can still throw (private mode, blocked storage).
export function readSplit(): number {
  try {
    const pct = Number(localStorage.getItem(KEY));
    return pct ? clamp(pct) : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
  }
}

function writeSplit(pct: number) {
  try {
    localStorage.setItem(KEY, String(Math.round(pct * 10) / 10));
  } catch {
    // Not persisted; fine.
  }
}

/**
 * Draggable divider between the transcript and document panes. `split` is the
 * transcript's width as a percentage of the parent `.panes` element.
 */
export default function SplitHandle(props: { split: number; onSplit: (pct: number) => void }) {
  const [dragging, setDragging] = createSignal(false);

  const set = (pct: number) => {
    const next = clamp(pct);
    props.onSplit(next);
    writeSplit(next);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // don't start a text selection
    const handle = e.currentTarget as HTMLElement;
    const container = handle.parentElement;
    if (!container) return;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      set(((ev.clientX - rect.left) / rect.width) * 100);
    };
    const onUp = () => {
      setDragging(false);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") set(props.split - STEP);
    else if (e.key === "ArrowRight") set(props.split + STEP);
    else if (e.key === "Home") set(MIN);
    else if (e.key === "End") set(MAX);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      class={{ "split-handle": true, "split-handle--dragging": dragging() }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize transcript and document"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={Math.round(props.split)}
      tabindex="0"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDblClick={() => set(DEFAULT_SPLIT)}
    />
  );
}
