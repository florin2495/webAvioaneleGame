import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerRow, RoomRow } from "./db";
import { isTestRoom, reportRound } from "./leaderboard";

const h = vi.hoisted(() => ({ db: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ db: h.db }));

const room = (name: string): RoomRow => ({
  id: "r1",
  code: "ABCDEF",
  name,
  password_hash: null,
  planes_count: 2,
  status: "finished",
  round: 1,
  host_player_id: "p1",
  winner_player_id: "p1",
  last_activity_at: "2026-11-15T12:00:00Z",
});
const player = (id: string, nickname: string, seat: 1 | 2): PlayerRow => ({
  id,
  room_id: "r1",
  nickname,
  is_host: seat === 1,
  seat,
  ready: true,
  joined_at: "2026-11-15T12:00:00Z",
  kick_requested_at: null,
  last_seen_at: "2026-11-15T12:00:00Z",
  queued_at: null,
});
const members = [player("p1", "Ana", 1), player("p2", "Bob", 2)];

describe("isTestRoom", () => {
  it("matches the rooms of scripts/e2e.mjs and tests/ui", () => {
    expect(isTestRoom("e2e-test-lx3k9")).toBe(true);
    expect(isTestRoom("e2e-test-ui-lx3k9")).toBe(true);
  });
  it("leaves real rooms alone", () => {
    expect(isTestRoom("Camera lui Florin")).toBe(false);
    expect(isTestRoom("my e2e-test-room")).toBe(false);
    expect(isTestRoom("e2e-tes")).toBe(false);
  });
});

describe("reportRound", () => {
  beforeEach(() => {
    h.db.mockReset();
    h.db.mockImplementation(() => {
      throw new Error("db unavailable");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never touches the leaderboard for a test room", async () => {
    await reportRound(room("e2e-test-lx3k9"), members, "p1");
    expect(h.db).not.toHaveBeenCalled();
  });

  it("reports a real room (best effort: a DB failure is logged, not thrown)", async () => {
    await expect(reportRound(room("Camera lui Florin"), members, "p1")).resolves.toBeUndefined();
    expect(h.db).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});
