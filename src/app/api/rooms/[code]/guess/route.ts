import { isDir, other, planeAtHead, planeCells, type Move } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { getSeatPlanes, progressOf, requireMember, requireSeat, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/guess  { dir: "N"|"E"|"S"|"W" }
// After hitting a head, the shooter guesses how that plane lies. Right: the plane is revealed and
// they keep shooting. Wrong: the plane stays down, nothing is revealed, the turn passes.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/guess">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    const seat = requireSeat(player);
    requireStatus(room, "playing");
    const body = await readJson(req);
    if (!isDir(body.dir)) fail(400, "Direcție invalidă.");
    const dir = body.dir;

    const { moves, progress } = await progressOf(room);
    if (!progress.pending || progress.pending.seat !== seat) fail(409, "Nu ai nimic de ghicit acum.");
    const head = progress.pending.head;
    if (!planeCells({ head, dir })) fail(400, "Avionul n-ar încăpea pe tablă așa.");

    const planes = await getSeatPlanes(room.id, room.round, other(seat));
    if (!planes) fail(409, "Adversarul nu mai e în joc.");
    const actual = planeAtHead(planes, head);
    const result = actual?.dir === dir ? "correct" : "wrong";
    const move: Move = { seq: moves.length + 1, kind: "guess", seat, cell: head, dir, result };

    const { error } = await db().from(T.moves).insert({ room_id: room.id, round: room.round, ...move });
    if (isUniqueViolation(error)) fail(409, "Starea jocului s-a schimbat. Reîncearcă.");
    if (error) throw error;

    await touchRoom(room.id, { updated_at: new Date().toISOString() });
    await notifyRoom(room.id, "guess");
    return { result };
  });
}
