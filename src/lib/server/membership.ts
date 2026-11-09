import "server-only";
import { notifyRoom } from "./broadcast";
import { db, ROOM_COLUMNS, T, type RoomRow } from "./db";
import { isKickExpired } from "@/lib/kick";
import { finishGame, listPlayers } from "./room";

/**
 * Removes a member from a room (used by both "leave" and the host's "kick").
 *  - last member out: the room is deleted
 *  - host removed: host passes to the next member in join order (players before spectators)
 *  - a seated player removed during a game: the other player wins
 *  - spectators come and go without touching the game
 */
export async function removePlayer(room: RoomRow, playerId: string, reason: string, by?: string): Promise<{ roomClosed: boolean }> {
  const all = await listPlayers(room.id);
  const leaving = all.find((p) => p.id === playerId);
  const remaining = all.filter((p) => p.id !== playerId);

  if (remaining.length === 0) {
    const { error } = await db().from(T.rooms).delete().eq("id", room.id);
    if (error) throw error;
    return { roomClosed: true };
  }

  if (room.status === "playing" && leaving?.seat) {
    const opponent = remaining.find((p) => p.seat && p.seat !== leaving.seat);
    await finishGame(room, opponent?.id ?? null);
  }

  let newHostId = room.host_player_id;
  if (room.host_player_id === playerId) {
    newHostId = (remaining.find((p) => p.seat) ?? remaining[0]).id;
  }
  const now = new Date().toISOString();
  // Update the room first so the host never points at a deleted player.
  const { error: roomError } = await db()
    .from(T.rooms)
    .update({ host_player_id: newHostId, updated_at: now, last_activity_at: now })
    .eq("id", room.id);
  if (roomError) throw roomError;
  if (newHostId && newHostId !== room.host_player_id) {
    const { error } = await db().from(T.players).update({ is_host: true }).eq("id", newHostId);
    if (error) throw error;
  }

  // Cascades to the player's boards. Their moves stay (they are the round's history).
  const { error: deleteError } = await db().from(T.players).delete().eq("id", playerId);
  if (deleteError) throw deleteError;

  await notifyRoom(room.id, reason, by);
  return { roomClosed: false };
}

/**
 * Removes players whose pending kick has run out (grace + network allowance). Serverless has no
 * timers, so every room request calls this. Each removal is claimed atomically (clear the stamp only
 * if it is still the value we read), so concurrent requests never remove the same player twice.
 * Returns true when somebody was removed (the caller should re-read the room).
 */
export async function enforceExpiredKicks(room: RoomRow): Promise<boolean> {
  const { data, error } = await db()
    .from(T.players)
    .select("id, kick_requested_at")
    .eq("room_id", room.id)
    .not("kick_requested_at", "is", null);
  if (error) throw error;
  const now = Date.now();
  const expired = (data ?? []).filter((p) => isKickExpired(p.kick_requested_at as string, now));
  if (expired.length === 0) return false;

  let removed = false;
  let current = room;
  for (const p of expired) {
    const { data: claimed, error: claimError } = await db()
      .from(T.players)
      .update({ kick_requested_at: null })
      .eq("id", p.id)
      .eq("kick_requested_at", p.kick_requested_at)
      .select("id");
    if (claimError) throw claimError;
    if (!claimed?.length) continue; // another request got it
    const { data: fresh } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("id", room.id).maybeSingle();
    if (!fresh) return true; // room already closed
    current = fresh as RoomRow;
    await removePlayer(current, p.id as string, "player_kicked");
    removed = true;
  }
  return removed;
}
