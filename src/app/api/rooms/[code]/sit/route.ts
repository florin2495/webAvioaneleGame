import { SEATS } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, isUniqueViolation } from "@/lib/server/http";
import { listPlayers, requireMember, requireStatus, stateAfter, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/sit - a spectator takes a free seat (lobby only).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/sit">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "lobby");
    if (player.seat) fail(409, "Ești deja jucător.");

    const members = await listPlayers(room.id);
    for (const seat of SEATS.filter((s) => !members.some((m) => m.seat === s))) {
      const { error } = await db().from(T.players).update({ seat, ready: false }).eq("id", player.id).is("seat", null);
      if (isUniqueViolation(error)) continue; // someone else sat there first
      if (error) throw error;
      await touchRoom(room.id);
      await notifyRoom(room.id, "sit", player.id);
      return { ok: true, seat, state: await stateAfter(room.id, player.id) };
    }
    fail(409, "Nu mai e niciun loc liber.");
  });
}
