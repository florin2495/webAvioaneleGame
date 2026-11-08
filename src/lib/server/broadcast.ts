import "server-only";
import type { Move } from "@/lib/game";
import { db } from "./db";

export const roomTopic = (roomId: string) => `airplanes-room:${roomId}`;

/**
 * Tells every client in the room that state changed. Clients re-fetch /state (authenticated), except:
 *  - `by`: the member whose action it was already has the new state in their own answer (e.g. /shoot);
 *  - `move` + `round`: a regular shot, public anyway (every member sees every shot), applied locally by
 *    the others (lib/liveShot.ts). Never put private data here: the channel is not per member.
 * Failures are logged, never thrown - the DB write already succeeded and clients also poll as a fallback.
 */
export async function notifyRoom(
  roomId: string,
  kind: string,
  by?: string,
  shot?: { move: Move; round: number },
): Promise<void> {
  const channel = db().channel(roomTopic(roomId));
  try {
    const res = await channel.httpSend("refresh", { kind, at: Date.now(), by: by ?? null, ...shot });
    if (!res.success) console.error("broadcast failed", res.status, res.error);
  } catch (err) {
    console.error("broadcast failed", err);
  } finally {
    await db().removeChannel(channel);
  }
}
