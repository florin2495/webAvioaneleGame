import { describe, expect, it } from "vitest";
import type { Move } from "./game";
import { applyShot } from "./liveShot";
import type { RoomState } from "./types";

const base = (moves: Move[] = []): RoomState =>
  ({
    room: {
      id: "r",
      code: "ABCDEF",
      name: "x",
      planesCount: 2,
      status: "playing",
      round: 1,
      hasPassword: false,
      hostPlayerId: "a",
      winnerPlayerId: null,
      turnSeat: 1,
      downed: { 1: 0, 2: 0 },
    },
    players: [],
    me: { id: "s" },
    myPlanes: null,
    moves,
    reveal: null,
  }) as unknown as RoomState;

describe("applyShot", () => {
  it("appends the next shot and recomputes turn and downed", () => {
    const s = applyShot(base(), 1, { seq: 1, seat: 1, cell: 5, result: "miss" });
    expect(s?.moves).toHaveLength(1);
    expect(s?.room.turnSeat).toBe(2);
    const t = applyShot(base(), 1, { seq: 1, seat: 1, cell: 5, result: "head" });
    expect(t?.room.turnSeat).toBe(1);
    expect(t?.room.downed[2]).toBe(1);
  });

  it("asks for /state on a gap, another round, a bad payload or outside a game", () => {
    expect(applyShot(base(), 1, { seq: 2, seat: 1, cell: 5, result: "miss" })).toBeNull();
    expect(applyShot(base(), 2, { seq: 1, seat: 1, cell: 5, result: "miss" })).toBeNull();
    expect(applyShot(base(), 1, { seq: 1, seat: 3, cell: 5, result: "miss" })).toBeNull();
    expect(applyShot(base(), 1, { seq: 1, seat: 1, cell: 500, result: "miss" })).toBeNull();
    const lobby = { ...base(), room: { ...base().room, status: "lobby" } } as RoomState;
    expect(applyShot(lobby, 1, { seq: 1, seat: 1, cell: 5, result: "miss" })).toBeNull();
  });

  it("ignores a shot it already has, but not a conflicting one", () => {
    const s = base([{ seq: 1, seat: 1, cell: 5, result: "miss" }]);
    expect(applyShot(s, 1, { seq: 1, seat: 1, cell: 5, result: "miss" })).toBe(s);
    expect(applyShot(s, 1, { seq: 1, seat: 1, cell: 6, result: "miss" })).toBeNull();
  });

  it("never applies the winning shot (the reveal comes from /state)", () => {
    const s = base([{ seq: 1, seat: 1, cell: 5, result: "head" }]);
    expect(applyShot(s, 1, { seq: 2, seat: 1, cell: 9, result: "head" })).toBeNull();
  });
});
