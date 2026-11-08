import "server-only";
import { db, type PlayerRow, type RoomRow } from "./db";
import { isUniqueViolation } from "./http";

// Shared leaderboard owned by the hub repo (hub_leaderboard, hub_leaderboard_rounds). Needs the hub's
// migration 002_hub_leaderboard.sql; until it runs every report fails quietly (the game is never affected).
const GAME_SLUG = "airplanes";

/** Same person = same nickname, case and surrounding spaces ignored (there are no accounts). */
export const playerKey = (nickname: string) => nickname.trim().toLowerCase().slice(0, 40);

async function bump(key: string, name: string, won: boolean): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await db()
      .from("hub_leaderboard")
      .select("wins, games")
      .eq("game", GAME_SLUG)
      .eq("player_key", key)
      .maybeSingle();
    if (error) throw error;
    const now = new Date().toISOString();
    if (!data) {
      const { error: insertError } = await db()
        .from("hub_leaderboard")
        .insert({ game: GAME_SLUG, player_key: key, display_name: name, wins: won ? 1 : 0, games: 1, updated_at: now });
      if (isUniqueViolation(insertError)) continue; // another room created the row first: retry as an update
      if (insertError) throw insertError;
      return;
    }
    // Conditional on the counters we read, so two rounds ending at once never lose an increment.
    const { data: updated, error: updateError } = await db()
      .from("hub_leaderboard")
      .update({ wins: data.wins + (won ? 1 : 0), games: data.games + 1, display_name: name, updated_at: now })
      .eq("game", GAME_SLUG)
      .eq("player_key", key)
      .eq("games", data.games)
      .eq("wins", data.wins)
      .select("player_key");
    if (updateError) throw updateError;
    if (updated?.length) return;
  }
  throw new Error("leaderboard: too much contention");
}

/**
 * Counts a finished round: +1 game for both seated players, +1 win for the winner. Idempotent per
 * (room code, round): the round row is claimed first, a second report finds it and does nothing.
 * Best effort - never throws.
 */
export async function reportRound(room: RoomRow, members: PlayerRow[], winnerId: string | null): Promise<void> {
  try {
    if (!winnerId) return; // nobody won (the winner left too): not a result
    const seated = members.filter((p) => p.seat !== null);
    if (seated.length === 0) return;
    const { error } = await db().from("hub_leaderboard_rounds").insert({ game: GAME_SLUG, room_code: room.code, round_no: room.round });
    if (isUniqueViolation(error)) return; // already counted
    if (error) throw error;
    for (const p of seated) await bump(playerKey(p.nickname), p.nickname.trim().slice(0, 40), p.id === winnerId);
  } catch (err) {
    console.error("leaderboard report failed", err);
  }
}
