import { enforceExpiredKicks } from "@/lib/server/membership";
import { MAX_SPECTATORS, NICKNAME_MAX, SEATS, type Seat } from "@/lib/game";
import { seatBusyMessage, seatClaim } from "@/lib/reconnect";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashDeviceId, hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { db, T } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { getRoomByCode, touchRoom } from "@/lib/server/room";

interface MemberRow {
  id: string;
  nickname: string;
  seat: Seat | null;
  token_hash: string;
  device_hash: string | null;
  last_seen_at: string;
}

// POST /api/rooms/[code]/join  { nickname, password?, spectator?, deviceId? }
// Takes a free seat while the room is in the lobby; otherwise (or on request) joins as a spectator.
// A nickname that is already in the room reclaims that member (same player id, seat, ready flag and planes,
// new token) when the request comes from the same device or the member has been disconnected for 301 s -
// also mid-game.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const deviceHash = hashDeviceId(body.deviceId);
    // Enforce host kicks whose 10 s are over first, so a reclaim cannot undo an expired kick.
    let room = await getRoomByCode(code);
    if (await enforceExpiredKicks(room)) room = await getRoomByCode(code);

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
    }

    const { data: rows, error: rowsError } = await db()
      .from(T.players)
      .select("id, nickname, seat, token_hash, device_hash, last_seen_at")
      .eq("room_id", room.id);
    if (rowsError) throw rowsError;
    const members = (rows ?? []) as MemberRow[];

    const existing = members.find((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (existing) {
      if (seatClaim(existing, deviceHash, Date.now()) === "busy") fail(409, seatBusyMessage(existing.nickname));
      const token = newPlayerToken();
      // Conditional on the old token: two reclaims at once -> only one wins, the other gets a 409.
      // Seat, ready flag and planes stay with the row; only a pending kick is dropped.
      const { data, error } = await db()
        .from(T.players)
        .update({
          token_hash: hashToken(token),
          device_hash: deviceHash ?? existing.device_hash,
          kick_requested_at: null,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("token_hash", existing.token_hash)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) fail(409, "Locul tocmai a fost reluat de altcineva. Mai încearcă o dată.");
      await touchRoom(room.id);
      await notifyRoom(room.id, "player_rejoined");
      return { code: room.code, playerId: existing.id, token, seat: existing.seat };
    }

    const wantsSeat = body.spectator !== true && room.status === "lobby";
    const freeSeats = wantsSeat ? SEATS.filter((s) => !members.some((m) => m.seat === s)) : [];
    const spectators = members.filter((m) => m.seat === null).length;
    if (freeSeats.length === 0 && spectators >= MAX_SPECTATORS) {
      fail(409, `Camera are deja ${MAX_SPECTATORS} spectatori, nu mai e loc de privit.`);
    }

    const token = newPlayerToken();
    // Try each free seat, then spectator. A concurrent join may take a seat first (unique index).
    for (const seat of [...freeSeats, null]) {
      const { data, error } = await db()
        .from(T.players)
        .insert({ room_id: room.id, nickname, token_hash: hashToken(token), device_hash: deviceHash, seat })
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
    fail(409, `Camera are deja ${MAX_SPECTATORS} spectatori, nu mai e loc de privit.`);
  });
}
