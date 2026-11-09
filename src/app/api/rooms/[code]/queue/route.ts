import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { requireMember, stateAfter, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/queue - a spectator toggles "Intră la runda următoare". At new-round the queued
// spectators take the free seats, in the order they queued; the rest stay spectators (and stay queued).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/queue">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (player.seat) fail(409, "Ești deja jucător.");

    const queued = player.queued_at === null;
    const { error } = await db()
      .from(T.players)
      .update({ queued_at: queued ? new Date().toISOString() : null })
      .eq("id", player.id);
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "queue", player.id);
    return { ok: true, queued, state: await stateAfter(room.id, player.id) };
  });
}
