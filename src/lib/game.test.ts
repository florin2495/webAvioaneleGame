import { describe, expect, it } from "vitest";
import {
  layoutError,
  placementError,
  planeCells,
  possibleDirs,
  randomLayout,
  replay,
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

  it("possibleDirs only lists shapes that fit", () => {
    expect(possibleDirs(cell(0, 0))).toEqual([]);
    expect(possibleDirs(cell(0, 5))).toEqual(["N"]);
    expect(possibleDirs(cell(5, 5)).sort()).toEqual(["E", "N", "S", "W"]);
  });
});

describe("shots and turns", () => {
  const planes: Plane[] = [
    { head: cell(0, 1), dir: "N" },
    { head: cell(0, 6), dir: "N" },
  ];
  let seq = 0;
  const shot = (seat: 1 | 2, c: number): Move => ({ seq: ++seq, kind: "shot", seat, cell: c, dir: null, result: shotResult(planes, c) });
  const guess = (seat: 1 | 2, head: number, dir: Plane["dir"], right: boolean): Move => ({
    seq: ++seq,
    kind: "guess",
    seat,
    cell: head,
    dir,
    result: right ? "correct" : "wrong",
  });

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

  it("a head hit downs the plane and asks the shooter to guess", () => {
    seq = 0;
    const p = replay([shot(1, cell(0, 1))], 1, 2);
    expect(p.downed[2]).toBe(1);
    expect(p.pending).toEqual({ seat: 1, head: cell(0, 1) });
    expect(shotError(p, 1, cell(5, 5))).toMatch(/ghicește/);
    expect(shotError(p, 2, cell(5, 5))).toMatch(/Adversarul/);
  });

  it("a right guess reveals the plane and keeps the turn", () => {
    seq = 0;
    const p = replay([shot(1, cell(0, 1)), guess(1, cell(0, 1), "N", true)], 1, 2);
    expect(p.pending).toBeNull();
    expect(p.turn).toBe(1);
    expect(p.known[2].size).toBe(8);
    expect(shotError(p, 1, cell(3, 2))).toMatch(/deja/);
  });

  it("a wrong guess passes the turn, the plane stays down", () => {
    seq = 0;
    const p = replay([shot(1, cell(0, 1)), guess(1, cell(0, 1), "S", false)], 1, 2);
    expect(p.turn).toBe(2);
    expect(p.downed[2]).toBe(1);
    expect(p.known[2].size).toBe(1);
  });

  it("downing the last plane wins at once, without a guess", () => {
    seq = 0;
    const p = replay(
      [shot(1, cell(0, 1)), guess(1, cell(0, 1), "N", true), shot(1, cell(0, 6))],
      1,
      2,
    );
    expect(p.winner).toBe(1);
    expect(p.pending).toBeNull();
    expect(shotError(p, 1, cell(9, 9))).toMatch(/terminat/);
  });

  it("nothing blocks a shot next to a known plane", () => {
    seq = 0;
    const p = replay([shot(1, cell(0, 1)), guess(1, cell(0, 1), "N", true)], 1, 2);
    expect(shotError(p, 1, cell(0, 3))).toBeNull(); // touches the revealed plane
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
