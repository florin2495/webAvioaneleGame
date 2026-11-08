// Pure helpers for the spectator queue (contract B) and the host's reorder (contract A). No I/O.

interface Member {
  id: string;
  seat: number | null;
  queued_at?: string | null;
}

/** Spectators waiting for a seat in the next round, in the order they asked. */
export function queueOrder<T extends Member>(members: T[]): T[] {
  return members
    .filter((p) => p.seat === null && p.queued_at != null)
    .sort((a, b) => Date.parse(a.queued_at as string) - Date.parse(b.queued_at as string));
}

export type ReorderPlan = { error: string } | { swap: false } | { swap: true; first: string; second: string };

/**
 * Validates `{ order }` of POST /reorder. `order` must be a list of distinct member ids that includes every
 * seated player (spectator ids are ignored). `first` gets seat 1 and `second` seat 2; `swap` is false when
 * the order already is the current one.
 */
export function planReorder(members: Member[], order: unknown): ReorderPlan {
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string") || new Set(order).size !== order.length) {
    return { error: "Ordine invalidă." };
  }
  if (order.some((id) => !members.some((m) => m.id === id))) return { error: "Ordine invalidă: jucător necunoscut." };
  const seated = members.filter((m) => m.seat !== null);
  const wanted = (order as string[]).filter((id) => seated.some((m) => m.id === id));
  if (wanted.length !== seated.length) return { error: "Ordinea trebuie să cuprindă toți jucătorii." };
  if (wanted.length < 2) return { swap: false };
  const [first, second] = wanted;
  return seated.find((m) => m.id === first)?.seat === 1 ? { swap: false } : { swap: true, first, second };
}
