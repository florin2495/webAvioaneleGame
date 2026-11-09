import { layoutError, randomLayout, type Plane } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { requireMember, requireSeat, requireStatus, stateAfter, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/board  { generate: true } | { planes: [{ head, dir }] }
// Saves the caller's hidden layout for this round. Lobby only, and not after "ready".
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/board">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireSeat(player);
    requireStatus(room, "lobby");
    if (player.ready) fail(409, "Ești deja gata. Apasă „Modifică” ca să schimbi avioanele.");

    const body = await readJson(req);
    let planes: Plane[];
    if (body.generate === true) {
      planes = randomLayout(room.planes_count);
    } else {
      const err = layoutError(body.planes, room.planes_count);
      if (err) fail(400, err);
      planes = (body.planes as Plane[]).map((p) => ({ head: p.head, dir: p.dir }));
    }

    const { error } = await db()
      .from(T.boards)
      .upsert({ player_id: player.id, room_id: room.id, round: room.round, planes, updated_at: new Date().toISOString() });
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "board", player.id);
    return { planes, state: await stateAfter(room.id, player.id) };
  });
}
