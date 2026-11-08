import { describe, expect, it } from "vitest";
import { BOARD, planeCells } from "./game";
import { drawnCells, emptyNotes, missedNotedCells, notedCells, parseNotes, toggleMark, togglePlane } from "./notes";

const cell = (r: number, c: number) => r * BOARD + c;

describe("notes", () => {
  it("toggles X marks", () => {
    const a = toggleMark(emptyNotes(), 5);
    expect(a.marks).toEqual([5]);
    expect(toggleMark(a, 5).marks).toEqual([]);
    expect(toggleMark(a, 500).marks).toEqual([5]);
  });

  it("draws a full plane like planeCells, and clips one that sticks out", () => {
    const ok = { head: cell(2, 4), dir: "N" as const };
    expect(drawnCells(ok)).toEqual(planeCells(ok));
    const out = { head: cell(8, 0), dir: "N" as const };
    expect(planeCells(out)).toBeNull();
    const cells = drawnCells(out);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(8);
  });

  it("adds, removes the identical plane, respects the max", () => {
    const p1 = { head: cell(0, 1), dir: "N" as const };
    const p2 = { head: cell(0, 6), dir: "N" as const };
    let n = togglePlane(emptyNotes(), p1, 1);
    expect(n.planes).toHaveLength(1);
    n = togglePlane(n, p2, 1); // full
    expect(n.planes).toHaveLength(1);
    n = togglePlane(n, p1, 1); // same head + dir again
    expect(n.planes).toHaveLength(0);
  });

  it("a head can go on top of another drawn head (other direction)", () => {
    const a = { head: cell(5, 5), dir: "N" as const };
    const b = { head: cell(5, 5), dir: "E" as const };
    const n = togglePlane(togglePlane(emptyNotes(), a, 3), b, 3);
    expect(n.planes).toEqual([a, b]);
  });

  it("allows overlapping or invalid guesses", () => {
    const a = { head: cell(0, 1), dir: "N" as const };
    const b = { head: cell(1, 1), dir: "E" as const };
    const n = togglePlane(togglePlane(emptyNotes(), a, 3), b, 3);
    expect(n.planes).toHaveLength(2);
  });

  it("result X only on noted cells that were neither shot nor a real plane part", () => {
    const n = { marks: [1, 2, 3], planes: [{ head: cell(5, 5), dir: "N" as const }] };
    expect(notedCells(n).has(cell(6, 5))).toBe(true);
    const missed = missedNotedCells(n, new Set([2]), new Set([3, cell(5, 5)]));
    expect(missed.has(1)).toBe(true);
    expect(missed.has(2)).toBe(false);
    expect(missed.has(3)).toBe(false);
    expect(missed.has(cell(5, 5))).toBe(false);
    expect(missed.has(cell(6, 5))).toBe(true);
  });

  it("parses stored notes defensively", () => {
    expect(parseNotes(null)).toEqual(emptyNotes());
    expect(parseNotes("nope")).toEqual(emptyNotes());
    expect(parseNotes('{"marks":[1,"x",999],"planes":[{"head":3,"dir":"N"},{"head":3,"dir":"Q"}]}')).toEqual({
      marks: [1],
      planes: [{ head: 3, dir: "N" }],
    });
  });
});
