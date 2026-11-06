import { MAX_MEMBERS, NICKNAME_MAX, SEATS } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { db, T } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { getRoomByCode, listPlayers, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/join  { nickname, password?, spectator? }
// Takes a free seat while the room is in the lobby; otherwise (or on request) joins as a spectator.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const room = await getRoomByCode(code);

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
    }

    const members = await listPlayers(room.id);
    if (members.length >= MAX_MEMBERS) fail(409, `Camera e plină (2 jucători + ${MAX_MEMBERS - 2} spectatori).`);

    const wantsSeat = body.spectator !== true && room.status === "lobby";
    const freeSeats = wantsSeat ? SEATS.filter((s) => !members.some((m) => m.seat === s)) : [];

    const token = newPlayerToken();
    // Try each free seat, then spectator. A concurrent join may take a seat first (unique index).
    for (const seat of [...freeSeats, null]) {
      const { data, error } = await db()
        .from(T.players)
        .insert({ room_id: room.id, nickname, token_hash: hashToken(token), seat })
        .select("id, seat")
        .single();
      if (isUniqueViolation(error)) {
        if (error?.message?.includes("seat")) continue;
        fail(409, "Nickname-ul e deja folosit în cameră.");
      }
      if (error) throw error;
      await touchRoom(room.id);
      await notifyRoom(room.id, "player_joined");
      return { code: room.code, playerId: data.id, token, seat: data.seat };
    }
    fail(409, "Camera e plină.");
  });
}
