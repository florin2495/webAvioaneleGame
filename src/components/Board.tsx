"use client";

import { BOARD, CELLS, cellLabel, other, planeCells, type Move, type Plane, type Seat } from "@/lib/game";

export interface CellView {
  /** A plane part that the viewer is allowed to see (own planes, revealed ones, end of game). */
  plane?: "body" | "head";
  /** Outcome of a shot at this cell. */
  shot?: "miss" | "hit" | "head";
  /** Highlight: plane being placed. */
  preview?: boolean;
  /** Private note: part of the plane the viewer thinks is here (drawn by hand, may be wrong). */
  guess?: "body" | "head";
  /** Private note: an X ("do not shoot here"), also shown at the end for noted cells that turned out empty. */
  cross?: boolean;
  /** The most recent shot on this board. */
  last?: boolean;
  /** Picked, waiting for confirmation. */
  selected?: boolean;
  clickable?: boolean;
}

const COLS = Array.from({ length: BOARD }, (_, i) => String.fromCharCode(65 + i));

export function Board({
  cells,
  onCell,
  label,
  dim,
}: {
  cells: CellView[];
  onCell?: (cell: number) => void;
  label: string;
  /** Faded look when it is not the viewer's turn to act on this board. */
  dim?: boolean;
}) {
  return (
    <div
      role="grid"
      aria-label={label}
      className={`grid select-none gap-px rounded-lg bg-sky-200 p-px text-[10px] transition-opacity dark:bg-sky-900 ${dim ? "opacity-70" : ""}`}
      style={{ gridTemplateColumns: `1.1rem repeat(${BOARD}, minmax(0, 1fr))` }}
    >
      <span />
      {COLS.map((c) => (
        <span key={c} className="flex items-center justify-center bg-sky-100 py-0.5 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
          {c}
        </span>
      ))}
      {Array.from({ length: BOARD }, (_, r) => (
        <Row key={r} r={r} cells={cells} onCell={onCell} />
      ))}
    </div>
  );
}

function Row({ r, cells, onCell }: { r: number; cells: CellView[]; onCell?: (cell: number) => void }) {
  return (
    <>
      <span className="flex items-center justify-center bg-sky-100 font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
        {r + 1}
      </span>
      {Array.from({ length: BOARD }, (_, c) => {
        const i = r * BOARD + c;
        const v = cells[i] ?? {};
        return (
          <button
            key={i}
            type="button"
            role="gridcell"
            data-cell={i}
            aria-label={`${cellLabel(i)}${describe(v)}`}
            disabled={!v.clickable || !onCell}
            onClick={() => onCell?.(i)}
            className={`relative flex aspect-square items-center justify-center text-sm font-black leading-none ${cellClass(v)} ${
              v.clickable && onCell ? "cursor-pointer hover:brightness-90 active:brightness-75" : "cursor-default"
            }`}
          >
            {v.shot === "miss" && <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 dark:bg-zinc-400" />}
            {v.shot === "hit" && <span className="text-white">✕</span>}
            {v.shot === "head" && <span aria-hidden>💥</span>}
            {v.cross && !v.shot && <span className="text-zinc-700 dark:text-zinc-200">✕</span>}
            {v.last && <span className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-amber-400" />}
            {v.selected && <span className="pointer-events-none absolute inset-0 animate-pulse ring-[3px] ring-inset ring-indigo-500" />}
          </button>
        );
      })}
    </>
  );
}

function cellClass(v: CellView): string {
  if (v.shot === "head") return "bg-zinc-900 dark:bg-black";
  if (v.shot === "hit") return v.plane ? "bg-rose-600" : "bg-rose-500";
  if (v.preview) return v.plane === "head" ? "bg-amber-500" : "bg-amber-300 dark:bg-amber-600";
  if (v.guess === "head") return "bg-teal-600 dark:bg-teal-500";
  if (v.guess === "body") return "bg-teal-300 dark:bg-teal-800";
  if (v.plane === "head") return "bg-indigo-700 dark:bg-indigo-500";
  if (v.plane === "body") return "bg-indigo-400 dark:bg-indigo-700";
  return "bg-white dark:bg-zinc-900";
}

function describe(v: CellView): string {
  if (v.shot === "head") return ", cap doborât";
  if (v.shot === "hit") return ", lovit";
  if (v.shot === "miss") return ", aer";
  if (v.cross) return ", marcat cu X";
  if (v.guess) return ", avion presupus";
  if (v.plane === "head") return ", capul avionului";
  if (v.plane) return ", avion";
  return "";
}

/** Plane cells of a layout as a per-cell map (head / body). */
export function planeMap(planes: Plane[]): Map<number, "head" | "body"> {
  const m = new Map<number, "head" | "body">();
  for (const p of planes) (planeCells(p) ?? []).forEach((c, i) => m.set(c, i === 0 ? "head" : "body"));
  return m;
}

/**
 * The view of `seat`'s board: shots fired at it by the other seat and the planes the viewer may see
 * (`visiblePlanes`).
 */
export function boardView(seat: Seat, moves: Move[], visiblePlanes: Plane[] | null): CellView[] {
  const shooter = other(seat);
  const cells: CellView[] = Array.from({ length: CELLS }, () => ({}));
  const known = planeMap(visiblePlanes ?? []);
  known.forEach((part, c) => (cells[c].plane = part));
  let last: Move | null = null;
  for (const m of moves) {
    if (m.seat !== shooter) continue;
    cells[m.cell].shot = m.result as CellView["shot"];
    last = m;
  }
  if (last) cells[last.cell].last = true;
  return cells;
}
