import { describe, expect, it } from "vitest";
import {
  isRoomAbandoned,
  layoutError,
  placementError,
  planeCells,
  randomLayout,
  replay,
  ROOM_ABANDONED_MS,
  shotError,
  shotResult,
  type Move,
  type Plane,
} from "./game";

const cell = (r: number, c: number) => r * 10 + c;

describe("planeCells", () => {
  it("draws the N shape from the head down", () => {
    expect(planeCells({ head: cell(0, 1), dir: "N" })).toEqual([
      cell(0, 1),
      cell(1, 0),
      cell(1, 1),
      cell(1, 2),
      cell(2, 1),
      cell(3, 0),
      cell(3, 1),
      cell(3, 2),
    ]);
  });

  it("rotates: E has the head on the right and the tail to the left", () => {
    const cells = planeCells({ head: cell(5, 5), dir: "E" })!;
    expect(cells[0]).toBe(cell(5, 5));
    expect(cells).toContain(cell(4, 4)); // wing
    expect(cells).toContain(cell(6, 2)); // tail
    expect(cells).toHaveLength(8);
  });

  it("returns null when the plane leaves the board", () => {
    expect(planeCells({ head: cell(0, 0), dir: "N" })).toBeNull(); // wing at col -1
    expect(planeCells({ head: cell(7, 5), dir: "N" })).toBeNull(); // tail at row 10
    expect(planeCells({ head: cell(5, 2), dir: "E" })).toBeNull(); // tail at col -1
  });

  it("every direction gives 8 distinct cells", () => {
    for (const dir of ["N", "E", "S", "W"] as const) {
      const cells = planeCells({ head: cell(5, 5), dir })!;
      expect(new Set(cells).size).toBe(8);
    }
  });
});

describe("placement", () => {
  const a: Plane = { head: cell(0, 1), dir: "N" }; // occupies rows 0-3, cols 0-2

  it("rejects overlap", () => {
    expect(placementError([a], { head: cell(1, 2), dir: "N" })).toMatch(/suprapune/);
  });

  it("rejects touching side by side and at a corner", () => {
    expect(placementError([a], { head: cell(0, 4), dir: "N" })).toMatch(/atingă/); // col 3 next to col 2
    expect(placementError([a], { head: cell(4, 3), dir: "N" })).toMatch(/atingă/); // head (4,3) touches (3,2) diagonally
  });

  it("accepts a one-cell gap", () => {
    expect(placementError([a], { head: cell(0, 5), dir: "N" })).toBeNull();
    expect(placementError([a], { head: cell(5, 1), dir: "N" })).toBeNull();
  });

  it("validates a full layout", () => {
    expect(layoutError([a, { head: cell(0, 5), dir: "N" }], 2)).toBeNull();
    expect(layoutError([a], 2)).toMatch(/exact 2/);
    expect(layoutError([a, { head: 999, dir: "N" }], 2)).toMatch(/invalid/);
    expect(layoutError([a, { head: cell(0, 1), dir: "X" }], 2)).toMatch(/invalid/);
    expect(layoutError("nope", 2)).not.toBeNull();
  });

  it("random layouts are always legal", () => {
    for (let count = 2; count <= 4; count++) {
      for (let i = 0; i < 50; i++) expect(layoutError(randomLayout(count), count)).toBeNull();
    }
  });
});

describe("shots and turns", () => {
  const planes: Plane[] = [
    { head: cell(0, 1), dir: "N" },
    { head: cell(0, 6), dir: "N" },
  ];
  let seq = 0;
  const shot = (seat: 1 | 2, c: number): Move => ({ seq: ++seq, seat, cell: c, result: shotResult(planes, c) });
  it("classifies shots", () => {
    expect(shotResult(planes, cell(0, 1))).toBe("head");
    expect(shotResult(planes, cell(3, 2))).toBe("hit");
    expect(shotResult(planes, cell(9, 9))).toBe("miss");
  });

  it("round 1 starts with seat 1, round 2 with seat 2", () => {
    expect(replay([], 1, 2).turn).toBe(1);
    expect(replay([], 2, 2).turn).toBe(2);
  });

  it("a miss passes the turn, a hit keeps it", () => {
    seq = 0;
    expect(replay([shot(1, cell(9, 9))], 1, 2).turn).toBe(2);
    seq = 0;
    expect(replay([shot(1, cell(3, 2)), shot(1, cell(2, 1))], 1, 2).turn).toBe(1);
  });

  it("a head hit downs the plane and the shooter keeps shooting", () => {
    seq = 0;
    const p = replay([shot(1, cell(0, 1))], 1, 2);
    expect(p.downed[2]).toBe(1);
    expect(p.turn).toBe(1);
    expect(shotError(p, 1, cell(5, 5))).toBeNull();
    expect(shotError(p, 2, cell(5, 5))).toMatch(/tura/);
  });

  it("downing the last plane wins at once", () => {
    seq = 0;
    const p = replay([shot(1, cell(0, 1)), shot(1, cell(0, 6))], 1, 2);
    expect(p.winner).toBe(1);
    expect(shotError(p, 1, cell(9, 9))).toMatch(/terminat/);
  });

  it("nothing blocks a shot next to a known plane", () => {
    seq = 0;
    const p = replay([shot(1, cell(0, 1))], 1, 2);
    expect(shotError(p, 1, cell(0, 3))).toBeNull();
    expect(shotError(p, 1, cell(4, 1))).toBeNull();
  });

  it("rejects shots out of turn or twice at the same cell", () => {
    seq = 0;
    const p = replay([shot(1, cell(9, 9))], 1, 2);
    expect(shotError(p, 1, cell(8, 8))).toMatch(/tura/);
    seq = 0;
    const q = replay([shot(1, cell(3, 2))], 1, 2);
    expect(shotError(q, 1, cell(3, 2))).toMatch(/deja/);
  });
});

describe("abandoned rooms (any status)", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const sec = (s: number) => new Date(now - s * 1000).toISOString();
  it(`is abandoned after ${ROOM_ABANDONED_MS / 1000} s with nobody seen`, () => {
    expect(ROOM_ABANDONED_MS).toBe(600_000);
    expect(isRoomAbandoned(sec(601), [sec(900), sec(700)], now)).toBe(true);
    expect(isRoomAbandoned(sec(601), [], now)).toBe(true);
    expect(isRoomAbandoned(sec(601), [null], now)).toBe(true);
  });
  it("is kept while the last activity is recent", () => {
    expect(isRoomAbandoned(sec(599), [], now)).toBe(false);
  });
  it("is kept while any player or spectator was seen recently", () => {
    expect(isRoomAbandoned(sec(900), [sec(900), sec(30)], now)).toBe(false);
    expect(isRoomAbandoned(sec(900), [sec(599)], now)).toBe(false);
  });
});
