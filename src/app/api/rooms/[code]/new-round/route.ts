import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, isUniqueViolation } from "@/lib/server/http";
import { SEATS } from "@/lib/game";
import { queueOrder } from "@/lib/queue";
import { listPlayers, requireHost, requireMember, requireStatus, stateAfter } from "@/lib/server/room";

// POST /api/rooms/[code]/new-round - host, after a game: back to the lobby for a new layout.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/new-round">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "finished");

    const now = new Date().toISOString();
    const { data, error } = await db()
      .from(T.rooms)
      .update({ status: "lobby", round: room.round + 1, winner_player_id: null, updated_at: now, last_activity_at: now })
      .eq("id", room.id)
      .eq("status", "finished")
      .eq("round", room.round)
      .select("id");
    if (error) throw error;
    if (!data?.length) fail(409, "Runda nouă a fost deja pornită.");

    const { error: readyError } = await db().from(T.players).update({ ready: false, kick_requested_at: null }).eq("room_id", room.id);
    if (readyError) throw readyError;

    // Queued spectators ("Intră la runda următoare") take the free seats, in the order they queued.
    const members = await listPlayers(room.id);
    const free = SEATS.filter((s) => !members.some((m) => m.seat === s));
    const queue = queueOrder(members);
    for (const seat of free) {
      while (queue.length > 0) {
        const next = queue.shift()!;
        const { data: sat, error: sitError } = await db()
          .from(T.players)
          .update({ seat, ready: false, queued_at: null })
          .eq("id", next.id)
          .is("seat", null)
          .select("id");
        if (isUniqueViolation(sitError)) break; // that seat was taken meanwhile, next seat
        if (sitError) throw sitError;
        if (sat?.length) break;
      }
    }
    await notifyRoom(room.id, "new_round", player.id);
    return { ok: true, state: await stateAfter(room.id, player.id) };
  });
}
