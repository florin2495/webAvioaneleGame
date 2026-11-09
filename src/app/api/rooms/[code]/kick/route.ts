import { db, T } from "@/lib/server/db";
import { notifyRoom } from "@/lib/server/broadcast";
import { fail, handle, readJson } from "@/lib/server/http";
import { removePlayer } from "@/lib/server/membership";
import { requireHost, requireMember, stateAfter } from "@/lib/server/room";

// POST /api/rooms/[code]/kick  { playerId } - host removes another member (any status).
// Kicking the opponent mid-game ends it in the host's favour, so the UI warns about that.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/kick">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);

    const body = await readJson(req);
    const targetId = typeof body.playerId === "string" ? body.playerId : "";
    if (targetId === player.id) fail(400, "Nu te poți scoate singur. Folosește „Părăsește camera”.");

    const { data: target, error } = await db()
      .from(T.players)
      .select("id, seat")
      .eq("id", targetId)
      .eq("room_id", room.id)
      .maybeSingle();
    if (error && error.code !== "22P02") throw error; // 22P02 = malformed uuid
    if (!target) fail(404, "Jucătorul nu mai e în cameră.");

    // Game in progress and the target is one of the two players: 10 s to press "Ignoră".
    // Spectators (no seat), the lobby and finished games: removed at once, as before.
    if (room.status === "playing" && target.seat) {
      // Conditional, so a second kick does not reset the deadline.
      const { error: pendingError } = await db()
        .from(T.players)
        .update({ kick_requested_at: new Date().toISOString() })
        .eq("id", targetId)
        .is("kick_requested_at", null);
      if (pendingError) throw pendingError;
      await notifyRoom(room.id, "kick_pending", player.id);
      return { ok: true, pending: true, state: await stateAfter(room.id, player.id) };
    }

    await removePlayer(room, targetId, "player_kicked", player.id);
    return { ok: true, state: await stateAfter(room.id, player.id) };
  });
}
