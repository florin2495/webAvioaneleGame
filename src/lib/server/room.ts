import "server-only";
import {
  isRoomExpired,
  minutesLabel,
  replay,
  ROOM_IDLE_MINUTES,
  PLAYING_IDLE_MINUTES,
  type Move,
  type Plane,
  type Seat,
} from "@/lib/game";
import type { PublicPlayer, RoomState } from "@/lib/types";
import { kickRemainingMs } from "@/lib/kick";
import { isConnected, LAST_SEEN_TOUCH_MS } from "@/lib/reconnect";
import { queueOrder } from "@/lib/queue";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, ROOM_COLUMNS, T, type PlayerRow, type RoomRow } from "./db";
import { fail } from "./http";
import { reportRound } from "./leaderboard";
import { enforceExpiredKicks } from "./membership";

const GONE = `Camera nu există sau a fost închisă după ${minutesLabel(ROOM_IDLE_MINUTES)} de inactivitate.`;

export function normalizeCode(code: string): string {
  const c = decodeURIComponent(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) fail(404, GONE);
  return c;
}

export async function getRoomByCode(code: string): Promise<RoomRow> {
  const { data, error } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, GONE);
  const room = data as RoomRow;
  // Lazy expiry: Vercel Hobby has no frequent cron, so idle rooms are closed when touched.
  if (isRoomExpired(room.status, room.last_activity_at)) {
    await db().from(T.rooms).delete().eq("id", room.id).eq("last_activity_at", room.last_activity_at);
    fail(404, GONE);
  }
  return room;
}

/** Deletes every room idle for longer than its limit. */
export async function cleanupExpiredRooms(): Promise<void> {
  const now = Date.now();
  const quiet = new Date(now - ROOM_IDLE_MINUTES * 60_000).toISOString();
  const playing = new Date(now - PLAYING_IDLE_MINUTES * 60_000).toISOString();
  const [a, b] = await Promise.all([
    db().from(T.rooms).delete().in("status", ["lobby", "finished"]).lt("last_activity_at", quiet),
    db().from(T.rooms).delete().eq("status", "playing").lt("last_activity_at", playing),
  ]);
  if (a.error || b.error) console.error("cleanup failed", a.error ?? b.error);
}

/** Records activity on a room, restarting its idle timer. */
export async function touchRoom(roomId: string, extra: Record<string, unknown> = {}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db().from(T.rooms).update({ last_activity_at: now, ...extra }).eq("id", roomId);
  if (error) throw error;
}

/** Resolves the caller from the x-player-token header and checks they belong to the room. */
export async function requireMember(req: Request, code: string): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  let room = await getRoomByCode(code);
  const findPlayer = () =>
    db().from(T.players).select(PLAYER_COLUMNS).eq("token_hash", hashToken(token)).eq("room_id", room.id).maybeSingle();
  // Lazy enforcement of expired pending kicks (no timers on serverless), in parallel with the
  // membership lookup. If somebody was removed, both are read again, so a player who was just
  // removed gets the usual 401.
  const [kicked, first] = await Promise.all([enforceExpiredKicks(room), findPlayer()]);
  let found = first;
  if (kicked) {
    room = await getRoomByCode(code);
    found = await findPlayer();
  }
  if (found.error) throw found.error;
  if (!found.data) fail(401, "Nu ești în această cameră.");
  const player = found.data as PlayerRow;
  await touchPlayer(player);
  return { room, player };
}

/** Presence heartbeat: stamps last_seen_at at most every LAST_SEEN_TOUCH_MS. Best effort, never throws. */
async function touchPlayer(player: PlayerRow): Promise<void> {
  const now = Date.now();
  if (now - Date.parse(player.last_seen_at) < LAST_SEEN_TOUCH_MS) return;
  player.last_seen_at = new Date(now).toISOString();
  const { error } = await db().from(T.players).update({ last_seen_at: player.last_seen_at }).eq("id", player.id);
  if (error) console.error("presence touch failed", error);
}

export function requireHost(room: RoomRow, player: PlayerRow) {
  if (room.host_player_id !== player.id) fail(403, "Doar creatorul camerei poate face asta.");
}

export function requireSeat(player: PlayerRow): Seat {
  if (player.seat !== 1 && player.seat !== 2) fail(403, "Ești spectator în această cameră.");
  return player.seat;
}

export function requireStatus(room: RoomRow, ...allowed: RoomRow["status"][]) {
  if (!allowed.includes(room.status)) {
    const msg: Record<RoomRow["status"], string> = {
      lobby: "Jocul nu a început încă.",
      playing: "Jocul este în desfășurare.",
      finished: "Jocul s-a terminat.",
    };
    fail(409, msg[room.status]);
  }
}

export async function listPlayers(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

export async function listMoves(roomId: string, round: number): Promise<Move[]> {
  const { data, error } = await db()
    .from(T.moves)
    .select("seq, seat, cell, result")
    .eq("room_id", roomId)
    .eq("round", round)
    .order("seq", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Move[];
}

export async function getPlanes(playerId: string, round: number): Promise<Plane[] | null> {
  const { data, error } = await db()
    .from(T.boards)
    .select("planes")
    .eq("player_id", playerId)
    .eq("round", round)
    .maybeSingle();
  if (error) throw error;
  return (data?.planes as Plane[] | undefined) ?? null;
}

/** Seated players first (seat 1, seat 2), then spectators in join order. */
export function sortMembers(players: PlayerRow[]): PlayerRow[] {
  return [...players].sort((a, b) => (a.seat ?? 9) - (b.seat ?? 9));
}

const toPublic = (p: PlayerRow, now: number, queue: PlayerRow[] = []): PublicPlayer => ({
  id: p.id,
  nickname: p.nickname,
  isHost: p.is_host,
  ready: p.ready,
  seat: p.seat,
  kickRemainingMs: kickRemainingMs(p.kick_requested_at, now),
  queued: p.queued_at !== null,
  queuePos: p.queued_at === null ? null : queue.findIndex((q) => q.id === p.id) + 1 || null,
  connected: isConnected(p.last_seen_at, now),
});

export interface BoardRow {
  player_id: string;
  planes: Plane[];
}

/** Every layout of a round (server side only: never send the opponent's to a client mid-game). */
export async function listBoards(roomId: string, round: number): Promise<BoardRow[]> {
  const { data, error } = await db().from(T.boards).select("player_id, planes").eq("room_id", roomId).eq("round", round);
  if (error) throw error;
  return (data ?? []) as BoardRow[];
}

function revealRound(boards: BoardRow[], players: PlayerRow[]): Partial<Record<Seat, Plane[]>> {
  const out: Partial<Record<Seat, Plane[]>> = {};
  for (const b of boards) {
    const seat = players.find((p) => p.id === b.player_id)?.seat;
    if (seat) out[seat] = b.planes;
  }
  return out;
}

/** What buildState reads; a route that already has it (e.g. /shoot) passes it in to skip the queries. */
export interface RoundData {
  players: PlayerRow[];
  moves: Move[];
  boards: BoardRow[];
}

export async function loadRound(room: RoomRow): Promise<RoundData> {
  const [players, moves, boards] = await Promise.all([listPlayers(room.id), listMoves(room.id, room.round), listBoards(room.id, room.round)]);
  return { players, moves, boards };
}

export async function buildState(room: RoomRow, me: PlayerRow, data?: RoundData): Promise<RoomState> {
  const { players, moves, boards } = data ?? (await loadRound(room));
  const myPlanes = me.seat ? (boards.find((b) => b.player_id === me.id)?.planes ?? null) : null;
  const reveal = room.status === "finished" ? revealRound(boards, players) : null;
  const progress = replay(moves, room.round, room.planes_count);
  const playing = room.status === "playing";
  const now = Date.now();
  const queue = queueOrder(players);

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      planesCount: room.planes_count,
      status: room.status,
      round: room.round,
      hasPassword: room.password_hash !== null,
      hostPlayerId: room.host_player_id,
      winnerPlayerId: room.winner_player_id,
      turnSeat: playing ? progress.turn : null,
      downed: progress.downed,
    },
    players: sortMembers(players).map((p) => toPublic(p, now, queue)),
    me: toPublic(me, now, queue),
    myPlanes,
    moves: room.status === "lobby" ? [] : moves,
    reveal,
  };
}

/**
 * Ends a running game with `winnerId`. Conditional, so only one request can finish it; that one also
 * reports the round to the shared leaderboard (once per room + round).
 */
export async function finishGame(room: RoomRow, winnerId: string | null, members?: PlayerRow[]): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from(T.rooms)
    .update({ status: "finished", winner_player_id: winnerId, updated_at: now, last_activity_at: now })
    .eq("id", room.id)
    .eq("status", "playing")
    .select("id");
  if (error) throw error;
  if (data?.length) await reportRound(room, members ?? (await listPlayers(room.id)), winnerId);
}

/** Clears every pending kick of the room (new game, back to the lobby). */
export async function clearPendingKicks(roomId: string): Promise<void> {
  const { error } = await db().from(T.players).update({ kick_requested_at: null }).eq("room_id", roomId).not("kick_requested_at", "is", null);
  if (error) throw error;
}
