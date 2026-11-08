import "server-only";
import { db } from "./db";

export const roomTopic = (roomId: string) => `airplanes-room:${roomId}`;

/**
 * Tells every client in the room that state changed. Payload carries no game data:
 * clients re-fetch /state (authenticated). `by` = the member whose action it was and who already has the
 * new state in their own answer (e.g. /shoot), so their client can skip the extra /state. Failures are logged, never thrown -
 * the DB write already succeeded and clients also poll as a fallback.
 */
export async function notifyRoom(roomId: string, kind: string, by?: string): Promise<void> {
  const channel = db().channel(roomTopic(roomId));
  try {
    const res = await channel.httpSend("refresh", { kind, at: Date.now(), by: by ?? null });
    if (!res.success) console.error("broadcast failed", res.status, res.error);
  } catch (err) {
    console.error("broadcast failed", err);
  } finally {
    await db().removeChannel(channel);
  }
}
