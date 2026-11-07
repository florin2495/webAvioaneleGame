/** Grace period a kicked player has to press "Ignoră" while a game is running. */
export const KICK_GRACE_MS = 10_000;
/** Extra time the server allows on top of the grace period (network latency). */
export const KICK_NETWORK_GRACE_MS = 2_000;

type Stamp = string | number | Date | null | undefined;
const ms = (t: string | number | Date) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));

/** Ms left of the pending kick, clamped to [0, KICK_GRACE_MS]; null when there is no pending kick. */
export function kickRemainingMs(requestedAt: Stamp, now: number): number | null {
  if (requestedAt === null || requestedAt === undefined) return null;
  const t = ms(requestedAt);
  if (Number.isNaN(t)) return null;
  return Math.min(KICK_GRACE_MS, Math.max(0, t + KICK_GRACE_MS - now));
}

/** True once the grace period plus the network allowance has passed (server-side enforcement / ignore cutoff). */
export function isKickExpired(requestedAt: Stamp, now: number): boolean {
  if (requestedAt === null || requestedAt === undefined) return false;
  const t = ms(requestedAt);
  return !Number.isNaN(t) && now - t > KICK_GRACE_MS + KICK_NETWORK_GRACE_MS;
}
