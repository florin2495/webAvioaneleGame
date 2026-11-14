import { connection } from "next/server";
import { isValidPlanesCount, NICKNAME_MAX, PLANES_DEFAULT } from "@/lib/game";
import { hashDeviceId, hashPassword, hashToken, newPlayerToken, newRoomCode } from "@/lib/server/crypto";
import { db, T } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { cleanupAbandonedRooms, cleanupExpiredRooms } from "@/lib/server/room";
import type { RoomListItem } from "@/lib/types";

// GET /api/rooms - public list of every live room (lobby, playing, finished): lobbies to play in, games to watch.
// Idle rooms are deleted by cleanupExpiredRooms first, so they never show up; abandoned rooms in any status
// (no member seen and no activity for 120 s, cleanupAbandonedRooms) are swept at the same time.
export async function GET() {
  await connection(); // always request-time, never prerendered at build
  return handle(async () => {
    await Promise.all([cleanupExpiredRooms(), cleanupAbandonedRooms()]);
    const { data, error } = await db()
      .from(T.rooms)
      .select("code, name, planes_count, status, password_hash, last_activity_at, airplanes_players!airplanes_players_room_id_fkey(seat)")
      .order("last_activity_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rooms: RoomListItem[] = (data ?? []).map((r) => {
      const members = (r.airplanes_players as unknown as { seat: number | null }[]) ?? [];
      return {
        code: r.code,
        name: r.name,
        planesCount: r.planes_count,
        status: r.status,
        hasPassword: r.password_hash !== null,
        players: members.filter((m) => m.seat !== null).length,
        spectators: members.filter((m) => m.seat === null).length,
      };
    });
    return { rooms };
  });
}

// POST /api/rooms - create a room; the creator is host and player 1.
export async function POST(req: Request) {
  return handle(async () => {
    await cleanupExpiredRooms();
    const body = await readJson(req);
    const name = cleanText(body.name, "Numele camerei", 1, 40);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const planesCount = body.planesCount === undefined ? PLANES_DEFAULT : Number(body.planesCount);
    if (!isValidPlanesCount(planesCount)) fail(400, "Numărul de avioane trebuie să fie între 2 și 4.");

    let passwordHash: string | null = null;
    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length > 100) fail(400, "Parola e prea lungă.");
      passwordHash = await hashPassword(body.password);
    }

    let room: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !room; attempt++) {
      const { data, error } = await db()
        .from(T.rooms)
        .insert({ code: newRoomCode(), name, password_hash: passwordHash, planes_count: planesCount })
        .select("id, code")
        .single();
      if (error && !isUniqueViolation(error)) throw error;
      room = data;
    }
    if (!room) fail(503, "Nu am putut genera un cod de cameră. Încearcă din nou.");

    const token = newPlayerToken();
    const { data: player, error: playerError } = await db()
      .from(T.players)
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), device_hash: hashDeviceId(body.deviceId), is_host: true, seat: 1 })
      .select("id")
      .single();
    if (playerError) throw playerError;

    const { error: hostError } = await db().from(T.rooms).update({ host_player_id: player.id }).eq("id", room.id);
    if (hostError) throw hostError;

    return { code: room.code, playerId: player.id, token };
  });
}
