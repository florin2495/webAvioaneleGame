import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { planReorder } from "@/lib/queue";
import { fail, handle, readJson } from "@/lib/server/http";
import { listPlayers, requireHost, requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/reorder  { order: [playerId, ...] } - host only, lobby / between rounds only.
// `order` is a permutation of the seated players (spectator ids may be included, they are ignored): the
// first one gets seat 1, the second seat 2. Seat 1 shoots first in odd rounds, seat 2 in even rounds
// (startSeat in lib/game.ts), so this decides who starts.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/reorder">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    const members = await listPlayers(room.id);
    const plan = planReorder(members, body.order);
    if ("error" in plan) fail(400, plan.error);
    if (!plan.swap) return { ok: true }; // nothing to change
    const { first, second } = plan;

    // `second` has seat 1, `first` has seat 2. The seat is unique per room, so go through "no seat".
    const move = async (id: string, from: number | null, to: number | null) => {
      const q = db().from(T.players).update({ seat: to }).eq("id", id);
      const { data, error } = await (from === null ? q.is("seat", null) : q.eq("seat", from)).select("id");
      if (error) throw error;
      if (!data?.length) fail(409, "Locurile s-au schimbat între timp. Reîncearcă.");
    };
    await move(second, 1, null);
    await move(first, 2, 1);
    await move(second, null, 2);
    await touchRoom(room.id);
    await notifyRoom(room.id, "reorder");
    return { ok: true };
  });
}
