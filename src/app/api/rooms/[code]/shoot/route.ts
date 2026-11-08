import { after } from "next/server";
import { other, replay, shotError, shotResult, type Move } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { buildState, finishGame, loadRound, requireMember, requireSeat, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/shoot  { cell: 0-99 } - the player on turn fires at the opponent's board.
// Answers with the shooter's new state (same shape as GET /state), so the client needs no second request.
// The broadcast to the other clients and the idle-timer touch run after the response.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/shoot">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    const seat = requireSeat(player);
    requireStatus(room, "playing");
    const body = await readJson(req);
    const cell = Number(body.cell);

    // Players, moves and both layouts in one parallel round trip.
    const round = await loadRound(room);
    const { moves, players, boards } = round;
    const err = shotError(replay(moves, room.round, room.planes_count), seat, cell);
    if (err) fail(409, err);

    const target = players.find((p) => p.seat === other(seat));
    const planes = target ? boards.find((b) => b.player_id === target.id)?.planes : undefined;
    if (!planes) fail(409, "Adversarul nu mai e în joc.");
    const result = shotResult(planes, cell);
    const move: Move = { seq: moves.length + 1, seat, cell, result };

    // unique (room, round, seq): a concurrent move from the same state loses here.
    const { error } = await db().from(T.moves).insert({ room_id: room.id, round: room.round, kind: "shot", ...move });
    if (isUniqueViolation(error)) fail(409, "Starea jocului s-a schimbat. Reîncearcă.");
    if (error) throw error;

    const after_ = replay([...moves, move], room.round, room.planes_count);
    let next = room;
    if (after_.winner) {
      const winner = players.find((p) => p.seat === after_.winner);
      await finishGame(room, winner?.id ?? null, players);
      next = { ...room, status: "finished", winner_player_id: winner?.id ?? null };
    } else {
      after(() => touchRoom(room.id, { updated_at: new Date().toISOString() }));
    }
    after(() => notifyRoom(room.id, "shot", player.id));

    const state = await buildState(next, player, { ...round, moves: [...moves, move] });
    return { result, won: after_.winner === seat, state };
  });
}
