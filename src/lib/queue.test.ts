import { describe, expect, it } from "vitest";
import { planReorder, queueOrder } from "./queue";

const m = (id: string, seat: number | null, queued_at: string | null = null) => ({ id, seat, queued_at });

describe("queueOrder", () => {
  it("lists only queued spectators, oldest first", () => {
    const members = [
      m("a", 1),
      m("b", 2, "2026-11-08T10:00:00Z"), // seated: never in the queue
      m("c", null, "2026-11-08T10:02:00Z"),
      m("d", null),
      m("e", null, "2026-11-08T10:01:00Z"),
    ];
    expect(queueOrder(members).map((p) => p.id)).toEqual(["e", "c"]);
  });
});

describe("planReorder", () => {
  const members = [m("a", 1), m("b", 2), m("s", null)];

  it("swaps the seats when the second player goes first", () => {
    expect(planReorder(members, ["b", "a"])).toEqual({ swap: true, first: "b", second: "a" });
  });

  it("is a no-op when the order is already current, and ignores spectator ids", () => {
    expect(planReorder(members, ["a", "b"])).toEqual({ swap: false });
    expect(planReorder(members, ["s", "b", "a"])).toEqual({ swap: true, first: "b", second: "a" });
  });

  it("rejects anything that is not a full permutation of the players", () => {
    for (const bad of [null, "a", ["a"], ["a", "a"], ["a", "b", "zzz"], ["a", 1], []]) {
      expect(planReorder(members, bad)).toHaveProperty("error");
    }
  });

  it("a lone player has nothing to reorder", () => {
    expect(planReorder([m("a", 1)], ["a"])).toEqual({ swap: false });
  });
});
