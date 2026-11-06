import { isValidPlanesCount } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { requireHost, requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/settings  { planesCount } - host, lobby only.
// Changing the number of planes throws away this round's layouts and everyone's "ready".
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/settings">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    const planesCount = Number(body.planesCount);
    if (!isValidPlanesCount(planesCount)) fail(400, "Numărul de avioane trebuie să fie între 2 și 4.");
    if (planesCount === room.planes_count) return { ok: true };

    const { error } = await db()
      .from(T.rooms)
      .update({ planes_count: planesCount })
      .eq("id", room.id)
      .eq("status", "lobby");
    if (error) throw error;
    const [boards, ready] = await Promise.all([
      db().from(T.boards).delete().eq("room_id", room.id).eq("round", room.round),
      db().from(T.players).update({ ready: false }).eq("room_id", room.id),
    ]);
    if (boards.error) throw boards.error;
    if (ready.error) throw ready.error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "settings");
    return { ok: true };
  });
}
