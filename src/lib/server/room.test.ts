import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_ABANDONED_MS } from "@/lib/game";
import { cleanupAbandonedRooms } from "./room";

// The Supabase client is faked: every db().from(...) chain is recorded and resolves to the configured result.
type Op = { kind: "select" | "delete"; calls: [string, unknown[]][] };
const h = vi.hoisted(() => ({
  ops: [] as { kind: "select" | "delete"; calls: [string, unknown[]][] }[],
  selectResult: { data: [] as unknown, error: null as unknown },
  deleteResult: { error: null as unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({
  db: () => ({
    from: (table: string) => {
      const op: Op = { kind: "select", calls: [["from", [table]]] };
      h.ops.push(op);
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "delete", "lt", "in", "eq", "limit"]) {
        builder[m] = (...args: unknown[]) => {
          if (m === "delete") op.kind = "delete";
          op.calls.push([m, args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(op.kind === "delete" ? h.deleteResult : h.selectResult).then(resolve, reject);
      return builder;
    },
  }),
  T: { rooms: "airplanes_rooms", players: "airplanes_players", boards: "airplanes_boards", moves: "airplanes_moves" },
  ROOM_COLUMNS: "",
  PLAYER_COLUMNS: "",
}));

const NOW = Date.parse("2026-11-15T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const cutoff = new Date(NOW - ROOM_ABANDONED_MS).toISOString();
const room = (id: string, lastActivity: number, seen: (number | null)[]) => ({
  id,
  last_activity_at: ago(lastActivity),
  airplanes_players: seen.map((s) => ({ last_seen_at: s === null ? null : ago(s) })),
});
const call = (op: Op, name: string) => op.calls.find(([m]) => m === name)?.[1];

describe("cleanupAbandonedRooms", () => {
  beforeEach(() => {
    h.ops.length = 0;
    h.selectResult = { data: [], error: null };
    h.deleteResult = { error: null };
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("only looks at rooms quiet for longer than ROOM_ABANDONED_MS", async () => {
    await cleanupAbandonedRooms();
    expect(h.ops).toHaveLength(1);
    expect(h.ops[0].kind).toBe("select");
    expect(call(h.ops[0], "lt")).toEqual(["last_activity_at", cutoff]);
  });

  it("keeps rooms with a recently seen member and deletes the silent ones", async () => {
    h.selectResult = {
      data: [
        room("kept-player", 700, [30]), // a player seen 30 s ago
        room("kept-spectator", 900, [900, 599]), // a spectator seen just inside the limit
        room("silent", 700, [900, null]),
        room("empty", 800, []),
      ],
      error: null,
    };
    await cleanupAbandonedRooms();
    expect(h.ops).toHaveLength(2);
    const del = h.ops[1];
    expect(del.kind).toBe("delete");
    expect(call(del, "from")).toEqual(["airplanes_rooms"]);
    expect(call(del, "in")).toEqual(["id", ["silent", "empty"]]);
  });

  it("re-checks the activity cutoff in the delete, so a room touched meanwhile survives", async () => {
    h.selectResult = { data: [room("silent", 700, [])], error: null };
    await cleanupAbandonedRooms();
    expect(call(h.ops[1], "lt")).toEqual(["last_activity_at", cutoff]);
  });

  it("deletes nothing when every quiet room still has someone around", async () => {
    h.selectResult = { data: [room("a", 700, [10]), room("b", 700, [100])], error: null };
    await cleanupAbandonedRooms();
    expect(h.ops).toHaveLength(1);
  });

  it("logs a select error instead of throwing", async () => {
    h.selectResult = { data: null, error: { message: "boom" } };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
    expect(h.ops).toHaveLength(1);
  });

  it("logs a delete error instead of throwing", async () => {
    h.selectResult = { data: [room("silent", 700, [])], error: null };
    h.deleteResult = { error: { message: "boom" } };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
