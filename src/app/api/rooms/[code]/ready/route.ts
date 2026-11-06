import { layoutError } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { getPlanes, listPlayers, requireMember, requireSeat, requireStatus } from "@/lib/server/room";

// POST /api/rooms/[code]/ready  { ready: boolean }
// The game starts on its own as soon as both seats are filled and both players are ready.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/ready">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireSeat(player);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    const ready = body.ready !== false;

    if (ready) {
      const err = layoutError(await getPlanes(player.id, room.round), room.planes_count);
      if (err) fail(400, `Așază-ți avioanele întâi. ${err}`);
    }
    const { error } = await db().from(T.players).update({ ready }).eq("id", player.id);
    if (error) throw error;

    // Read after our own write: of two players getting ready at once, the later read sees both.
    const seated = (await listPlayers(room.id)).filter((p) => p.seat);
    const now = new Date().toISOString();
    if (ready && seated.length === 2 && seated.every((p) => p.ready)) {
      const { error: startError } = await db()
        .from(T.rooms)
        .update({ status: "playing", winner_player_id: null, updated_at: now, last_activity_at: now })
        .eq("id", room.id)
        .eq("status", "lobby")
        .eq("round", room.round);
      if (startError) throw startError;
      await notifyRoom(room.id, "started");
      return { ok: true, started: true };
    }
    await db().from(T.rooms).update({ last_activity_at: now }).eq("id", room.id);
    await notifyRoom(room.id, "ready");
    return { ok: true, started: false };
  });
}
