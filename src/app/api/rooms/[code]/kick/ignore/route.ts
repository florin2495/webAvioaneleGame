import { isKickExpired } from "@/lib/kick";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { requireMember, stateAfter } from "@/lib/server/room";

// POST /api/rooms/[code]/kick/ignore - the kicked player refuses the pending kick and stays.
// An expired kick is enforced inside requireMember (the caller then gets 401 as the removed player).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/kick/ignore">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (player.kick_requested_at === null) return { ok: true }; // nothing pending (already ignored)
    if (isKickExpired(player.kick_requested_at, Date.now())) fail(409, "Prea târziu, ai fost scos.");

    const { error } = await db()
      .from(T.players)
      .update({ kick_requested_at: null })
      .eq("id", player.id)
      .eq("kick_requested_at", player.kick_requested_at);
    if (error) throw error;
    await notifyRoom(room.id, "kick_ignored", player.id);
    return { ok: true, state: await stateAfter(room.id, player.id) };
  });
}
