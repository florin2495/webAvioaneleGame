// Pure game rules - shared by server and client, no I/O.
//
// Board: 10x10, cell index = row * 10 + col (row 0 = top, col 0 = left).
// A plane, head pointing up ("N"), relative to its head at (0, 0):
//
//    .*.     row 0: head
//    ***     row 1: wings
//    .*.     row 2: body
//    ***     row 3: tail
//
// Rules:
//  - each player hides PLANES_DEFAULT (configurable) planes; planes may not overlap or touch,
//    not even diagonally
//  - a hit (body or head) gives the shooter one more shot, and so on while they keep hitting
//  - hitting the head downs the plane at once (and, like any hit, gives one more shot); nothing is
//    revealed - the shooter keeps their own private notes (X marks, a guessed plane), see notes.ts
//  - the first to down every plane of the opponent wins
//  - nothing stops a shot next to a known plane, only cells already known are blocked

export const BOARD = 10;
export const CELLS = BOARD * BOARD;
export const PLANES_MIN = 2;
export const PLANES_MAX = 4;
export const PLANES_DEFAULT = 3;
export const SEATS = [1, 2] as const;
/** Spectators per room (contract B of the feedback plan). */
export const MAX_SPECTATORS = 16;
/** Two players + the spectators. */
export const MAX_MEMBERS = 2 + MAX_SPECTATORS;
export const NICKNAME_MAX = 10;
/** Lobby / finished rooms close after this long with nobody having them open. */
export const ROOM_IDLE_MINUTES = 10;
/** A game in progress survives longer (phones get locked while the other one thinks). */
export const PLAYING_IDLE_MINUTES = 30;
/** /state refreshes last_activity_at at most this often, to keep DB writes low. */
export const PRESENCE_TOUCH_MS = 20_000;

export type Seat = 1 | 2;
export type Dir = "N" | "E" | "S" | "W";
export const DIRS: Dir[] = ["N", "E", "S", "W"];
export const DIR_LABEL: Record<Dir, string> = { N: "↑ sus", E: "→ dreapta", S: "↓ jos", W: "← stânga" };

export interface Plane {
  head: number;
  dir: Dir;
}

export type ShotResult = "miss" | "hit" | "head";
export interface Move {
  seq: number;
  /** Seat of the player who shot; the target is always the other seat. */
  seat: Seat;
  /** The cell fired at. */
  cell: number;
  result: ShotResult;
}

export const other = (seat: Seat): Seat => (seat === 1 ? 2 : 1);

export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

export function idleLimitMinutes(status: string): number {
  return status === "playing" ? PLAYING_IDLE_MINUTES : ROOM_IDLE_MINUTES;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  return now - new Date(lastActivityAt).getTime() > idleLimitMinutes(status) * 60_000;
}

/**
 * A room in any status (also "playing") is abandoned once its last activity is older than this AND no
 * player or spectator has been seen within it. Swept every time the room list loads (GET /api/rooms).
 */
export const ROOM_ABANDONED_MS = 600_000;

export function isRoomAbandoned(
  lastActivityAt: string | Date,
  membersLastSeen: (string | Date | null | undefined)[],
  now = Date.now(),
): boolean {
  const recent = (t: string | Date | null | undefined) => {
    if (t === null || t === undefined) return false;
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && now - ms <= ROOM_ABANDONED_MS;
  };
  return !recent(lastActivityAt) && !membersLastSeen.some(recent);
}

export function isValidPlanesCount(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= PLANES_MIN && (n as number) <= PLANES_MAX;
}

export function isCell(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) < CELLS;
}

export function isDir(d: unknown): d is Dir {
  return typeof d === "string" && (DIRS as string[]).includes(d);
}

/** Round 1 starts with seat 1, round 2 with seat 2, and so on. */
export function startSeat(round: number): Seat {
  return round % 2 === 1 ? 1 : 2;
}

export const cellLabel = (cell: number) => `${String.fromCharCode(65 + (cell % BOARD))}${Math.floor(cell / BOARD) + 1}`;

// Shape as (back, side): "back" = distance behind the head, "side" = sideways offset.
const SHAPE: [number, number][] = [
  [0, 0],
  [1, -1],
  [1, 0],
  [1, 1],
  [2, 0],
  [3, -1],
  [3, 0],
  [3, 1],
];

/** Board cells of a plane (head first), or null if any part is off the board. */
export function planeCells(plane: Plane): number[] | null {
  const hr = Math.floor(plane.head / BOARD);
  const hc = plane.head % BOARD;
  const out: number[] = [];
  for (const [back, side] of SHAPE) {
    let r: number;
    let c: number;
    switch (plane.dir) {
      case "N": // head on top, body goes down
        r = hr + back;
        c = hc + side;
        break;
      case "S":
        r = hr - back;
        c = hc - side;
        break;
      case "E": // head on the right, body goes left
        r = hr + side;
        c = hc - back;
        break;
      case "W":
        r = hr - side;
        c = hc + back;
        break;
    }
    if (r < 0 || r >= BOARD || c < 0 || c >= BOARD) return null;
    out.push(r * BOARD + c);
  }
  return out;
}

/** The 8 neighbours of a cell plus the cell itself. */
function around(cell: number): number[] {
  const r = Math.floor(cell / BOARD);
  const c = cell % BOARD;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < BOARD && cc >= 0 && cc < BOARD) out.push(rr * BOARD + cc);
    }
  }
  return out;
}

/**
 * Why `plane` cannot be added next to `existing`, or null when it can.
 * Planes may not overlap and may not touch, not even at a corner.
 */
export function placementError(existing: Plane[], plane: Plane): string | null {
  const cells = planeCells(plane);
  if (!cells) return "Avionul iese din tablă.";
  const taken = new Set(existing.flatMap((p) => planeCells(p) ?? []));
  if (cells.some((c) => taken.has(c))) return "Avioanele nu se pot suprapune.";
  if (cells.some((c) => around(c).some((n) => taken.has(n)))) return "Două avioane nu au voie să se atingă.";
  return null;
}

/** Null when `planes` is a complete, legal layout of exactly `count` planes; otherwise the reason. */
export function layoutError(planes: unknown, count: number): string | null {
  if (!Array.isArray(planes)) return "Lipsesc avioanele.";
  if (planes.length !== count) return `Trebuie să plasezi exact ${count} avioane.`;
  const ok: Plane[] = [];
  for (const p of planes) {
    if (!p || typeof p !== "object" || !isCell((p as Plane).head) || !isDir((p as Plane).dir)) return "Avion invalid.";
    const plane = { head: (p as Plane).head, dir: (p as Plane).dir };
    const err = placementError(ok, plane);
    if (err) return err;
    ok.push(plane);
  }
  return null;
}

/** A random legal layout. `random` is injectable for tests. */
export function randomLayout(count: number, random: () => number = Math.random): Plane[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const planes: Plane[] = [];
    for (let tries = 0; tries < 500 && planes.length < count; tries++) {
      const plane: Plane = { head: Math.floor(random() * CELLS), dir: DIRS[Math.floor(random() * 4)] };
      if (!placementError(planes, plane)) planes.push(plane);
    }
    if (planes.length === count) return planes;
  }
  throw new Error("could not place planes");
}

export function shotResult(planes: Plane[], cell: number): ShotResult {
  for (const p of planes) {
    const cells = planeCells(p) ?? [];
    if (cells[0] === cell) return "head";
    if (cells.includes(cell)) return "hit";
  }
  return "miss";
}

export interface Progress {
  /** Whose shot it is. Null once there is a winner. */
  turn: Seat | null;
  /** Planes downed ON each seat's board. */
  downed: Record<Seat, number>;
  winner: Seat | null;
  /** Cells of each seat's board that are already known to the shooter (shot). */
  known: Record<Seat, Set<number>>;
}

/** Replays the move list of a round. Everything about turns is derived from it. */
export function replay(moves: Move[], round: number, planesCount: number): Progress {
  const p: Progress = {
    turn: startSeat(round),
    downed: { 1: 0, 2: 0 },
    winner: null,
    known: { 1: new Set(), 2: new Set() },
  };
  for (const m of [...moves].sort((a, b) => a.seq - b.seq)) {
    const target = other(m.seat);
    p.known[target].add(m.cell);
    if (m.result === "miss") p.turn = target;
    else if (m.result === "head") {
      p.downed[target]++;
      if (p.downed[target] >= planesCount) {
        p.winner = m.seat;
        p.turn = null;
      }
    }
  }
  return p;
}

/** Null when `seat` may fire at `cell` now; otherwise the reason. */
export function shotError(progress: Progress, seat: Seat, cell: number): string | null {
  if (progress.winner) return "Jocul s-a terminat.";
  if (progress.turn !== seat) return "Nu e tura ta.";
  if (!isCell(cell)) return "Celulă invalidă.";
  if (progress.known[other(seat)].has(cell)) return "Ai tras deja acolo.";
  return null;
}
