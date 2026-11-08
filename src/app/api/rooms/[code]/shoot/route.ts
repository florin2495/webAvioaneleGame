import { other, replay, shotError, shotResult, type Move } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import {
  finishGame,
  getSeatPlanes,
  listPlayers,
  progressOf,
  requireMember,
  requireSeat,
  requireStatus,
  touchRoom,
} from "@/lib/server/room";

// POST /api/rooms/[code]/shoot  { cell: 0-99 } - the player on turn fires at the opponent's board.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/shoot">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    const seat = requireSeat(player);
    requireStatus(room, "playing");
    const body = await readJson(req);
    const cell = Number(body.cell);

    const { moves, progress } = await progressOf(room);
    const err = shotError(progress, seat, cell);
    if (err) fail(409, err);

    const planes = await getSeatPlanes(room.id, room.round, other(seat));
    if (!planes) fail(409, "Adversarul nu mai e în joc.");
    const result = shotResult(planes, cell);
    const move: Move = { seq: moves.length + 1, seat, cell, result };

    // unique (room, round, seq): a concurrent move from the same state loses here.
    const { error } = await db().from(T.moves).insert({ room_id: room.id, round: room.round, kind: "shot", ...move });
    if (isUniqueViolation(error)) fail(409, "Starea jocului s-a schimbat. Reîncearcă.");
    if (error) throw error;

    const after = replay([...moves, move], room.round, room.planes_count);
    if (after.winner) {
      const winner = (await listPlayers(room.id)).find((p) => p.seat === after.winner);
      await finishGame(room, winner?.id ?? null);
    } else {
      await touchRoom(room.id, { updated_at: new Date().toISOString() });
    }
    await notifyRoom(room.id, "shot");
    return { result, won: after.winner === seat };
  });
}
