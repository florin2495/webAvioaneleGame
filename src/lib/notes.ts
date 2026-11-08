// Private notes of a shooter about the opponent's board: cells they do not want to shoot at (X marks)
// and the planes they think are hidden there. Purely client-side (never sent to the server), so a
// guess may be as wrong as the player likes - it may overlap, touch or even stick out of the board.

import { BOARD, isCell, isDir, type Plane } from "./game";

export interface Notes {
  /** Cells manually marked with an X. */
  marks: number[];
  /** Planes the player thinks the opponent has (any position, valid or not). */
  planes: Plane[];
}

export const emptyNotes = (): Notes => ({ marks: [], planes: [] });

export function toggleMark(notes: Notes, cell: number): Notes {
  if (!isCell(cell)) return notes;
  const marks = notes.marks.includes(cell) ? notes.marks.filter((c) => c !== cell) : [...notes.marks, cell];
  return { ...notes, marks };
}

// Same shape as game.ts (head first): (back, side).
const PARTS: [number, number][] = [
  [0, 0],
  [1, -1],
  [1, 0],
  [1, 1],
  [2, 0],
  [3, -1],
  [3, 0],
  [3, 1],
];

/** Cells of a plane that fall on the board, head first. Unlike planeCells, a plane sticking out is clipped, not rejected. */
export function drawnCells(plane: Plane): number[] {
  const hr = Math.floor(plane.head / BOARD);
  const hc = plane.head % BOARD;
  const out: number[] = [];
  for (const [back, side] of PARTS) {
    let r: number;
    let c: number;
    switch (plane.dir) {
      case "N":
        r = hr + back;
        c = hc + side;
        break;
      case "S":
        r = hr - back;
        c = hc - side;
        break;
      case "E":
        r = hr + side;
        c = hc - back;
        break;
      default:
        r = hr - side;
        c = hc + back;
    }
    if (r >= 0 && r < BOARD && c >= 0 && c < BOARD) out.push(r * BOARD + c);
  }
  return out;
}

/**
 * Placing exactly the same plane again (same head, same direction) removes it; anything else is added
 * (up to `max` planes), also on top of other drawn planes - guesses may overlap.
 */
export function togglePlane(notes: Notes, plane: Plane, max: number): Notes {
  const same = notes.planes.findIndex((p) => p.head === plane.head && p.dir === plane.dir);
  if (same >= 0) return { ...notes, planes: notes.planes.filter((_, i) => i !== same) };
  if (notes.planes.length >= max) return notes;
  return { ...notes, planes: [...notes.planes, plane] };
}

/** Every cell the player considers "not for shooting": X marks plus all cells of the drawn planes. */
export function notedCells(notes: Notes): Set<number> {
  const s = new Set<number>(notes.marks);
  for (const p of notes.planes) drawnCells(p).forEach((c) => s.add(c));
  return s;
}

/**
 * Cells to show with an X on the result card: noted cells that were not shot at and are not really part
 * of a plane. `shot` = cells already fired at, `real` = cells of the opponent's actual planes.
 */
export function missedNotedCells(notes: Notes, shot: Set<number>, real: Set<number>): Set<number> {
  const out = new Set<number>();
  for (const c of notedCells(notes)) if (!shot.has(c) && !real.has(c)) out.add(c);
  return out;
}

export function parseNotes(raw: string | null): Notes {
  if (!raw) return emptyNotes();
  try {
    const v = JSON.parse(raw) as Partial<Notes>;
    const marks = Array.isArray(v.marks) ? v.marks.filter(isCell) : [];
    const planes = Array.isArray(v.planes)
      ? v.planes.filter((p): p is Plane => !!p && isCell(p.head) && isDir(p.dir)).map((p) => ({ head: p.head, dir: p.dir }))
      : [];
    return { marks, planes };
  } catch {
    return emptyNotes();
  }
}

export const notesKey = (roomCode: string, round: number, playerId: string) => `airplanes:notes:${roomCode}:${round}:${playerId}`;
